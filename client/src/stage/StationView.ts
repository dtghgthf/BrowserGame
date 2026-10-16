import { Rectangle, RenderTexture, Texture } from 'pixi.js';
import {
  OBJECT_SPECS,
  PIXELS_PER_METER,
  PLAYER_HALF_HEIGHT,
  TileKind,
  compartmentAtLocal,
  shipToWorld,
  tileToLocal,
  type GameEvent,
  type GameState,
  type ObjectState,
  type PlayerState,
  type ShipLayout,
  type Simulation,
  type StationKind,
} from '@lw/shared';
import { animFrame, frameOf, type ImageLayer, type Sheet, type SheetFrame } from '../render/assets';
import type { GameRenderer } from '../render/GameRenderer';
import type { LightSystem } from '../render/lighting/LightSystem';
import { PLAYER_COLORS, objectFrame } from '../render/ShipView';
import type { Snapshot } from '../game/snapshot';
import type { PixelFont } from '../ui/PixelFont';
import { RouteMap } from '../ui/RouteMap';
import { SeaChart } from '../ui/SeaChart';
import type { DioramaInput, DragGeometry } from '../ui/StationWidget';
import { easeInOut, type Vec3 } from './Camera25';
import { facing, type Card } from './Card';
import { BACK_Z, ShipSet } from './ShipSet';
import { Stage } from './Stage';
import {
  buildCannon,
  buildBarrel,
  buildCrate,
  buildGeneric,
  buildPump,
  buildRing,
  buildSearchlight,
  buildTable,
  buildWheel,
  buildWorkshop,
  type CrateScene,
  type SceneContext,
  type StationScene,
} from './scenes/stationScenes';

const PPM = PIXELS_PER_METER;
/** Seconds of the camera move into / out of the scene. */
const MOVE = 0.65;
/** Half width of the set around the station (m). */
const HALF = 7;
const CHART_SIZE = 64;
const ROUTE_W = 200;
const ROUTE_H = 104;

type Focus = { kind: 'station'; id: number } | { kind: 'crate'; id: number };

/** Front-facing pose per station (sprite tags of the player sheet). */
const STATION_POSE: Partial<Record<StationKind, string>> = {
  wheel: 'front_wheel',
  pump: 'front_pump',
  searchlight: 'front_crank',
  cannon: 'front_push',
  workshop: 'front_push',
  table: 'front_lean',
  ring: 'front_pump',
};

interface PlayerCards {
  body: Card;
  coat: Card;
  z: number;
  /** Work clock of the station pose: runs while the station moves. */
  work: number;
  last: number;
}


/**
 * The 2.5D station view: when the own player takes a station (or opens a
 * crate), the 2D ship dissolves into a set built from the ship layout - back
 * wall, floor, ceiling and the cut front edge as cards - with the station's
 * detailed props, the players on depth lanes in front of / behind it and
 * planar shadows; the camera swings in from the exact 2D view. Leaving the
 * station plays it backwards.
 */
export class StationView {
  readonly stage: Stage;
  private focus: Focus | null = null;
  /** The own player (operator of the set). */
  private owner = '';
  private scene: StationScene | null = null;
  private t = 0;
  private time = 0;
  private readonly players = new Map<string, PlayerCards>();
  private readonly objects = new Map<number, Card>();
  /** The whole ship around the station. */
  private set: ShipSet | null = null;
  /** Lantern of the station's room (lights the scene), index into the set's lanterns. */
  private lantern = -1;
  private readonly chartRT = RenderTexture.create({ width: CHART_SIZE, height: CHART_SIZE, resolution: 1, scaleMode: 'nearest' });
  private readonly routeRT = RenderTexture.create({ width: ROUTE_W, height: ROUTE_H, resolution: 1, scaleMode: 'nearest' });
  /** Off = always the 2D view (menu option / low quality). */
  enabled = true;
  /** Region of the set (ship-local m). */
  private region = { cx: 0, x0: 0, x1: 0, floor: 0, ceil: 0 as number | null, interior: true };
  /** Seconds the crate set stays after the crate was opened (to see the loot). */
  private hold = 0;
  private readonly chart: SeaChart;
  private readonly route: RouteMap;

