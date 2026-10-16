import { CANNON_PIVOT, SEARCHLIGHT_PIVOT, type GameState, type ObjectState, type StationState } from '@lw/shared';
import type { Snapshot } from '../../game/snapshot';
import { frameOf, type Sheet, type SheetFrame } from '../../render/assets';
import type { Vec3 } from '../Camera25';
import { FLOOR_CARD, UP_CARD, type Card } from '../Card';
import type { Stage } from '../Stage';

/** Everything a scene builder needs. */
export interface SceneContext {
  stage: Stage;
  props: Sheet;
  frame(name: string): SheetFrame;
  /** Floor height (scene y = ship-local y) of the station / crate. */
  floorY: number;
  /** Render textures that are redrawn every frame (sea chart, route map). */
  chart: SheetFrame;
  route: SheetFrame;
}

/** A station's 2.5D set: camera framing, the drag control and an animator. */
export interface StationScene {
  target: Vec3;
  yaw: number;
  pitch: number;
  /** Final camera distance (the dolly zooms in from the 2D distance to this). */
  distance: number;
  /** Scene point the drag control is centred on (null = no drag control) and its radius (m). */
  control: Vec3 | null;
  controlRadius: number;
  /** Depth of the player operating the station. */
  operatorZ: number;
  /** Light hanging over the scene (scene point) - casts the shadows. */
  lamp: Vec3 | null;
  update(state: GameState, view: Snapshot, dt: number, time: number): void;
}

function card(ctx: SceneContext, name: string, at: Vec3, ppm = 32, layer: 'back' | 'cards' = 'cards', unlit = false): Card {
  const c = ctx.stage.add(ctx.frame(name), layer, ppm, unlit ? 'unlit' : 'lit');
  c.pos = { ...at };
  return c;
}

/** Lying flat (floor orientation), turned up by `tilt` radians around the x axis (0 = flat, PI/2 = standing). */
function tilted(c: Card, tilt: number): void {
  // flat: v = (0, 0, 1) (texture rows run to the front); standing: v = (0, 1, 0)
  c.u = { x: 1, y: 0, z: 0 };
  c.v = { x: 0, y: Math.sin(tilt), z: Math.cos(tilt) };
}

// ---------------------------------------------------------------- helm

export function buildWheel(ctx: SceneContext, st: StationState): StationScene {
  const f = ctx.floorY;
  const x = st.x + 0.5;
  const binnacle = card(ctx, 'st_binnacle', { x: x + 1.15, y: f, z: 0.15 });
  ctx.stage.shadow(binnacle, ctx.frame('st_binnacle'));
  const needle = card(ctx, 'st_needle', { x: x + 1.15, y: f - 1.15, z: 0.16 });
  needle.bias = 0.02;
  // the helm post and the big wheel (the 61 px UI wheel at ~1.25 m)
  const post = card(ctx, 'helm', { x, y: f, z: 0 }, 13);
  ctx.stage.shadow(post, ctx.frame('helm'));
  const wheel = card(ctx, 'ui_wheel', { x, y: f - 0.95, z: 0.06 }, 50);
  wheel.bias = 0.05;
  ctx.stage.shadow(wheel, ctx.frame('ui_wheel'));
  // the sea chart pinned to a board behind
  const board = card(ctx, 'st_board', { x: x - 1.25, y: f - 0.1, z: 0.35 }, 28);
  const chart = ctx.stage.add(ctx.chart, 'cards', 46);
  chart.pos = { x: x - 1.25, y: f - 0.88, z: 0.36 };
  chart.bias = 0.01;
  let compass = 0;
  return {
    target: { x: x + 0.1, y: f - 1.0, z: 0 },
    yaw: 0.38,
    pitch: 0.16,
    distance: 3.3,
    control: { x, y: f - 0.95, z: 0.06 },
    controlRadius: 0.62,
    operatorZ: -0.45,
    lamp: { x: x - 0.4, y: f - 2.6, z: 0.6 },
    update(state, view, dt) {
      const v = view.stations[st.id]?.value ?? st.value;
      wheel.rotation = v * Math.PI * 1.5;
      // the compass card swings in its gimbal and settles on the heading
      const want = -state.ship.heading * 2 + Math.sin(view.time * 1.3) * 0.15;
      compass += (want - compass) * Math.min(1, dt * 3);
      needle.rotation = compass;
      board.visible = chart.visible = true;
    },
  };
}

// ---------------------------------------------------------------- pump

/** Heat above which the pump runs hot (matches the default `pumpHotAt`; only the look depends on it). */
const PUMP_HOT = 0.8;

