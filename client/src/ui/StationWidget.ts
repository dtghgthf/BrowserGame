import { Container, Graphics, Sprite } from 'pixi.js';
import { PIXELS_PER_METER, wrapAngle, type GameState, type StationKind, type Tuning } from '@lw/shared';
import { AimAids, type WorldToScreen } from './AimAids';
import { frameOf, type Sheet } from '../render/assets';
import type { GameRenderer } from '../render/GameRenderer';
import type { Snapshot } from '../game/snapshot';
import { PixelFont, PixelText } from './PixelFont';
import { RouteMap } from './RouteMap';
import { SeaChart } from './SeaChart';

/** Visual wheel turns for full rudder (±270°). */
const WHEEL_TURNS = Math.PI * 1.5;
/** Cannon / life ring: sideways drag turns the barrel (rad per px), dragging up and down sets the strength (px for 0..1). */
const AIM_RAD_PER_PX = 0.022;
const POWER_PX = 50;

interface Drag {
  pointerId: number;
  lastAngle: number;
  accum: number;
  /** Station value and pointer position when the control was grabbed (relative controls). */
  grabValue: number;
  grabPower: number;
  grabX: number;
  grabY: number;
}

/**
 * How a dragged control maps the pointer to the station value. Relative
 * controls move exactly with the finger from where they were grabbed (the
 * simulation caps the speed): `linear` along a screen axis (px per unit of
 * value), `lever` / `crank` by turning around a pivot (radians of the prop per
 * unit of value; the crank turns without end).
 */
export type DragGeometry =
  | { mode: 'linear'; axis: { x: number; y: number } }
  | { mode: 'lever' | 'crank'; pivot: { x: number; y: number }; perUnit: number };

/** The 2.5D scene's control: drag centre, radius, scale (px per m) and its geometry on screen. */
export interface DioramaInput {
  center: { x: number; y: number };
  radius: number;
  scale: number;
  geometry: DragGeometry | null;
  /** Screen px of the barrel / lamp / ring pivot (the aiming aids' bearing ring). */
  aim: { x: number; y: number } | null;
}

/**
 * Big interactive controls shown while operating a station: a real steering
 * wheel you turn by dragging around it, a pump lever you pull up and down and a
 * brass dial to aim the searchlight / cannon. They produce an analog `target`
 * for PlayerInput; keyboard players keep using A/D and simply see the widget move.
 */
export class StationWidget {
  readonly root = new Container();
  /** Analog station target for the primary local player (null = not dragging). */
  target: number | null = null;
  /** Second axis: strength of the shot / throw 0..1 (null = not dragging). */
  target2: number | null = null;
  private power = 1;
  private readonly g = new Graphics();
  private readonly wheel: Sprite;
  private readonly dial: Sprite;
  private readonly needle: Sprite;
  private readonly pump: Sprite;
  private readonly lever: Sprite;
  private readonly title: PixelText;
  private readonly sub: PixelText;
  private readonly chart: SeaChart;
  private readonly route: RouteMap;
  private kind: StationKind | null = null;
  private center = { x: 0, y: 0 };
  private radius = 32;
  private drag: Drag | null = null;
  private roll = 0;
  /** Ring station: the ring is in the water, the control pulls the line. */
  private pulling = false;
  /** 2.5D view: the controls are the props in the scene; drag around their projected centre. */
  private diorama: DioramaInput | null = null;
  /** Geometry of the 2D control of the current station (set while drawing it). */
  private geometry2d: DragGeometry | null = null;
  /** The 2D controls are hidden while the 2.5D view takes over (the camera is moving in). */
  hidden = false;
  /** World m -> screen px through the 2.5D camera (set by the game). */
  projectWorld: WorldToScreen | null = null;
  private readonly aims: AimAids;

  /** Called every frame: null = the 2D controls, otherwise drag on the scene's station. */
  setDiorama(d: DioramaInput | null): void {
    this.diorama = d;
  }

  /** How dragging maps to the value right now (the scene's prop or the 2D widget). */
  private geometry(): DragGeometry | null {
    return this.diorama ? this.diorama.geometry : this.geometry2d;
  }

  /** Value of the dragged part: the line of the ring while pulling, otherwise the station value. */
  private dragValue(): number {
    return this.kind === 'ring' && this.pulling ? this.charge : this.value;
  }
  private charge = 0;
  private releaseTarget = false;
  private value = 0;
  private time = 0;
  /** Last pointer position (internal px) of the active drag, re-applied every frame. */
  private lastPointer: { x: number; y: number } | null = null;