  constructor(
    private readonly r: GameRenderer,
    lights: LightSystem,
    private readonly sim: Simulation,
    private readonly assets: { hull: ImageLayer; back: ImageLayer; player: Sheet; props: Sheet },
    font: PixelFont,
  ) {
    this.stage = new Stage(r, lights);
    // own instances, drawn into render textures (not part of any scene graph)
    this.chart = new SeaChart(font);
    this.route = new RouteMap(assets.props, font);
  }

  /** Where dragging controls the station in the scene (null = use the 2D widget). */
  control(): DioramaInput | null {
    const sc = this.scene;
    if (!sc || !sc.control || this.t < MOVE * 0.6) return null;
    const c = this.stage.toScreen(sc.control);
    const e = this.stage.toScreen({ x: sc.control.x + sc.controlRadius, y: sc.control.y, z: sc.control.z });
    if (!c || !e) return null;
    const radius = Math.max(8, Math.hypot(e.x - c.x, e.y - c.y));
    let geometry: DragGeometry | null = null;
    const d = sc.drag;
    if (d?.mode === 'linear') {
      // the prop's movement per unit of value, on screen
      const b = this.stage.toScreen({ x: sc.control.x + d.axis.x, y: sc.control.y + d.axis.y, z: sc.control.z + d.axis.z });
      if (b) geometry = { mode: 'linear', axis: { x: b.x - c.x, y: b.y - c.y } };
    } else if (d) {
      const p = d.pivot ? this.stage.toScreen(d.pivot) : c;
      if (p) geometry = { mode: d.mode, pivot: { x: p.x, y: p.y }, perUnit: d.perUnit };
    }
    const aim = sc.aim ? this.stage.toScreen(sc.aim) : null;
    return { center: c, radius, scale: radius / sc.controlRadius, geometry, aim: aim ? { x: aim.x, y: aim.y } : null };
  }

  /** A station's 2.5D scene is coming up or shown: the 2D controls stay hidden meanwhile. */
  get takingOver(): boolean {
    return this.scene !== null && this.focus?.kind === 'station';
  }

  /** Screen px of a ship-local point in the scene (for labels), null if not shown. */
  projectShip(x: number, y: number, z = 0.2): { x: number; y: number } | null {
    if (this.stage.camera && this.active) return this.stage.toScreen({ x, y, z });
    return null;
  }

  /** The scene is (at least partly) shown. */
  get active(): boolean {
    return this.stage.active;
  }

  private frame(name: string): SheetFrame {
    return frameOf(this.assets.props, name);
  }

  /** What the own player is doing that deserves the 2.5D view. */
  private wanted(state: GameState, me: PlayerState | undefined): Focus | null {
    if (!this.enabled || !me || me.overboard > 0) return null;
    if (me.station !== null) {
      const st = state.stations[me.station];
      // the life ring stays in 2D: catching swimmers needs the wide view of the sea behind the ship
      if (st && st.kind !== 'rack' && st.kind !== 'ring') return { kind: 'station', id: st.id };
    }
    if (me.action?.kind === 'open' || me.action?.kind === 'tap') return { kind: 'crate', id: me.action.target };
    return null;
  }

