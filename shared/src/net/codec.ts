import { BIOMES, GAME_MODES, MODIFIERS, ROLES, UPGRADES, type CampaignState, type RouteNode, type RouteVote, type ShopOffer } from '../campaign';
import type { PlayerInput } from '../input';
import type { SnapshotMessage } from './protocol';
import type {
  BallState,
  CompartmentState,
  FireState,
  FlotsamState,
  PirateState,
  RingState,
  WhirlState,
  GameState,
  HatchState,
  LeakState,
  MonsterState,
  ObjectState,
  PingState,
  PlayerState,
  RockState,
  ShipState,
  ShoutCooldowns,
  StationState,
  VoyageState,
} from '../state';

/**
 * Compact binary encoding of the GameState for the network (~4x smaller than
 * msgpack). The layout is described once as a schema below; encoder and decoder
 * both walk it, so they cannot disagree. The schema types are mapped from the
 * state interfaces: forgetting a field after changing the state is a compile
 * error, and a round-trip test compares every value.
 *
 * Value types:
 *   pos  ship-local meters, int16 in mm (±32 m)      vel  m/s, int16 / 400 (±81 m/s)
 *   ang  radians, int16 / 8000 (±4 rad)              f32 / f64 / u8 / u16 / u32 / bool / str
 */
type Prim = 'f32' | 'f64' | 'u8' | 'u16' | 'u32' | 'bool' | 'str' | 'pos' | 'vel' | 'ang';
type Spec = Prim | { enum: readonly string[] } | { nullable: Spec } | { array: Spec } | { object: Record<string, Spec> };

/** Every key of T must be described. */
type Fields<T> = { [K in keyof T]-?: Spec };
const obj = <T>(fields: Fields<T>): Spec => ({ object: fields as Record<string, Spec> });
const nullable = (s: Spec): Spec => ({ nullable: s });
const array = (s: Spec): Spec => ({ array: s });
const oneOf = (values: readonly string[]): Spec => ({ enum: values });

const INPUT = obj<PlayerInput>({
  left: 'bool',
  right: 'bool',
  up: 'bool',
  down: 'bool',
  jump: 'bool',
  interact: 'bool',
  pick: 'bool',
  target: nullable('f32'),
  target2: nullable('f32'),
});

const BUBBLES = [
  'leak',
  'water',
  'plank',
  'help',
  'wheel',
  'rock',
  'monster',
  'land',
  'rat',
  'oil',
  'wood',
  'fire',
  'wave',
  'pirate',
  'overboard',
  'whirl',
  'flotsam',
  'cargo',
] as const;
const OBJECT_KINDS = ['crate', 'barrel', 'plank', 'bucket', 'oilcan', 'ball'] as const;
const LOOT = ['plank', 'timber', 'ball', 'oilcan', 'bucket', 'coins', 'hammer', 'crowbar', 'rat'] as const;
const STATION_KINDS = ['wheel', 'pump', 'searchlight', 'cannon', 'workshop', 'rack', 'ring', 'table'] as const;
const PING_KINDS = ['here', 'help', 'danger', 'leak', 'hatch', 'plank', 'wheel', 'pump', 'searchlight', 'cannon', 'fire', 'crate', 'ring'] as const;

const PLAYER = obj<PlayerState>({
  id: 'str',
  name: 'str',
  color: 'u8',
  role: oneOf(ROLES),
  away: 'bool',
  x: 'pos',
  y: 'pos',
  vx: 'vel',
  vy: 'vel',
  facing: oneOf(['1', '-1']),
  grounded: 'bool',
  inWater: 'f32',
  climbing: nullable('u8'),
  station: nullable('u8'),
  carrying: nullable('u16'),
  action: nullable(obj<NonNullable<PlayerState['action']>>({ kind: oneOf(['repair', 'open', 'ram', 'cut', 'lash', 'tap']), target: 'u16', progress: 'f32' })),
  anim: oneOf(['idle', 'run', 'jump', 'fall', 'climb', 'station', 'repair', 'swim']),
  animTime: 'f32',
  prevInput: INPUT,
  overboard: 'f32',
  seaX: 'f64',
  bubble: nullable(obj<NonNullable<PlayerState['bubble']>>({ key: oneOf(BUBBLES), time: 'f32' })),
  airTime: 'f32',
  jumpBuffer: 'f32',
  fallSpeed: 'f32',
  solidPlatforms: 'bool',
});