function mixTint(a: number, b: number, t: number): number {
  const ch = (sh: number) => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function buildPump(ctx: SceneContext, st: StationState): StationScene {
  const f = ctx.floorY;
  const x = st.x + 0.45;
  const body = card(ctx, 'ui_pump', { x, y: f, z: 0 }, 34);
  ctx.stage.shadow(body, ctx.frame('ui_pump'));
  const lever = card(ctx, 'ui_lever', { x, y: f - 1.15, z: 0.08 }, 34);
  lever.bias = 0.04;
  ctx.stage.shadow(lever, ctx.frame('ui_lever'));
  const pipe = card(ctx, 'st_pipe', { x: x + 0.95, y: f, z: -0.3 });
  const water = card(ctx, 'st_water', { x: x + 0.95, y: f - 0.09, z: -0.29 });
  water.bias = 0.01;
  const gauge = card(ctx, 'st_gauge', { x: x - 0.75, y: f - 1.05, z: -0.2 });
  const needle = card(ctx, 'st_gauge_needle', { x: x - 0.75, y: f - 1.05, z: -0.19 });
  needle.bias = 0.01;
  let pressure = 0;
  let last = 0;
  return {
    target: { x: x + 0.1, y: f - 0.85, z: 0 },
    yaw: -0.38,
    pitch: 0.14,
    distance: 4.0,
    control: { x, y: f - 1.15, z: 0.08 },
    controlRadius: 0.75,
    operatorZ: -0.4,
    lamp: { x: x + 0.6, y: f - 2.4, z: 0.7 },
    update(state, view, dt, time) {
      const v = view.stations[st.id]?.value ?? st.value;
      lever.rotation = v * 0.55;
      // the gauge shows how hot the pump runs (wear) and twitches with every stroke
      if (Math.abs(v - last) > 0.0001) pressure = Math.min(1, pressure + Math.abs(v - last) * 0.25);
      last = v;
      pressure = Math.max(0, pressure - dt * 0.25);
      const heat = state.stations[st.id]?.charge ?? 0;
      needle.rotation = Math.PI * 0.8 + Math.min(1, heat * 0.85 + pressure * 0.15) * Math.PI * 1.4;
      const hot = heat > PUMP_HOT;
      const glow = hot ? 0.5 + 0.5 * Math.sin(time * 9) : 0;
      gauge.tint = hot ? mixTint(0xffffff, 0xff7060, glow) : 0xffffff;
      body.tint = hot ? mixTint(0xffffff, 0xffb090, glow * 0.6) : 0xffffff;
      // the glass pipe shows how full the hold is
      const comp = state.compartments[state.compartments.length - 1];
      const level = comp ? Math.min(1, comp.volume / 40) : 0;
      water.scaleY = Math.max(0.02, level);
      water.tint = level > 0.5 ? 0xffb0a0 : 0xffffff;
    },
  };
}

// ---------------------------------------------------------------- searchlight

export function buildSearchlight(ctx: SceneContext, st: StationState): StationScene {
  const f = ctx.floorY;
  const px = st.x + SEARCHLIGHT_PIVOT.x;
  const yoke = card(ctx, 'st_yoke', { x: px, y: f, z: 0 });
  ctx.stage.shadow(yoke, ctx.frame('st_yoke'));
  const lamp = card(ctx, 'st_lamp', { x: px, y: f - 0.85, z: 0.02 });
  lamp.bias = 0.03;
  ctx.stage.shadow(lamp, ctx.frame('st_lamp'));
  const glow = card(ctx, 'st_lamp_glow', { x: px, y: f - 0.85, z: 0.025 }, 32, 'cards', true);
  const crank = card(ctx, 'st_crank', { x: px - 0.62, y: f - 0.55, z: 0.25 });
  crank.bias = 0.05;
  const oil = card(ctx, 'st_oilglass', { x: px + 0.7, y: f - 0.08, z: 0.2 });
  const fill = card(ctx, 'st_oil', { x: px + 0.7, y: f - 0.17, z: 0.21 });
  fill.bias = 0.01;
  return {
    target: { x: px + 0.3, y: f - 0.95, z: 0 },
    yaw: -0.5,
    pitch: 0.05,
    distance: 4.0,
    control: { x: px, y: f - 0.85, z: 0.02 },
    controlRadius: 0.8,
    operatorZ: -0.5,
    lamp: { x: px - 1.2, y: f - 2.2, z: 1.2 },
    update(state, view, _dt, time) {
      const v = view.stations[st.id]?.value ?? st.value;
      lamp.rotation = v;
      glow.rotation = v;
      crank.rotation = v * 3;
      const oilLeft = st.charge;
      fill.scaleY = Math.max(0.02, oilLeft);
      const flicker = oilLeft <= 0 ? 0 : oilLeft < 0.15 ? (Math.sin(time * 23) > -0.2 ? 0.75 : 0.15) : 1;
      glow.alpha = flicker;
      // the beam: a stage light far along the lamp direction
      ctx.stage.placeLight(1, { x: px + Math.cos(v) * 3.5, y: f - 0.85 + Math.sin(v) * 3.5, z: 0.2 }, [0.82, 0.92, 1], 1.6 * flicker, 220);
      void state;
    },
  };
}

// ---------------------------------------------------------------- cannon

export function buildCannon(ctx: SceneContext, st: StationState): StationScene {
  const f = ctx.floorY;
  const carriage = card(ctx, 'st_carriage', { x: st.x + 0.45, y: f, z: 0 });
  ctx.stage.shadow(carriage, ctx.frame('st_carriage'));
  const pivot = { x: st.x + CANNON_PIVOT.x + 0.1, y: f - 0.62, z: 0.04 };
  const barrel = card(ctx, 'st_cannon', pivot);
  barrel.bias = 0.03;
  ctx.stage.shadow(barrel, ctx.frame('st_cannon'));
  const rod = card(ctx, 'st_ramrod', { x: st.x - 1.2, y: f - 0.3, z: 0.5 });
  const pile = card(ctx, 'ball_rack', { x: st.x - 0.9, y: f, z: -0.55 }, 16);
  ctx.stage.shadow(pile, ctx.frame('ball_rack'));
  const spark = card(ctx, 'st_spark', { x: pivot.x - 0.38, y: pivot.y - 0.3, z: 0.06 }, 32, 'cards', true);
  let recoil = 0;
  let lastCharge = st.charge;
  return {
    target: { x: st.x + 0.9, y: f - 0.7, z: 0 },
    yaw: 0.45,
    pitch: 0.12,
    distance: 4.4,
    control: pivot,
    controlRadius: 1.1,
    operatorZ: -0.55,
    lamp: { x: st.x - 0.5, y: f - 2.6, z: 1.2 },
    update(_state, view, dt, time) {
      const v = view.stations[st.id]?.value ?? st.value;
      // fired: the carriage rolls back a bit and comes forward again
      if (st.charge < lastCharge - 1) recoil = 0.35;
      lastCharge = st.charge;
      recoil = Math.max(0, recoil - dt * 0.8);
      carriage.pos.x = st.x + 0.45 - recoil;
      barrel.pos.x = pivot.x - recoil;
      barrel.rotation = v;
      spark.pos.x = pivot.x - 0.38 - recoil;
      // loading: the ramrod goes in and out while the charge climbs, the fuse sparks when ready
      const loading = st.charge > 0 && st.charge < 2;
      rod.visible = loading || st.charge < 1;
      rod.pos.x = st.x - 1.3 + (loading ? Math.abs(Math.sin(time * 4)) * 0.45 : 0);
      rod.rotation = loading ? v : 0;
      spark.visible = st.charge >= 2;
      spark.alpha = 0.6 + 0.4 * Math.sin(time * 18);
      spark.scaleX = spark.scaleY = 0.8 + 0.3 * Math.sin(time * 25);
    },
  };
}

// ---------------------------------------------------------------- workshop

export function buildWorkshop(ctx: SceneContext, st: StationState): StationScene {
  const f = ctx.floorY;
  const bench = card(ctx, 'st_bench', { x: st.x, y: f, z: 0 });
  ctx.stage.shadow(bench, ctx.frame('st_bench'));
  const plank = card(ctx, 'st_plank', { x: st.x - 0.1, y: f - 0.94, z: 0.03 });
  plank.bias = 0.02;
  const cut = card(ctx, 'st_cut', { x: st.x + 0.05, y: f - 1.19, z: 0.04 });
  cut.bias = 0.03;
  const saw = card(ctx, 'st_saw', { x: st.x + 0.05, y: f - 1.25, z: 0.1 });
  saw.bias = 0.06;
  ctx.stage.shadow(saw, ctx.frame('st_saw'));
  return {
    target: { x: st.x, y: f - 0.9, z: 0 },
    yaw: 0.3,
    pitch: 0.32,
    distance: 4.0,
    control: { x: st.x + 0.05, y: f - 1.25, z: 0.1 },
    controlRadius: 1.0,
    operatorZ: -0.55,
    lamp: { x: st.x - 0.6, y: f - 2.4, z: 0.5 },
    update(state, view) {
      const v = view.stations[st.id]?.value ?? st.value;
      saw.pos.x = st.x + 0.05 + v * 0.45;
      saw.rotation = -0.08 + Math.abs(v) * 0.04;
      // the cut grows into the plank
      cut.scaleY = Math.max(0.05, st.charge);
      cut.visible = st.charge > 0.01;
      plank.tint = state.voyage.timber > 0 ? 0xffffff : 0x806050;
    },
  };
}

// ---------------------------------------------------------------- chart table

export function buildTable(ctx: SceneContext, st: StationState): StationScene {
  const f = ctx.floorY;
  const table = card(ctx, 'st_table', { x: st.x + 0.4, y: f, z: 0 });
  ctx.stage.shadow(table, ctx.frame('st_table'));
  // the route map lies on the table, tilted up a little so it can be read
  const map = ctx.stage.add(ctx.route, 'cards', 92);
  map.pos = { x: st.x + 0.4, y: f - 1.15, z: 0.15 };
  tilted(map, 0.75);
  map.bias = 0.05;
  map.tint = 0xb8ae9c;
  const candle = card(ctx, 'st_candle', { x: st.x + 1.45, y: f - 1.12, z: -0.3 });
  const flame = card(ctx, 'st_candle_flame', { x: st.x + 1.45, y: f - 1.6, z: -0.29 }, 32, 'cards', true);
  return {
    target: { x: st.x + 0.4, y: f - 1.3, z: 0.15 },
    yaw: 0.04,
    pitch: 0.7,
    distance: 2.4,
    control: { x: st.x + 0.4, y: f - 1.3, z: 0.4 },
    controlRadius: 1.4,
    operatorZ: -0.75,
    lamp: { x: st.x + 1.45, y: f - 1.7, z: -0.3 },
    update(_state, _view, _dt, time) {
      flame.scaleX = 1 + Math.sin(time * 9) * 0.12;
      flame.scaleY = 1 + Math.sin(time * 7 + 1) * 0.1;
      void candle;
    },
  };
}

// ---------------------------------------------------------------- generic (life ring and others)

export function buildGeneric(ctx: SceneContext, st: StationState, sprite: string): StationScene {
  const f = ctx.floorY;
  const c = card(ctx, sprite, { x: st.x, y: f, z: 0 }, 16);
  ctx.stage.shadow(c, ctx.frame(sprite));
  return {
    target: { x: st.x, y: f - 0.9, z: 0 },
    yaw: 0.35,
    pitch: 0.15,
    distance: 5,
    control: { x: st.x, y: f - 0.9, z: 0 },
    controlRadius: 1,
    operatorZ: -0.4,
    lamp: { x: st.x, y: f - 2.6, z: 0.8 },
    update() {},
  };
}

// ---------------------------------------------------------------- opening a crate

/** The loot rising out of an opened crate. */
interface Rising {
  card: Card;
  age: number;
}

export interface CrateScene extends StationScene {
  /** Lets the loot rise (called on the crateOpen event). */
  spill(loot: readonly string[]): void;
}

const LOOT_SPRITES: Record<string, { name: string; ppm: number }> = {
  plank: { name: 'plank', ppm: 16 },
  timber: { name: 'up_timber', ppm: 16 },
  ball: { name: 'ball', ppm: 12 },
  oilcan: { name: 'oilcan', ppm: 12 },
  bucket: { name: 'bucket', ppm: 12 },
  coins: { name: 'st_coins', ppm: 24 },
  hammer: { name: 'ui_i_hammer', ppm: 14 },
  crowbar: { name: 'st_crowbar', ppm: 32 },
  rat: { name: 'st_rat', ppm: 24 },
};

export function buildCrate(ctx: SceneContext, crate: ObjectState, progress: () => number, total: number): CrateScene {
  const f = ctx.floorY;
  const x = crate.x;
  // crate parts are drawn at 64 px/m: a 0.75 m crate, 0.56 m high, 0.6 m deep
  const PPM = 64;
  const top = f - 36 / PPM;
  const front = 0.3;
  const back = -0.3;
  const box = card(ctx, 'st_crate', { x, y: f, z: front }, PPM);
  ctx.stage.shadow(box, ctx.frame('st_crate'));
  const dark = card(ctx, 'st_crate_dark', { x, y: top, z: back }, PPM);
  tilted(dark, 0);
  dark.scaleY = (front - back) / (6 / PPM);
  dark.bias = -0.05;
  const straw = card(ctx, 'st_straw', { x, y: top + 0.02, z: 0 }, PPM);
  straw.bias = 0.02;
  // the lid is hinged at the back edge of the top
  const lid = card(ctx, 'st_lid', { x: x - 25 / PPM, y: top - 0.01, z: back }, PPM);
  lid.scaleY = (front - back) / (7 / PPM);
  lid.bias = 0.04;
  const bar = card(ctx, 'st_crowbar', { x: x + 0.3, y: top, z: front + 0.02 }, PPM);
  bar.bias = 0.08;
  ctx.stage.shadow(bar, ctx.frame('st_crowbar'));
  const rising: Rising[] = [];
  let open = 0;
  return {
    target: { x, y: f - 0.45, z: 0 },
    yaw: -0.3,
    pitch: 0.6,
    distance: 2.6,
    control: { x: x + 0.3, y: top, z: front },
    controlRadius: 0.5,
    operatorZ: -0.75,
    lamp: { x: x - 0.8, y: f - 2.4, z: 0.6 },
    spill(loot) {
      loot.forEach((item, i) => {
        const def = LOOT_SPRITES[item] ?? LOOT_SPRITES.plank!;
        const c = card(ctx, def.name, { x: x - 0.2 + i * 0.2, y: top, z: 0.05 }, def.ppm * 1.5);
        c.bias = 0.1 + i * 0.01;
        rising.push({ card: c, age: -i * 0.35 });
      });
    },
    update(_state, _view, dt, time) {
      const p = crate.opened ? 1 : Math.min(1, progress() / total);
      // the crowbar works its way under the lid, the lid lifts, then swings open on its hinge
      const pry = Math.min(1, p * 2);
      bar.rotation = -0.1 - pry * 0.5 + Math.sin(time * 14) * 0.05 * (p < 1 ? 1 : 0);
      bar.visible = !crate.opened;
      const want = crate.opened ? 1 : p > 0.5 ? (p - 0.5) * 0.3 : 0;
      open += (want - open) * Math.min(1, dt * 6);
      const ang = open * 1.9;
      lid.u = { x: 1, y: 0, z: 0 };
      lid.v = { x: 0, y: -Math.sin(ang), z: Math.cos(ang) };
      straw.visible = open > 0.3;
      for (const r of rising) {
        r.age += dt;
        const t = Math.max(0, r.age);
        r.card.visible = r.age >= 0;
        r.card.pos.y = top - Math.min(1, t) * 0.55 - Math.max(0, t - 1) * 0.1;
        r.card.alpha = t > 2.4 ? Math.max(0, 1 - (t - 2.4) * 2) : 1;
        r.card.rotation = Math.sin(t * 3) * 0.1;
      }
    },
  };
}

/** Tapping the oil barrel: the tap turns, oil runs into the can under it. */
export function buildBarrel(ctx: SceneContext, barrel: ObjectState, progress: () => number, total: number): StationScene {
  const f = ctx.floorY;
  const x = barrel.x;
  const PPM = 48;
  const body = card(ctx, 'st_barrel', { x, y: f, z: 0 }, PPM);
  ctx.stage.shadow(body, ctx.frame('st_barrel'));
  const tapY = f - 14 / PPM;
  const tap = card(ctx, 'st_tap', { x: x + 0.16, y: tapY, z: 0.04 }, PPM);
  tap.bias = 0.05;
  const stream = card(ctx, 'st_stream', { x: x + 0.27, y: tapY + 0.05, z: 0.06 }, PPM);
  stream.bias = 0.06;
  const can = card(ctx, 'oilcan', { x: x + 0.28, y: f, z: 0.16 }, 14);
  can.bias = 0.07;
  ctx.stage.shadow(can, ctx.frame('oilcan'));
  return {
    target: { x: x + 0.1, y: f - 0.45, z: 0.15 },
    yaw: 0.4,
    pitch: 0.35,
    distance: 2.5,
    control: { x: x + 0.16, y: tapY, z: 0.04 },
    controlRadius: 0.45,
    operatorZ: -0.7,
    lamp: { x: x - 0.9, y: f - 2.3, z: 0.7 },
    update(_state, _view, _dt, time) {
      const p = Math.min(1, progress() / total);
      // the tap opens in the first quarter, then the oil runs
      tap.rotation = -Math.min(1, p * 4) * 1.2;
      const running = p > 0.2 && p < 1 && barrel.fill > 0;
      stream.visible = running;
      stream.scaleY = running ? 0.85 + Math.sin(time * 30) * 0.05 : 0;
      can.rotation = running ? Math.sin(time * 9) * 0.02 : 0;
    },
  };
}

export { FLOOR_CARD, UP_CARD, frameOf };