  update(state: GameState, view: Snapshot, localId: string | undefined, dt: number): void {
    this.time += dt;
    const me = state.players.find((p) => p.id === localId);
    this.hold = Math.max(0, this.hold - dt);
    let want = this.wanted(state, me);
    if (!want && this.hold > 0 && this.focus?.kind === 'crate') want = this.focus;
    const same = (a: Focus | null, b: Focus | null) => !!a && !!b && a.kind === b.kind && a.id === b.id;
    if (want && !same(want, this.focus)) {
      // a new target: build its set (straight away if nothing is shown yet)
      if (!this.focus || this.t <= 0) {
        this.build(state, want, localId);
        this.t = 0;
      } else if (this.focus.kind !== want.kind || this.focus.id !== want.id) {
        this.build(state, want, localId);
      }
    }
    if (want && this.scene) this.t = Math.min(MOVE, this.t + dt);
    else this.t = Math.max(0, this.t - dt);
    if (this.t <= 0 && !want) {
      if (this.focus) this.teardown();
      this.stage.setAlpha(0);
      return;
    }
    const sc = this.scene;
    if (!sc) return;
    const k = easeInOut(this.t / MOVE);
    this.stage.setAlpha(Math.min(1, k * 1.8));

    // camera: from the exact 2D picture (yaw 0, 16 px/m, where the target is on screen) to the framed station
    const cam = this.stage.camera;
    const W = this.r.layout.width;
    const H = this.r.layout.height;
    cam.roll = view.ship.roll;
    cam.rollPivot = { x: 0, y: 0, z: 0 };
    cam.baseDistance = 12;
    cam.pxPerMeter = PPM;
    const rolled = cam.rolled(sc.target);
    cam.target = rolled;
    const w2d = shipToWorld(view.ship, sc.target);
    const sx = w2d.x * PPM - this.r.viewLeft;
    const sy = w2d.y * PPM - this.r.viewTop;
    cam.cx = sx + (W / 2 - sx) * k;
    cam.cy = sy + (H * 0.47 - sy) * k;
    cam.yaw = sc.yaw * k;
    cam.pitch = sc.pitch * k;
    cam.distance = 12 + (sc.distance - 12) * k;
    cam.update();

    this.redrawTextures(state);
    sc.update(state, view, dt, this.time);
    this.set?.update(state, view, cam, this.time, dt);
    this.updateActors(state, view, dt, cam.yaw);
    this.updateLights(state, sc);
    this.stage.bounds.x = 0;
    this.stage.bounds.y = 0;
    this.stage.bounds.w = W;
    this.stage.bounds.h = H;
    this.stage.interior = this.region.interior;
    this.stage.update();
  }

  /** Events that the set reacts to (the loot of the crate being opened). */
  event(e: GameEvent): void {
    if (e.type === 'crateOpen' && this.focus?.kind === 'crate' && this.focus.id === e.object && this.scene) {
      (this.scene as CrateScene).spill(e.loot);
      // keep the scene up a moment so the loot can be seen
      this.hold = 1.8;
    }
  }

  // ---------------------------------------------------------------- building

  private teardown(): void {
    this.stage.clear();
    this.players.clear();
    this.objects.clear();
    this.set = null;
    this.lantern = -1;
    this.scene = null;
    this.focus = null;
  }

  private build(state: GameState, focus: Focus, localId: string | undefined): void {
    this.teardown();
    const L = this.sim.layout;
    let x: number;
    let feetY: number;
    let crate: ObjectState | undefined;
    if (focus.kind === 'station') {
      const st = state.stations[focus.id]!;
      x = st.x;
      feetY = st.y;
    } else {
      crate = state.objects.find((o) => o.id === focus.id);
      if (!crate) return;
      x = crate.x;
      feetY = crate.y + OBJECT_SPECS[crate.kind].hy;
    }
    this.region = this.measure(L, x, feetY);
    this.focus = focus;
    this.owner = localId ?? '';
    this.buildRoom(L, state, focus.kind === 'station' ? focus.id : null);
    const ctx: SceneContext = {
      stage: this.stage,
      props: this.assets.props,
      frame: (n) => this.frame(n),
      floorY: this.region.floor,
      chart: this.rtFrame(this.chartRT, CHART_SIZE, CHART_SIZE),
      route: this.rtFrame(this.routeRT, ROUTE_W, ROUTE_H),
    };
    if (focus.kind === 'station') {
      const st = state.stations[focus.id]!;
      switch (st.kind) {
        case 'wheel':
          this.scene = buildWheel(ctx, st);
          break;
        case 'pump':
          this.scene = buildPump(ctx, st);
          break;
        case 'searchlight':
          this.scene = buildSearchlight(ctx, st);
          break;
        case 'cannon':
          this.scene = buildCannon(ctx, st);
          break;
        case 'workshop':
          this.scene = buildWorkshop(ctx, st);
          break;
        case 'table':
          this.scene = buildTable(ctx, st);
          break;
        case 'ring':
          this.scene = buildRing(ctx, st);
          break;
        default:
          this.scene = buildGeneric(ctx, st, 'helm');
      }
    } else if (crate?.kind === 'barrel') {
      const id = localId;
      this.scene = buildBarrel(ctx, crate, () => state.players.find((p) => p.id === id)?.action?.progress ?? 0, this.sim.actionDuration('tap'));
    } else if (crate) {
      const id = localId;
      this.scene = buildCrate(
        ctx,
        crate,
        () => state.players.find((p) => p.id === id)?.action?.progress ?? 0,
        this.sim.actionDuration('open'),
      );
    }
    this.stage.shadowLight = this.scene?.lamp ?? null;
    this.stage.floorY = this.region.floor;
    this.stage.backZ = BACK_Z;
  }