const OBJECT = obj<ObjectState>({
  id: 'u16',
  kind: oneOf(OBJECT_KINDS),
  x: 'pos',
  y: 'pos',
  angle: 'ang',
  vx: 'vel',
  vy: 'vel',
  av: 'vel',
  carriedBy: nullable('str'),
  spawn: nullable(obj<{ x: number; y: number }>({ x: 'pos', y: 'pos' })),
  contents: array(oneOf(LOOT)),
  opened: 'bool',
  fill: 'f32',
  lashed: 'bool',
});

const SHIP = obj<ShipState>({
  x: 'f64',
  y: 'f32',
  vy: 'f32',
  ay: 'f32',
  roll: 'f32',
  rollVel: 'f32',
  list: 'f32',
  heading: 'f32',
  lateral: 'f32',
  rudder: 'f32',
  speed: 'f32',
  gravity: obj<{ x: number; y: number }>({ x: 'f32', y: 'f32' }),
  seaState: 'f32',
  sinkage: 'f32',
});

const STATE = obj<GameState>({
  tick: 'u32',
  time: 'f64',
  rng: 'u32',
  status: oneOf(['sailing', 'sunk', 'arrived', 'harbor']),
  statusTimer: 'f32',
  hold: 'bool',
  ship: SHIP,
  players: array(PLAYER),
  objects: array(OBJECT),
  hatches: array(obj<HatchState>({ id: 'u8', open: 'bool' })),
  compartments: array(obj<CompartmentState>({ id: 'u8', volume: 'f32', surfaceY: 'f32', slope: 'f32', slopeVel: 'f32', centroidX: 'f32' })),
  leaks: array(obj<LeakState>({ id: 'u16', point: 'u8', active: 'bool', inflow: 'f32' })),
  stations: array(
    obj<StationState>({
      id: 'u8',
      kind: oneOf(STATION_KINDS),
      x: 'pos',
      y: 'pos',
      occupant: nullable('str'),
      optional: 'bool',
      helper: nullable('str'),
      value: 'f32',
      aux: 'f32',
      charge: 'f32',
      power: 'f32',
    }),
  ),
  // events travel separately (see SnapshotMessage)
  events: array('u8'),
  nextObjectId: 'u16',
  forcedRoll: nullable('f32'),
  leakCursor: 'u8',
  voyage: obj<VoyageState>({
    length: 'f32',
    seaBase: 'f32',
    nextRockX: 'f64',
    nextEncounterX: 'f64',
    iceUntilX: 'f64',
    waveIn: 'f32',
    waveWarn: 'f32',
    lightningIn: 'f32',
    firesPut: 'u16',
    piratesBeaten: 'u16',
    flotsamFished: 'u16',
    rescues: 'u16',
    rocksHit: 'u16',
    rocksPassed: 'u16',
    rocksDestroyed: 'u16',
    monstersRepelled: 'u16',
    leaksRepaired: 'u16',
    landSighted: 'bool',
    timber: 'u16',
    coins: 'u32',
    cratesOpened: 'u16',
    hammer: 'bool',
    crowbar: 'bool',
  }),
  rocks: array(obj<RockState>({ id: 'u32', x: 'f64', lateral: 'f32', radius: 'f32', spotted: 'bool', hit: 'bool', kind: oneOf(['rock', 'ice']), hp: 'u8' })),
  monster: nullable(
    obj<MonsterState>({
      offset: 'f32',
      depth: 'f32',
      hp: 'u8',
      phase: oneOf(['approach', 'attack', 'flee']),
      timer: 'f32',
      attackIn: 'f32',
      spotted: 'bool',
      hurt: 'f32',
    }),
  ),
  pirate: nullable(
    obj<PirateState>({
      offset: 'f32',
      hp: 'u8',
      phase: oneOf(['approach', 'fight', 'flee']),
      timer: 'f32',
      fireIn: 'f32',
      hook: 'f32',
      hookIn: 'f32',
      hurt: 'f32',
      spotted: 'bool',
    }),
  ),
  whirl: nullable(obj<WhirlState>({ x: 'f64', lateral: 'f32', radius: 'f32', spotted: 'bool', hit: 'bool' })),
  flotsam: array(obj<FlotsamState>({ id: 'u32', x: 'f64', lateral: 'f32', spotted: 'bool' })),
  fires: array(obj<FireState>({ id: 'u32', tx: 'u8', ty: 'u8', heat: 'f32', age: 'f32' })),
  ring: nullable(
    obj<RingState>({ x: 'f64', y: 'f32', vx: 'f32', vy: 'f32', phase: oneOf(['flying', 'floating', 'pulling']), holder: nullable('str') }),
  ),
  balls: array(obj<BallState>({ id: 'u32', x: 'f64', y: 'f32', vx: 'f32', vy: 'f32', age: 'f32', pirate: 'bool' })),
  pings: array(
    obj<PingState>({
      id: 'u32',
      player: 'str',
      kind: oneOf(PING_KINDS),
      x: 'pos',
      y: 'pos',
      time: 'f32',
    }),
  ),
  shouts: obj<ShoutCooldowns>({ wheel: 'f32', water: 'f32', rock: 'f32', oil: 'f32', fire: 'f32' }),
  nextId: 'u32',
  campaign: obj<CampaignState>({
    mode: oneOf(GAME_MODES),
    seed: 'u32',
    nodes: array(
      obj<RouteNode>({ id: 'u8', col: 'u8', row: 'u8', biome: oneOf(BIOMES), length: 'f32', reward: 'u16', next: array('u8') }),
    ),
    node: 'f32',
    leg: 'u8',
    modifiers: array(oneOf(MODIFIERS)),
    upgrades: array(oneOf(UPGRADES)),
    choice: 'f32',
    votes: array(obj<RouteVote>({ player: 'str', color: 'u8', node: 'u8' })),
    shop: array(obj<ShopOffer>({ kind: oneOf(UPGRADES), price: 'u16', sold: 'bool' })),
    run: 'u16',
  }),
});

