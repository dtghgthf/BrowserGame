import { Container, Graphics, Sprite } from 'pixi.js';
import { wrapAngle, type GameState, type StationKind, type Tuning } from '@lw/shared';
import { frameOf, type Sheet } from '../render/assets';
import type { GameRenderer } from '../render/GameRenderer';
import type { Snapshot } from '../game/snapshot';
import { PixelFont, PixelText } from './PixelFont';
import { RouteMap } from './RouteMap';
import { SeaChart } from './SeaChart';

/** Visual wheel turns for full rudder (±270°). */
const WHEEL_TURNS = Math.PI * 1.5;

interface Drag {
  pointerId: number;
  lastAngle: number;
  accum: number;
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
  private diorama: { center: { x: number; y: number }; radius: number; scale: number } | null = null;

  /** Called every frame: null = the 2D controls, otherwise drag on the scene's station. */
  setDiorama(d: { center: { x: number; y: number }; radius: number; scale: number } | null): void {
    this.diorama = d;
  }

  /** Pixel distance that means "full deflection" for linear controls (lever, saw, line). */
  private span(base: number): number {
    return this.diorama ? Math.max(8, this.diorama.radius * 0.8) : base;
  }
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
    this.root.addChild(this.g, this.wheel, this.dial, this.needle, this.pump, this.lever, this.title, this.sub, this.chart.root, this.route.root);
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
    if (Math.hypot(dx, dy) > this.radius + 6) return;
    e.stopPropagation();
    e.preventDefault();
    const a = Math.atan2(dy, dx);
    this.drag = { pointerId: e.pointerId, lastAngle: a, accum: this.value * WHEEL_TURNS };
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
    this.target = null;
    this.lastPointer = null;
    e.stopPropagation();
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
        // pull the lever: up = -1, down = +1
        this.target = Math.max(-1, Math.min(1, (p.y - this.center.y) / this.span(16)));
        break;
      case 'table':
        // point left / right on the chart to pick a way
        this.target = Math.max(-1, Math.min(1, (p.x - this.center.x) / this.span(60)));
        break;
      case 'workshop':
        // push and pull the saw sideways
        this.target = Math.max(-1, Math.min(1, (p.x - this.center.x) / this.span(20)));
        break;
      case 'ring':
        // the ring in the water: pull the line sideways; otherwise aim the throw like the cannon
        if (this.pulling) this.target = Math.max(-1, Math.min(1, (p.x - this.center.x) / this.span(20)));
        else if (Math.hypot(dx, dy) > 3) this.target = Math.atan2(dy, dx) - this.roll;
        break;
      case 'searchlight':
      case 'cannon':
        // the dial shows world directions: compensate the ship's roll
        if (Math.hypot(dx, dy) > 3) this.target = Math.atan2(dy, dx) - this.roll;
        break;
      default:
        break;
    }
  }

  update(state: GameState, view: Snapshot, playerId: string | undefined, tuning: Readonly<Tuning>): void {
    const p = state.players.find((pp) => pp.id === playerId);
    const st = p && p.station !== null ? state.stations[p.station] : undefined;
    const kind = st && st.kind !== 'rack' ? st.kind : null;
    if (kind !== this.kind) {
      this.kind = kind;
      this.drag = null;
      this.target = null;
    }
    this.root.visible = kind !== null;
    if (!kind || !st) return;
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
    this.center = this.diorama ? { x: Math.round(this.diorama.center.x), y: Math.round(this.diorama.center.y) } : { x: cx, y: cy };
    this.g.clear();
    for (const s of [this.wheel, this.dial, this.needle, this.pump, this.lever]) s.visible = false;
    this.chart.root.visible = false;
    this.route.root.visible = false;
    // soft backing so the control reads against any background
    this.g.circle(cx, cy, 34).fill({ color: 0x05070d, alpha: 0.45 });

    let title = '';
    let sub = '';
    switch (kind) {
      case 'wheel': {
        this.radius = 30;
        this.wheel.visible = true;
        this.wheel.position.set(cx, cy);
        this.wheel.rotation = this.value * WHEEL_TURNS;
        // rudder gauge under the wheel
        const gx = cx - 24;
        const gy = cy + 33;
        this.g.rect(gx - 1, gy - 1, 50, 5).fill(0x2c3a4c);
        this.g.rect(gx, gy, 48, 3).fill(0x0b1018);
        this.g.rect(cx, gy - 1, 1, 5).fill(0x6cc070);
        this.g.rect(cx + Math.round(this.value * 23) - 1, gy - 1, 3, 5).fill(0xe0b860);
        // course error (green = on course)
        const err = Math.max(-1, Math.min(1, state.ship.heading));
        this.g.rect(cx + Math.round(err * 23), gy + 5, 1, 2).fill(Math.abs(state.ship.heading) > 0.35 ? 0xe8584a : 0x6cc070);
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
        // water level of the hold + stroke count
        const comp = state.compartments[1];
        const frac = comp ? Math.min(1, comp.volume / 40) : 0;
        this.g.rect(cx + 22, cy - 18, 6, 38).fill(0x2c3a4c);
        this.g.rect(cx + 23, cy - 17, 4, 36).fill(0x0b1018);
        const h = Math.round(36 * frac);
        if (h > 0) this.g.rect(cx + 23, cy + 19 - h, 4, h).fill(frac > 0.5 ? 0xe8584a : 0x3d86d6);
        title = 'PUMPE';
        sub = this.drag ? `HUB ${st.aux}` : 'HEBEL AUF UND AB / A-D';
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
        this.radius = 28;
        this.dial.visible = true;
        this.needle.visible = true;
        this.dial.position.set(cx, cy);
        this.needle.position.set(cx, cy);
        this.needle.rotation = this.value + this.roll;
        title = kind === 'searchlight' ? 'SCHEINWERFER' : 'KANONE';
        if (kind === 'searchlight') sub = this.drag ? '' : st.charge <= 0 ? 'KEIN ÖL! ÖLKANNE HOLEN' : 'RICHTUNG ZEIGEN / A-D';
        else sub = this.drag ? '' : st.charge < 2 ? 'LADEN ...' : 'ZIELEN, F = FEUER!';
        // load bar (cannon) / oil gauge (searchlight) under the dial
        const frac = kind === 'cannon' ? Math.min(1, st.charge / 2) : st.charge;
        this.g.rect(cx - 20, cy + 32, 40, 3).fill(0x2c3a4c);
        const full = kind === 'cannon' ? frac >= 1 : frac > 0.25;
        this.g.rect(cx - 20, cy + 32, Math.round(40 * frac), 3).fill(full ? 0x6cc070 : kind === 'cannon' ? 0xe0b860 : 0xe8584a);
        break;
      }
      case 'table': {
        this.radius = 90;
        this.g.clear();
        this.route.root.visible = true;
        this.route.draw(state.campaign, cx - 100, cy - 70, 200, 104, this.time, 'SEEKARTE DER FAHRT');
        title = 'KARTENTISCH';
        if (state.status === 'harbor') sub = `ROUTE WÄHLEN: A/D ODER ZEIGEN · F = ABLEGEN (${Math.ceil(state.statusTimer)})`;
        else sub = state.campaign.nodes.length ? 'UNTERWEGS - IM HAFEN WÄHLT IHR HIER DIE ROUTE' : '';
        break;
      }
      case 'ring': {
        this.radius = 30;
        title = 'RETTUNGSRING';
        if (this.pulling) {
          // hand over hand: the line between the hands
          const hx = cx + Math.round(st.charge * 16);
          this.g.rect(cx - 30, cy, 60, 1).fill(0xd8c8a0);
          this.g.rect(hx - 3, cy - 4, 6, 8).fill(0xe0b090);
          this.g.rect(hx - 2, cy - 3, 4, 6).fill(0xc89878);
          const held = state.ring?.holder !== null;
          sub = held ? 'EINHOLEN: HIN UND HER / A-D' : 'NIEMAND DRAN - F = EINHOLEN';
        } else {
          this.dial.visible = true;
          this.needle.visible = true;
          this.dial.position.set(cx, cy);
          this.needle.position.set(cx, cy);
          this.needle.rotation = this.value + this.roll;
          sub = state.ring ? 'FLIEGT ...' : this.drag ? '' : 'ZIELEN, F = WERFEN!';
        }
        break;
      }
      default:
        break;
    }
    if (this.diorama) {
      // the scene shows the station itself: only the texts stay, near the bottom
      this.g.clear();
      for (const sp of [this.wheel, this.dial, this.needle, this.pump, this.lever]) sp.visible = false;
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
    this.title.position.set(Math.round(cx - this.title.textWidth / 2), big ? cy - 80 : cy - 44);
    this.sub.text = sub;
    this.sub.position.set(Math.round(cx - this.sub.textWidth / 2), big ? cy + 37 : cy - 37);
    this.sub.visible = sub.length > 0;
  }
}