  /** Floor, ceiling and the extent of the room around a point (stops at walls). */
  private measure(L: ShipLayout, x: number, feetY: number) {
    const t = { x: x / L.tileSize + L.origin.x, y: feetY / L.tileSize + L.origin.y };
    const tx = Math.floor(t.x);
    const floorTy = Math.round(t.y);
    const interior = compartmentAtLocal(L, x, feetY - 0.3) >= 0;
    const solid = (cx: number, cy: number) => {
      if (cx < 0 || cy < 0 || cx >= L.width || cy >= L.height) return false;
      const k = L.tiles[cy * L.width + cx];
      return k === TileKind.Solid || k === TileKind.Hatch;
    };
    let ceil: number | null = null;
    if (interior) {
      for (let ty = floorTy - 1; ty > 0; ty--) {
        if (solid(tx, ty)) {
          ceil = ty + 1;
          break;
        }
      }
    }
    // the set reaches as far as the floor goes (walls, the edge of the crow's nest), at most HALF m
    const walkable = (cx: number) => !solid(cx, floorTy - 1) && solid(cx, floorTy);
    let x0 = tx;
    while (x0 > Math.max(0, tx - HALF * 2) && walkable(x0 - 1)) x0--;
    let x1 = tx + 1;
    while (x1 < Math.min(L.width, tx + HALF * 2) && walkable(x1)) x1++;
    x0 = Math.max(0, x0 - 1);
    x1 = Math.min(L.width, x1 + 1);
    return {
      /** The point the set is built around. */
      cx: x,
      x0: tileToLocal(L, x0, 0).x,
      x1: tileToLocal(L, x1, 0).x,
      floor: tileToLocal(L, 0, floorTy).y,
      ceil: ceil !== null ? tileToLocal(L, 0, ceil).y : null,
      interior,
    };
  }

  private rtFrame(rt: RenderTexture, w: number, h: number): SheetFrame {
    return { name: 'rt', texture: rt, normal: null, layers: {}, width: w, height: h, pivot: { x: w / 2, y: h / 2 }, duration: 100 };
  }

  /** The whole ship around the station; the lantern of the station's room lights the scene. */
  private buildRoom(L: ShipLayout, state: GameState, focusStation: number | null): void {
    const rg = this.region;
    const set = new ShipSet(this.stage, L, this.assets, state, focusStation, this.sim.waterGeometry);
    this.set = set;
    set.room = { x0: rg.x0, x1: rg.x1, top: rg.ceil ?? rg.floor - 4, bottom: rg.floor };
    this.stage.maskPainter = (g) => set.paintMask(g, this.stage.camera);
    if (!rg.interior) return;
    const extra = state.campaign.upgrades.includes('lantern');
    let best = -1;
    set.lanterns.forEach((l, i) => {
      if ((l.optional && !extra) || l.x < rg.x0 || l.x > rg.x1) return;
      if (rg.ceil !== null && Math.abs(l.y - rg.ceil) > 1.2) return;
      if (best < 0 || Math.abs(l.x - rg.cx) < Math.abs(set.lanterns[best]!.x - rg.cx)) best = i;
    });
    this.lantern = best;
  }

  // ---------------------------------------------------------------- per frame