const QUANT = { pos: 1000, vel: 400, ang: 8000 } as const;

class Writer {
  buf = new Uint8Array(2048);
  view = new DataView(this.buf.buffer);
  at = 0;
  private need(n: number): void {
    if (this.at + n <= this.buf.length) return;
    const bigger = new Uint8Array(Math.max(this.buf.length * 2, this.at + n));
    bigger.set(this.buf);
    this.buf = bigger;
    this.view = new DataView(bigger.buffer);
  }
  u8(v: number): void {
    this.need(1);
    this.view.setUint8(this.at, v);
    this.at += 1;
  }
  u16(v: number): void {
    this.need(2);
    this.view.setUint16(this.at, v, true);
    this.at += 2;
  }
  i16(v: number): void {
    this.need(2);
    this.view.setInt16(this.at, v, true);
    this.at += 2;
  }
  u32(v: number): void {
    this.need(4);
    this.view.setUint32(this.at, v >>> 0, true);
    this.at += 4;
  }
  f32(v: number): void {
    this.need(4);
    this.view.setFloat32(this.at, v, true);
    this.at += 4;
  }
  f64(v: number): void {
    this.need(8);
    this.view.setFloat64(this.at, v, true);
    this.at += 8;
  }
  str(s: string): void {
    const bytes = utf8Encode(s);
    if (bytes.length > 255) throw new Error('string too long');
    this.u8(bytes.length);
    this.need(bytes.length);
    this.buf.set(bytes, this.at);
    this.at += bytes.length;
  }
}

class Reader {
  at = 0;
  private readonly view: DataView;
  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  u8(): number {
    return this.view.getUint8(this.at++);
  }
  u16(): number {
    const v = this.view.getUint16(this.at, true);
    this.at += 2;
    return v;
  }
  i16(): number {
    const v = this.view.getInt16(this.at, true);
    this.at += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.at, true);
    this.at += 4;
    return v;
  }
  f32(): number {
    const v = this.view.getFloat32(this.at, true);
    this.at += 4;
    return v;
  }
  f64(): number {
    const v = this.view.getFloat64(this.at, true);
    this.at += 8;
    return v;
  }
  str(): string {
    const n = this.u8();
    const s = utf8Decode(this.buf.subarray(this.at, this.at + n));
    this.at += n;
    return s;
  }
}