  constructor(
    private readonly r: GameRenderer,
    props: Sheet,
    font: PixelFont,
  ) {
    const mk = (name: string) => {
      const f = frameOf(props, name);
      const s = new Sprite(f.texture);
      s.anchor.set(f.pivot.x / f.width, f.pivot.y / f.height);
      return s;
    };
    this.wheel = mk('ui_wheel');
    this.dial = mk('ui_dial');
    this.needle = mk('ui_needle');
    this.pump = mk('ui_pump');
    this.lever = mk('ui_lever');
    this.title = new PixelText(font, '', 0xe0b860);
    this.sub = new PixelText(font, '', 0x9aa6b4);
    this.chart = new SeaChart(font, true);
    this.route = new RouteMap(props, font);
    this.aims = new AimAids(font);
    this.root.addChild(this.aims.root, this.g, this.wheel, this.dial, this.needle, this.pump, this.lever, this.title, this.sub, this.chart.root, this.route.root);
    this.root.visible = false;

    // capture phase: a drag on the widget must not also start the touch stick
    window.addEventListener('pointerdown', (e) => this.onDown(e), { capture: true });
    window.addEventListener('pointermove', (e) => this.onMove(e), { capture: true });
    window.addEventListener('pointerup', (e) => this.onUp(e), { capture: true });
    window.addEventListener('pointercancel', (e) => this.onUp(e), { capture: true });
  }