  private redrawTextures(state: GameState): void {
    const renderer = this.r.renderer;
    const kind = this.focus?.kind === 'station' ? state.stations[this.focus.id]?.kind : undefined;
    // the sea chart pinned next to the helm, the route map on the chart table
    if (kind === 'wheel') {
      this.chart.draw(state, this.sim.tuning, 0, 0, CHART_SIZE, CHART_SIZE, this.time);
      renderer.render({ container: this.chart.root, target: this.chartRT, clear: true, clearColor: [0, 0, 0, 0] });
    } else if (kind === 'table') {
      this.route.draw(state.campaign, 0, 0, ROUTE_W, ROUTE_H, this.time, 'SEEKARTE DER FAHRT');
      renderer.render({ container: this.route.root, target: this.routeRT, clear: true, clearColor: [0, 0, 0, 0] });
    }
  }

  /** The front-facing pose of someone working the station / crate in view (null = the normal side view). */
  private poseFor(state: GameState, p: PlayerState): string | null {
    if (this.focus?.kind === 'crate') {
      if (p.action?.kind === 'open') return 'front_pry';
      if (p.action?.kind === 'tap') return 'front_crank';
      return null;
    }
    const st = this.focus ? state.stations[this.focus.id] : undefined;
    if (!st || p.anim !== 'station') return null;
    return STATION_POSE[st.kind] ?? null;
  }

  /** The pump pose follows the handle: hands high, middle, low. */
  private pumpFrame(v: number): SheetFrame {
    const t = this.assets.player.tags.get('front_pump');
    if (!t) return animFrame(this.assets.player, 'station', 0);
    const i = v > 0.35 ? 0 : v < -0.35 ? 2 : 1;
    return this.assets.player.frames[Math.min(t.to, t.from + i)]!;
  }

  /** Players and loose objects of the room as cards on their depth lanes. */
  private updateActors(state: GameState, view: Snapshot, dt: number, yaw: number): void {
    const rg = this.region;
    const sc = this.scene!;
    const face = facing(yaw * 0.6);
    const seen = new Set<string>();
    for (const p of state.players) {
      if (p.overboard > 0) continue;
      const v = view.players.get(p.id) ?? p;
      const feet = v.y + PLAYER_HALF_HEIGHT;
      seen.add(p.id);
      let pc = this.players.get(p.id);
      if (!pc) {
        const f0 = this.assets.player.frames[0]!;
        const body = this.stage.add(f0, 'cards', 16);
        const coatFrame: SheetFrame = { ...f0, texture: f0.layers.coat ?? f0.texture, normal: null };
        const coat = this.stage.add(coatFrame, 'cards', 16);
        coat.tint = PLAYER_COLORS[p.color % PLAYER_COLORS.length]!;
        coat.bias = 0.002;
        this.stage.shadow(body, f0);
        pc = { body, coat, z: 0, work: 0, last: 0 };
        this.players.set(p.id, pc);
      }
      // the operator stands at the station, everybody else walks in front of or behind it
      const operating = this.focus?.kind === 'station' ? p.station === this.focus.id : p.id === this.owner;
      // a helper at the wheel stands a step behind the helmsman
      const helping = this.focus?.kind === 'station' && state.stations[this.focus.id]?.helper === p.id;
      const lane = helping ? sc.operatorZ - 0.55 : operating ? sc.operatorZ : p.facing < 0 ? 0.85 : -0.85;
      pc.z += (lane - pc.z) * Math.min(1, dt * 4);
      const pose = operating || helping ? this.poseFor(state, p) : null;
      let frame = animFrame(this.assets.player, p.anim === 'station' ? 'station' : p.anim, p.animTime);
      if (pose) {
        // the pose animates while the station is worked (the wheel turns, the saw moves)
        const st = this.focus?.kind === 'station' ? state.stations[this.focus.id] : undefined;
        const v = st ? (view.stations[st.id]?.value ?? st.value) : 0;
        const moving = Math.abs(v - pc.last) > 0.002 || pose === 'front_lean' || this.focus?.kind === 'crate';
        pc.last = v;
        if (moving) pc.work += dt;
        frame = pose === 'front_pump' ? this.pumpFrame(v) : animFrame(this.assets.player, pose, pc.work);
      }
      pc.body.setFrame(frame);
      pc.coat.setTexture(frame.layers.coat ?? frame.texture, frame.width, frame.height, frame.pivot.x, frame.pivot.y);
      // somebody in another room hides behind the floors and walls between
      const order = this.set?.orderFor(v.x, feet, 0.8, 1.4) ?? null;
      for (const c of [pc.body, pc.coat]) {
        c.pos = { x: v.x, y: feet + 1 / 16, z: pc.z };
        c.u = face.u;
        c.v = face.v;
        c.scaleX = pose ? 1 : p.facing;
        c.alpha = p.away ? 0.45 : 1;
      }
      pc.body.order = order;
      pc.coat.order = order === null ? null : order + 0.01;
    }
    for (const [id, pc] of this.players) {
      if (seen.has(id)) continue;
      pc.body.visible = false;
      pc.coat.visible = false;
    }
    for (const id of seen) {
      const pc = this.players.get(id)!;
      pc.body.visible = true;
      pc.coat.visible = true;
    }
    // loose objects lying around (not the crate being opened: it is part of the set)
    const seenO = new Set<number>();
    for (const o of state.objects) {
      if (this.focus?.kind === 'crate' && o.id === this.focus.id) continue;
      // close-ups of a crate / barrel keep the space right next to it clear
      if (this.focus?.kind === 'crate' && !o.carriedBy && Math.abs(o.x - this.region.cx) < 1.3) continue;
      const v = view.objects.get(o.id) ?? o;
      seenO.add(o.id);
      let c = this.objects.get(o.id);
      const name = objectFrame(o);
      if (!c) {
        c = this.stage.add(this.frame(name), 'cards', 16);
        this.stage.shadow(c, this.frame(name));
        this.objects.set(o.id, c);
      }
      c.setFrame(this.frame(name));
      // each object gets its own depth from its id, carried ones go with the carrier
      const z = o.carriedBy ? (this.players.get(o.carriedBy)?.z ?? 0) + 0.05 : ((o.id * 0.37) % 1) * 1.2 - 0.3;
      c.pos = { x: v.x, y: v.y, z };
      c.u = face.u;
      c.v = face.v;
      c.rotation = o.carriedBy ? 0 : v.angle;
      c.order = this.set?.orderFor(v.x, v.y + OBJECT_SPECS[o.kind].hy, 0.8, 0.8) ?? null;
      if (c.order !== null && o.carriedBy) c.order += 0.02;
      c.visible = true;
    }
    for (const [id, c] of this.objects) if (!seenO.has(id)) c.visible = false;
  }