function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

function utf8Decode(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i]!;
    let cp: number;
    if (c < 0x80) {
      cp = c;
      i += 1;
    } else if (c < 0xe0) {
      cp = ((c & 31) << 6) | (b[i + 1]! & 63);
      i += 2;
    } else if (c < 0xf0) {
      cp = ((c & 15) << 12) | ((b[i + 1]! & 63) << 6) | (b[i + 2]! & 63);
      i += 3;
    } else {
      cp = ((c & 7) << 18) | ((b[i + 1]! & 63) << 12) | ((b[i + 2]! & 63) << 6) | (b[i + 3]! & 63);
      i += 4;
    }
    s += String.fromCodePoint(cp);
  }
  return s;
}

const clampI16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));

function write(w: Writer, spec: Spec, v: unknown): void {
  if (typeof spec === 'string') {
    const n = v as number;
    switch (spec) {
      case 'f32':
        return w.f32(n);
      case 'f64':
        return w.f64(n);
      case 'u8':
        return w.u8(n);
      case 'u16':
        return w.u16(n);
      case 'u32':
        return w.u32(n);
      case 'bool':
        return w.u8(v ? 1 : 0);
      case 'str':
        return w.str(v as string);
      default:
        return w.i16(clampI16(n * QUANT[spec]));
    }
  }
  if ('enum' in spec) {
    const i = spec.enum.indexOf(String(v));
    if (i < 0) throw new Error(`codec: unknown enum value ${String(v)}`);
    return w.u8(i);
  }
  if ('nullable' in spec) {
    if (v === null || v === undefined) return w.u8(0);
    w.u8(1);
    return write(w, spec.nullable, v);
  }
  if ('array' in spec) {
    const a = v as unknown[];
    w.u16(a.length);
    for (const item of a) write(w, spec.array, item);
    return;
  }
  const o = v as Record<string, unknown>;
  for (const [k, s] of Object.entries(spec.object)) write(w, s, o[k]);
}

function read(r: Reader, spec: Spec): unknown {
  if (typeof spec === 'string') {
    switch (spec) {
      case 'f32':
        return r.f32();
      case 'f64':
        return r.f64();
      case 'u8':
        return r.u8();
      case 'u16':
        return r.u16();
      case 'u32':
        return r.u32();
      case 'bool':
        return r.u8() !== 0;
      case 'str':
        return r.str();
      default:
        return r.i16() / QUANT[spec];
    }
  }
  if ('enum' in spec) {
    const value = spec.enum[r.u8()];
    // facing is stored as text in the enum but is a number in the state
    return value === '1' ? 1 : value === '-1' ? -1 : value;
  }
  if ('nullable' in spec) return r.u8() ? read(r, spec.nullable) : null;
  if ('array' in spec) {
    const n = r.u16();
    const a: unknown[] = new Array(n);
    for (let i = 0; i < n; i++) a[i] = read(r, spec.array);
    return a;
  }
  const o: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(spec.object)) o[k] = read(r, s);
  return o;
}

/** Format version, first byte of every encoded state. */
const CODEC_VERSION = 1;

export function encodeState(state: GameState): Uint8Array {
  const w = new Writer();
  w.u8(CODEC_VERSION);
  write(w, STATE, { ...state, events: [] });
  return w.buf.slice(0, w.at);
}

export function decodeState(bytes: Uint8Array): GameState {
  const r = new Reader(bytes);
  const version = r.u8();
  if (version !== CODEC_VERSION) throw new Error(`codec: unknown version ${version}`);
  return read(r, STATE) as GameState;
}

/** What actually travels: the snapshot with the state as compact bytes. */
export interface SnapshotWire {
  s: Uint8Array;
  acks: Record<string, number>;
  events: SnapshotMessage['events'];
  host: string;
}

export function packSnapshot(m: SnapshotMessage): SnapshotWire {
  return { s: encodeState(m.state), acks: m.acks, events: m.events, host: m.host };
}

export function unpackSnapshot(w: SnapshotWire): SnapshotMessage {
  return { state: decodeState(w.s), acks: w.acks, events: w.events, host: w.host };
}