  /** Converts a pointer event to internal low-res pixels. */
  private toInternal(e: PointerEvent): { x: number; y: number } | null {
    const rect = this.r.renderer.canvas.getBoundingClientRect();
    if (rect.width === 0) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * this.r.layout.width,
      y: ((e.clientY - rect.top) / rect.height) * this.r.layout.height,
    };
  }

  private onDown(e: PointerEvent): void {
    if (!this.root.visible || !this.kind || this.drag) return;
    const p = this.toInternal(e);
    if (!p) return;
    const dx = p.x - this.center.x;
    const dy = p.y - this.center.y;
    // the chart table: anywhere on the map
    const rr = this.route.rect;
    const onMap = this.kind === 'table' && this.route.root.visible && p.x >= rr.x && p.x <= rr.x + rr.w && p.y >= rr.y && p.y <= rr.y + rr.h;
    if (!onMap && Math.hypot(dx, dy) > this.radius + 6) return;
    e.stopPropagation();
    e.preventDefault();
    const g = this.geometry();
    const pv = g && g.mode !== 'linear' ? g.pivot : this.center;
    const a = Math.atan2(p.y - pv.y, p.x - pv.x);
    this.drag = { pointerId: e.pointerId, lastAngle: a, accum: this.value * WHEEL_TURNS, grabValue: this.dragValue(), grabPower: this.power, grabX: p.x, grabY: p.y };
    this.applyPointer(p);
  }

  private onMove(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const p = this.toInternal(e);
    if (p) this.applyPointer(p);
    e.stopPropagation();
  }

  private onUp(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    this.drag = null;
    // a quick tap (down and up within one frame) must still be read once: the target goes in the next update
    this.releaseTarget = true;
    this.lastPointer = null;
    e.stopPropagation();
  }

  /** Relative drag: the grabbed part follows the pointer 1:1 (null = no geometry, use the absolute mapping). */
  private relative(p: { x: number; y: number }, lo: number, hi: number): number | null {
    const d = this.drag!;
    const g = this.geometry();
    if (!g) return null;
    if (g.mode === 'linear') {
      const len2 = g.axis.x * g.axis.x + g.axis.y * g.axis.y;
      if (len2 < 1) return null;
      const moved = ((p.x - d.grabX) * g.axis.x + (p.y - d.grabY) * g.axis.y) / len2;
      return Math.max(lo, Math.min(hi, d.grabValue + moved));
    }
    const dx = p.x - g.pivot.x;
    const dy = p.y - g.pivot.y;
    // too close to the pivot the angle jitters: keep the last value
    if (Math.hypot(dx, dy) > 5) {
      const a = Math.atan2(dy, dx);
      d.accum += wrapAngle(a - d.lastAngle);
      d.lastAngle = a;
      if (g.mode === 'lever') {
        // the lever stops at its ends: so does the accumulated turn
        const room = { lo: (lo - d.grabValue) * g.perUnit, hi: (hi - d.grabValue) * g.perUnit };
        d.accum = Math.max(room.lo, Math.min(room.hi, d.accum));
      }
    }
    return Math.max(lo, Math.min(hi, d.grabValue + d.accum / g.perUnit));
  }

  /** Aiming: sideways = the angle (clockwise to the right, like D), up = stronger, down = weaker. */
  private aimDrag(p: { x: number; y: number }, lo: number, hi: number): void {
    const d = this.drag!;
    this.target = Math.max(lo, Math.min(hi, d.grabValue + (p.x - d.grabX) * AIM_RAD_PER_PX));
    this.target2 = Math.max(0, Math.min(1, d.grabPower - (p.y - d.grabY) / POWER_PX));
  }

  private applyPointer(p: { x: number; y: number }): void {
    const d = this.drag!;
    this.lastPointer = p;
    const dx = p.x - this.center.x;
    const dy = p.y - this.center.y;
    switch (this.kind) {
      case 'wheel': {
        const a = Math.atan2(dy, dx);
        if (Math.hypot(dx, dy) > 4) d.accum += wrapAngle(a - d.lastAngle);
        d.lastAngle = a;
        d.accum = Math.max(-WHEEL_TURNS, Math.min(WHEEL_TURNS, d.accum));
        this.target = d.accum / WHEEL_TURNS;
        break;
      }
      case 'pump':
        // the lever turns with the hand around its pivot: up = -1, down = +1
        this.target = this.relative(p, -1, 1) ?? Math.max(-1, Math.min(1, (p.y - this.center.y) / 16));
        break;
      case 'table': {
        // tap the leg on the map: the nearest of the legs that can be chosen
        const opts = this.route.options;
        if (opts.length === 0) break;
        let best = 0;
        opts.forEach((o, i) => {
          if (Math.hypot(o.x - p.x, o.y - p.y) < Math.hypot(opts[best]!.x - p.x, opts[best]!.y - p.y)) best = i;
        });
        this.target = opts.length > 1 ? -1 + (2 * best) / (opts.length - 1) : 0;
        break;
      }
      case 'workshop':
        // push and pull the saw sideways - it stays under the finger
        this.target = this.relative(p, -1, 1) ?? Math.max(-1, Math.min(1, (p.x - this.center.x) / 20));
        break;
      case 'ring':
        // the ring in the water: pull the line sideways; otherwise aim the throw like the cannon
        if (this.pulling) this.target = this.relative(p, -1, 1) ?? Math.max(-1, Math.min(1, (p.x - this.center.x) / 20));
        else this.aimDrag(p, -Infinity, Infinity);
        break;
      case 'searchlight': {
        // 2.5D: the crank turns the lamp (without end); 2D: point the dial
        const g = this.geometry();
        if (g?.mode === 'crank') this.target = this.relative(p, -1e6, 1e6);
        else if (Math.hypot(dx, dy) > 3) this.target = Math.atan2(dy, dx) - this.roll;
        break;
      }
      case 'cannon':
        this.aimDrag(p, -1.3, 0.35);
        break;
      default:
        break;
    }
  }

  /** Strength of the shot / throw: a vertical gauge next to the dial (full = up). */
  private powerBar(x: number, cy: number, power: number): void {
    const h = 50;
    const top = cy - h / 2;
    this.g.rect(x - 1, top - 1, 6, h + 2).fill(0x2c3a4c);
    this.g.rect(x, top, 4, h).fill(0x0b1018);
    const f = Math.round(h * Math.max(0, Math.min(1, power)));
    if (f > 0) this.g.rect(x, top + h - f, 4, f).fill(power > 0.8 ? 0xe8584a : power > 0.45 ? 0xe0b860 : 0x6cc070);
  }

  update(state: GameState, view: Snapshot, playerId: string | undefined, tuning: Readonly<Tuning>): void {
    if (this.releaseTarget && !this.drag) {
      this.target = null;
      this.target2 = null;
    }
    this.releaseTarget = false;
    const p = state.players.find((pp) => pp.id === playerId);
    const st = p && p.station !== null ? state.stations[p.station] : undefined;
    const kind = st && st.kind !== 'rack' ? st.kind : null;
    if (kind !== this.kind) {
      this.kind = kind;
      this.drag = null;
      this.target = null;
      this.target2 = null;
    }
    this.root.visible = kind !== null && !this.hidden;
    if (!kind || !st) return;
    this.charge = st.charge;
    this.power = st.power;
    this.roll = view.ship.roll;
    this.time = view.time;
    this.value = view.stations[st.id]?.value ?? st.value;
    // a held dial keeps pointing at the same screen direction while the ship rolls
    const pulling = kind === 'ring' && state.ring !== null && state.ring.phase !== 'flying';
    if (pulling !== this.pulling) {
      this.pulling = pulling;
      this.drag = null;
      this.target = null;
    }
    if (this.drag && this.lastPointer && (kind === 'searchlight' || kind === 'cannon' || (kind === 'ring' && !pulling))) this.applyPointer(this.lastPointer);

    const W = this.r.layout.width;
    const H = this.r.layout.height;
    const cx = Math.round(W / 2);
    const cy = H - 60;
    // the helm shares the bottom with its sea chart: the wheel moves a bit to the left
    // the helm shares the bottom with its sea chart; the life ring keeps the sea behind the ship free (control on the right)
    // the cannon keeps the sea on the bow side free (its control sits on the left)
    // (right of the HUD column, which reaches about 100 px into the screen)
    const ox = kind === 'wheel' ? -30 : kind === 'ring' ? Math.round(W / 2) - 58 : kind === 'cannon' ? Math.min(0, 140 - cx) : 0;
    this.center = this.diorama ? { x: Math.round(this.diorama.center.x), y: Math.round(this.diorama.center.y) } : { x: cx + ox, y: cy };
    this.g.clear();
    this.geometry2d = null;
    for (const s of [this.wheel, this.dial, this.needle, this.pump, this.lever]) s.visible = false;
    this.chart.root.visible = false;
    this.route.root.visible = false;
    // soft backing so the control reads against any background
    this.g.circle(cx + ox, cy, 34).fill({ color: 0x05070d, alpha: 0.45 });

    let title = '';
    let sub = '';
    switch (kind) {
      case 'wheel': {
        this.radius = 30;
        const wx = cx + ox;
        this.wheel.visible = true;
        this.wheel.position.set(wx, cy);
        this.wheel.rotation = this.value * WHEEL_TURNS;
        // rudder gauge under the wheel
        const gx = wx - 24;
        const gy = cy + 33;
        this.g.rect(gx - 1, gy - 1, 50, 5).fill(0x2c3a4c);
        this.g.rect(gx, gy, 48, 3).fill(0x0b1018);
        this.g.rect(wx, gy - 1, 1, 5).fill(0x6cc070);
        this.g.rect(wx + Math.round(this.value * 23) - 1, gy - 1, 3, 5).fill(0xe0b860);
        // course error (green = on course)
        const err = Math.max(-1, Math.min(1, state.ship.heading));
        this.g.rect(wx + Math.round(err * 23), gy + 5, 1, 2).fill(Math.abs(state.ship.heading) > 0.35 ? 0xe8584a : 0x6cc070);
        // the sea chart next to the wheel: steer around the red rocks
        this.chart.root.visible = true;
        this.chart.draw(state, tuning, cx + 40, cy - 46, 78, 80, this.time);
        title = 'STEUERRAD';
        sub = this.drag ? '' : 'DREHEN: ZIEHEN ODER A/D';
        break;
      }
      case 'pump': {
        this.radius = 30;
        this.pump.visible = true;
        this.lever.visible = true;
        this.pump.position.set(cx - 8, cy + 24);
        this.lever.position.set(cx - 8, cy - 13);
        this.lever.rotation = this.value * 0.55;
        this.geometry2d = { mode: 'lever', pivot: { x: cx - 8, y: cy - 13 }, perUnit: 0.55 };
        // water level of the hold + stroke count
        const comp = state.compartments[1];
        const frac = comp ? Math.min(1, comp.volume / 40) : 0;
        this.g.rect(cx + 22, cy - 18, 6, 38).fill(0x2c3a4c);
        this.g.rect(cx + 23, cy - 17, 4, 36).fill(0x0b1018);
        const h = Math.round(36 * frac);
        if (h > 0) this.g.rect(cx + 23, cy + 19 - h, 4, h).fill(frac > 0.5 ? 0xe8584a : 0x3d86d6);
        // heat: pumping nonstop wears the pump - a short rest cools it
        const hot = st.charge > tuning.gameplay.pumpHotAt;
        this.g.rect(cx - 34, cy - 18, 5, 38).fill(0x2c3a4c);
        this.g.rect(cx - 33, cy - 17, 3, 36).fill(0x0b1018);
        const hh = Math.round(36 * Math.min(1, st.charge));
        if (hh > 0) this.g.rect(cx - 33, cy + 19 - hh, 3, hh).fill(hot ? (Math.sin(this.time * 9) > 0 ? 0xff5040 : 0xe8a040) : 0xe8a040);
        title = 'PUMPE';
        sub = hot ? 'HEISS! KURZ PAUSE' : this.drag ? `HUB ${st.aux}` : 'HEBEL AUF UND AB / A-D';
        break;
      }
      case 'workshop': {
        this.radius = 30;
        // the plank on the bench and the saw going back and forth
        const progress = st.charge;
        this.g.rect(cx - 30, cy + 2, 60, 6).fill(0x8a5a32);
        this.g.rect(cx - 30, cy + 2, 60, 1).fill(0xb07a48);
        const cut = Math.round(progress * 6);
        if (cut > 0) this.g.rect(cx - 1, cy + 2, 2, cut).fill(0x2a1a10);
        const sx = cx + Math.round(this.value * 14);
        this.geometry2d = { mode: 'linear', axis: { x: 14, y: 0 } };
        this.g.rect(sx - 16, cy - 6, 30, 7).fill(0xb8c0c8);
        this.g.rect(sx - 16, cy + 1, 30, 1).fill(0x707880);
        this.g.rect(sx + 14, cy - 9, 7, 11).fill(0x6a3a20);
        // progress + wood stock
        this.g.rect(cx - 20, cy + 14, 40, 3).fill(0x2c3a4c);
        this.g.rect(cx - 20, cy + 14, Math.round(40 * progress), 3).fill(0xe0b860);
        title = 'WERKBANK';
        const wood = state.voyage.timber;
        sub = wood <= 0 ? 'KEIN HOLZ! KISTEN ZERLEGEN' : this.drag ? `HOLZ ${wood}` : `SÄGEN: HIN UND HER / A-D  HOLZ ${wood}`;
        break;
      }
      case 'searchlight':
      case 'cannon': {
        const dx0 = cx + ox;
        this.radius = 28;
        this.dial.visible = true;
        this.needle.visible = true;
        this.dial.position.set(dx0, cy);
        this.needle.position.set(dx0, cy);
        this.needle.rotation = this.value + this.roll;
        title = kind === 'searchlight' ? 'SCHEINWERFER' : 'KANONE';
        if (kind === 'searchlight') sub = this.drag ? '' : st.charge <= 0 ? 'KEIN ÖL! ÖLKANNE HOLEN' : 'AUFS MEER VORAUS ZEIGEN / A-D';
        else sub = this.drag ? '' : st.charge < 2 ? `LADEN ${Math.round((st.charge / 2) * 100)}% - SCHNELLER: KUGEL VOM GESTELL STOPFEN` : 'A/D WINKEL · W/S STÄRKE · F = FEUER!';
        // load bar (cannon) / oil gauge (searchlight) under the dial
        const frac = kind === 'cannon' ? Math.min(1, st.charge / 2) : st.charge;
        this.g.rect(dx0 - 20, cy + 32, 40, 3).fill(0x2c3a4c);
        const full = kind === 'cannon' ? frac >= 1 : frac > 0.25;
        this.g.rect(dx0 - 20, cy + 32, Math.round(40 * frac), 3).fill(full ? 0x6cc070 : kind === 'cannon' ? 0xe0b860 : 0xe8584a);
        if (kind === 'cannon') this.powerBar(dx0 + 34, cy, st.power);
        break;
      }
      case 'table': {
        this.radius = 90;
        this.g.clear();
        this.route.root.visible = true;
        this.route.draw(state.campaign, cx - 100, cy - 70, 200, 104, this.time, 'SEEKARTE DER FAHRT');
        title = 'KARTENTISCH';
        if (state.status === 'harbor') sub = `ETAPPE ANTIPPEN ODER W/S · F = ABLEGEN (${Math.ceil(state.statusTimer)})`;
        else sub = state.campaign.nodes.length ? 'UNTERWEGS - IM HAFEN WÄHLT IHR HIER DIE ROUTE' : '';
        break;
      }
      case 'ring': {
        this.radius = 30;
        title = 'RETTUNGSRING';
        if (this.pulling) {
          // hand over hand: the line between the hands
          const rx = cx + ox;
          const hx = rx + Math.round(st.charge * 16);
          this.geometry2d = { mode: 'linear', axis: { x: 16, y: 0 } };
          this.g.rect(rx - 30, cy, 60, 1).fill(0xd8c8a0);
          this.g.rect(hx - 3, cy - 4, 6, 8).fill(0xe0b090);
          this.g.rect(hx - 2, cy - 3, 4, 6).fill(0xc89878);
          const held = state.ring?.holder !== null;
          sub = held ? 'EINHOLEN: HIN UND HER / A-D' : 'LEINE EINHOLEN: HIN UND HER · F = SOFORT';
        } else {
          const rx = cx + ox;
          this.dial.visible = true;
          this.needle.visible = true;
          this.dial.position.set(rx, cy);
          this.needle.position.set(rx, cy);
          this.needle.rotation = this.value + this.roll;
          this.powerBar(rx - 38, cy, st.power);
          sub = state.ring ? 'FLIEGT ...' : this.drag ? '' : 'A/D WINKEL · W/S STÄRKE · F = WERFEN!';
        }
        break;
      }
      default:
        break;
    }
    // aiming aids: where the shot / throw goes and what is out there
    const aiming = kind === 'cannon' || kind === 'searchlight' || (kind === 'ring' && !this.pulling);
    if (aiming) {
      const d = this.diorama;
      const flat: WorldToScreen = (wx, wy) => ({ x: wx * PIXELS_PER_METER - this.r.viewLeft, y: wy * PIXELS_PER_METER - this.r.viewTop });
      const toScreen = d && this.projectWorld ? this.projectWorld : flat;
      // the 2.5D scene does not show the sea around the ship: bearings on a ring around the pivot (2D: only for the far-reaching lamp)
      const ring = d ? (d.aim ? { ...d.aim, radius: 58 } : null) : kind === 'searchlight' ? { x: cx, y: cy, radius: 38 } : null;
      this.aims.draw(st, state, view, tuning, toScreen, ring, W, H, this.time);
    } else this.aims.clear();
    if (this.diorama) {
      // the scene shows the station itself: only the texts stay, near the bottom
      this.g.clear();
      for (const sp of [this.wheel, this.dial, this.needle, this.pump, this.lever]) sp.visible = false;
      if (kind === 'searchlight' && this.diorama.geometry?.mode === 'crank' && !this.drag) {
        // a turning arrow around the crank: that is the handle
        const c = this.center;
        const r = this.diorama.radius + 5;
        const spin = this.time * 1.6;
        for (let i = 0; i < 20; i++) {
          const a = spin + (i / 20) * Math.PI * 1.6;
          this.g.rect(Math.round(c.x + Math.cos(a) * r), Math.round(c.y + Math.sin(a) * r), 2, 2).fill({ color: 0xe0b860, alpha: 0.4 + (i / 20) * 0.6 });
        }
        const a = spin + Math.PI * 1.6;
        const tip = { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
        this.g.rect(Math.round(tip.x) - 2, Math.round(tip.y) - 2, 5, 5).fill(0xe0b860);
        sub = st.charge <= 0 ? 'KEIN ÖL! ÖLKANNE HOLEN' : 'KURBEL DREHEN / A-D';
      }
      this.chart.root.visible = false;
      // the route map stays readable at the chart table (the parchment in the scene is too flat to read)
      this.route.root.visible = kind === 'table';
      if (kind === 'table') this.route.draw(state.campaign, cx - 100, 64, 200, 104, this.time, 'SEEKARTE DER FAHRT');
      this.radius = this.diorama.radius;
      this.title.text = title;
      this.title.position.set(Math.round(cx - this.title.textWidth / 2), H - 38);
      this.sub.text = sub;
      this.sub.position.set(Math.round(cx - this.sub.textWidth / 2), H - 30);
      this.sub.visible = sub.length > 0;
      return;
    }
    this.title.text = title;
    const big = kind === 'table';
    // the helm's texts go above the wheel and the chart (they would run into the chart otherwise)
    const top = big ? cy - 80 : kind === 'wheel' ? cy - 64 : cy - 44;
    this.sub.text = sub;
    const half = Math.max(this.title.textWidth, this.sub.textWidth) / 2;
    const tx = kind === 'ring' ? Math.min(W - 2 - half, cx + ox) : kind === 'cannon' ? Math.max(102 + half, cx + ox) : cx;
    this.title.position.set(Math.round(tx - this.title.textWidth / 2), top);
    this.sub.text = sub;
    this.sub.position.set(Math.round(tx - this.sub.textWidth / 2), big ? cy + 37 : top + 7);
    this.sub.visible = sub.length > 0;
  }
}