  private updateLights(state: GameState, sc: StationScene): void {
    const flick = 0.9 + 0.06 * Math.sin(this.time * 9) + 0.04 * Math.sin(this.time * 23);
    const lantern = this.lantern >= 0 ? this.set?.lanterns[this.lantern] : undefined;
    if (lantern) {
      const lp = lantern.card.pointAt(3, 7);
      this.stage.placeLight(0, { ...lp, z: 0.4 }, [1, 0.66, 0.34], 1.7 * flick, 150);
      this.stage.shadowLight = { ...lp, z: 0.4 };
    } else if (sc.lamp) {
      // on deck: moonlight from above, or the scene's own lamp
      this.stage.placeLight(0, sc.lamp, this.region.interior ? [1, 0.7, 0.4] : [0.55, 0.62, 0.8], this.region.interior ? 1.5 * flick : 0.7, 170);
      this.stage.shadowLight = sc.lamp;
    }
    if (this.focus?.kind === 'station' && state.stations[this.focus.id]?.kind === 'table' && sc.lamp) {
      this.stage.placeLight(1, sc.lamp, [1, 0.78, 0.45], 1.4 * flick, 130);
    }
    // a soft warm fill from the side of the camera, so the station reads in a dark hold
    if (this.region.interior) {
      const cam = this.stage.camera;
      this.stage.placeLight(2, { x: sc.target.x + Math.sin(cam.yaw) * 2, y: sc.target.y - 0.6, z: 1.1 }, [1, 0.75, 0.5], 0.9, 240);
    } else if (sc.lamp) {
      this.stage.placeLight(2, { x: sc.target.x - 1.5, y: sc.target.y - 2, z: 1.5 }, [0.6, 0.68, 0.85], 0.6, 260);
    }
  }
}
