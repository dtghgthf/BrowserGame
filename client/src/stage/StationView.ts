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
} from '@lw/shared';
import { animFrame, frameOf, type ImageLayer, type Sheet, type SheetFrame } from '../render/assets';
import type { GameRenderer } from '../render/GameRenderer';
import type { LightSystem } from '../render/lighting/LightSystem';
import { PLAYER_COLORS } from '../render/ShipView';
import type { Snapshot } from '../game/snapshot';
import type { PixelFont } from '../ui/PixelFont';
import { RouteMap } from '../ui/RouteMap';
import { SeaChart } from '../ui/SeaChart';
import { easeInOut, type Vec3 } from './Camera25';
import { facing, type Card } from './Card';
import { Stage } from './Stage';
import {
  buildCannon,
  buildCrate,
  buildGeneric,
  buildPump,
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
/** Depth of the back wall and of the open (cut) front of the set. */
const BACK_Z = -1.6;
const FRONT_Z = 1.3;
/** Half width of the set around the station (m). */
const HALF = 7;
const CHART_SIZE = 64;
const ROUTE_W = 200;
const ROUTE_H = 104;

type Focus = { kind: 'station'; id: number } | { kind: 'crate'; id: number };

interface PlayerCards {
  body: Card;
  coat: Card;
  z: number;
}

export interface DioramaControl {
  /** Screen px of the drag centre and its radius / scale (px per meter at the control). */
  center: { x: number; y: number };
  radius: number;
  scale: number;
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
  private lantern: Card | null = null;
  private lanternFlame: Card | null = null;
  private readonly chartRT = RenderTexture.create({ width: CHART_SIZE, height: CHART_SIZE, resolution: 1, scaleMode: 'nearest' });
  private readonly routeRT = RenderTexture.create({ width: ROUTE_W, height: ROUTE_H, resolution: 1, scaleMode: 'nearest' });
  /** Off = always the 2D view (menu option / low quality). */
  enabled = true;
  /** Region of the set (ship-local m). */
  private region = { x0: 0, x1: 0, floor: 0, ceil: 0 as number | null, interior: true };
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
  control(): DioramaControl | null {
    const sc = this.scene;
    if (!sc || !sc.control || this.t < MOVE * 0.6) return null;
    const c = this.stage.toScreen(sc.control);
    const e = this.stage.toScreen({ x: sc.control.x + sc.controlRadius, y: sc.control.y, z: sc.control.z });
    if (!c || !e) return null;
    const radius = Math.max(8, Math.hypot(e.x - c.x, e.y - c.y));
    return { center: c, radius, scale: radius / sc.controlRadius };
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
      if (st && st.kind !== 'rack') return { kind: 'station', id: st.id };
    }
    if (me.action?.kind === 'open') return { kind: 'crate', id: me.action.target };
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
    this.lantern = null;
    this.lanternFlame = null;
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
    this.buildRoom(L);
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
        default:
          this.scene = buildGeneric(ctx, st, st.kind === 'ring' ? 'ring_post' : 'helm');
      }
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
      x0: tileToLocal(L, x0, 0).x,
      x1: tileToLocal(L, x1, 0).x,
      floor: tileToLocal(L, 0, floorTy).y,
      ceil: ceil !== null ? tileToLocal(L, 0, ceil).y : null,
      interior,
    };
  }

  /** A frame cut out of a big image layer (ship hull / back wall), in tiles. */
  private crop(layer: ImageLayer, tx0: number, ty0: number, tx1: number, ty1: number, normal = true): SheetFrame {
    const T = 8;
    const rect = new Rectangle(tx0 * T, ty0 * T, (tx1 - tx0) * T, (ty1 - ty0) * T);
    const tex = new Texture({ source: layer.texture.source, frame: rect });
    const n = normal && layer.normal ? new Texture({ source: layer.normal.source, frame: rect.clone() }) : null;
    return { name: 'crop', texture: tex, normal: n, layers: {}, width: rect.width, height: rect.height, pivot: { x: 0, y: 0 }, duration: 100 };
  }

  private rtFrame(rt: RenderTexture, w: number, h: number): SheetFrame {
    return { name: 'rt', texture: rt, normal: null, layers: {}, width: w, height: h, pivot: { x: w / 2, y: h / 2 }, duration: 100 };
  }

  /** The room: back wall, floor, ceiling, the cut front edge and the lantern. */
  private buildRoom(L: ShipLayout): void {
    const rg = this.region;
    const tx0 = Math.round(rg.x0 / L.tileSize + L.origin.x);
    const tx1 = Math.round(rg.x1 / L.tileSize + L.origin.x);
    const floorTy = Math.round(rg.floor / L.tileSize + L.origin.y);
    const topTy = rg.ceil !== null ? Math.round(rg.ceil / L.tileSize + L.origin.y) - 1 : Math.max(0, floorTy - 14);
    const at = (tx: number, ty: number): Vec3 => ({ ...tileToLocal(L, tx, ty), z: 0 });

    if (rg.interior) {
      // back wall (the 2D background art of this room)
      const back = this.stage.add(this.crop(this.assets.back, tx0, topTy, tx1, floorTy + 1), 'back', 16);
      back.pos = { ...at(tx0, topTy), z: BACK_Z };
      // ceiling: dark planks over the room
      if (rg.ceil !== null) this.tile('st_ceiling', rg.x0, rg.x1, rg.ceil, 0.7);
    }
    // floor planks (the open deck is lighter wood)
    this.tile(rg.interior ? 'st_floor' : 'st_deck', rg.x0, rg.x1, rg.floor, 1);
    if (!rg.interior) {
      // the far railing on the other side of the deck
      const far = this.stage.add(this.crop(this.assets.hull, tx0, topTy, tx1, floorTy + 2), 'back', 16);
      far.pos = { ...at(tx0, topTy), z: BACK_Z };
      far.tint = 0x8a96a8;
    }
    // inside: the cut front edge - the hull art of this room as the open front of a doll's house
    if (rg.interior) {
      const front = this.stage.add(this.crop(this.assets.hull, tx0, topTy, tx1, floorTy + 2), 'cards', 16);
      front.pos = { ...at(tx0, topTy), z: FRONT_Z };
      front.bias = -10;
    }
    // the nearest lantern of the room
    let best: { tx: number; ty: number } | null = null;
    for (const m of L.markers) {
      if (m.type !== 'lantern' || m.tx < tx0 || m.tx > tx1) continue;
      if (rg.ceil !== null && Math.abs(tileToLocal(L, 0, m.ty).y - rg.ceil) > 1.2) continue;
      if (!best || Math.abs(m.tx - (tx0 + tx1) / 2) < Math.abs(best.tx - (tx0 + tx1) / 2)) best = m;
    }
    if (best && rg.interior) {
      const p = tileToLocal(L, best.tx + 0.5, best.ty);
      this.lantern = this.stage.add(this.frame('lantern'), 'cards', 12);
      this.lantern.pos = { x: p.x, y: p.y, z: 0.4 };
      this.lanternFlame = this.stage.add(this.frame('lantern_flame'), 'cards', 12, 'unlit');
      this.lanternFlame.pos = { x: p.x, y: p.y, z: 0.41 };
    }
  }

  /** Floor / ceiling planks from x0 to x1 at height y, from the back wall to the open front. */
  private tile(name: string, x0: number, x1: number, y: number, shade: number): void {
    const f = this.frame(name);
    const w = f.width / 32;
    const depth = FRONT_Z - BACK_Z;
    for (let x = x0; x < x1; x += w) {
      const c = this.stage.add(f, 'back', 32);
      c.pos = { x, y, z: BACK_Z };
      c.u = { x: 1, y: 0, z: 0 };
      c.v = { x: 0, y: 0, z: 1 };
      c.scaleY = depth / (f.height / 32);
      c.tint = shade < 1 ? 0x9a9a9a : 0xffffff;
    }
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
      if (v.x < rg.x0 - 0.5 || v.x > rg.x1 + 0.5 || Math.abs(feet - rg.floor) > 1.6) continue;
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
        pc = { body, coat, z: 0 };
        this.players.set(p.id, pc);
      }
      // the operator stands at the station, everybody else walks in front of or behind it
      const operating = this.focus?.kind === 'station' ? p.station === this.focus.id : p.id === this.owner;
      const lane = operating ? sc.operatorZ : p.facing < 0 ? 0.85 : -0.85;
      pc.z += (lane - pc.z) * Math.min(1, dt * 4);
      const frame = animFrame(this.assets.player, p.anim === 'station' ? 'station' : p.anim, p.animTime);
      pc.body.setFrame(frame);
      pc.coat.setTexture(frame.layers.coat ?? frame.texture, frame.width, frame.height, frame.pivot.x, frame.pivot.y);
      for (const c of [pc.body, pc.coat]) {
        c.pos = { x: v.x, y: feet + 1 / 16, z: pc.z };
        c.u = face.u;
        c.v = face.v;
        c.scaleX = p.facing;
        c.alpha = p.away ? 0.45 : 1;
      }
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
      const v = view.objects.get(o.id) ?? o;
      if (v.x < rg.x0 || v.x > rg.x1 || Math.abs(v.y - rg.floor) > 2.2) continue;
      seenO.add(o.id);
      let c = this.objects.get(o.id);
      const name = o.kind === 'crate' && o.opened ? 'crate_open' : o.kind === 'bucket' && o.fill > 0 ? 'bucket_full' : o.kind;
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
      c.visible = true;
    }
    for (const [id, c] of this.objects) if (!seenO.has(id)) c.visible = false;
  }

  private updateLights(state: GameState, sc: StationScene): void {
    const flick = 0.9 + 0.06 * Math.sin(this.time * 9) + 0.04 * Math.sin(this.time * 23);
    if (this.lantern && this.lanternFlame) {
      // the lantern swings with the apparent gravity
      const g = state.ship.gravity;
      const ang = -Math.atan2(g.x, g.y) * 0.8;
      this.lantern.rotation = ang;
      this.lanternFlame.rotation = ang;
      const lp = this.lantern.pointAt(3, 7);
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
