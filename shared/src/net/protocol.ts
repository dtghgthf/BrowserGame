import { DEBUG_HAZARDS, EMPTY_INPUT, type DebugHazard, type PlayerInput, type SimCommand } from '../input';
import type { GameEvent, GameState } from '../state';
import type { TuningPatch } from '../tuning';
import { GAME_MODES, ROLES, type GameMode, type Role } from '../campaign';
import { decodeDesign, validateShipDesign, type ShipDesign } from '../layout/design';

/**
 * Network protocol between the browser and the Colyseus server. Shared so both
 * sides agree on message names and shapes. Only plain data travels: inputs go
 * up, authoritative snapshots come down (Colyseus encodes messages with msgpack).
 */

/** Bumped whenever the messages below change incompatibly. */
export const PROTOCOL_VERSION = 3;

export const ROOM_NAME = 'ship';
export const DEFAULT_SERVER_PORT = 2567;
/** The server sends a snapshot every N simulation ticks (60 Hz / 3 = 20 Hz). */
export const SNAPSHOT_EVERY = 3;
/** Seconds a dropped player keeps their place on the ship (WLAN hiccups, page reloads). */
export const RECONNECT_SECONDS = 45;

export const MSG = {
  /** client -> server: InputMessage */
  input: 'i',
  /** client -> server: SimCommand (debug keys, tuning) */
  command: 'c',
  /** server -> client: SnapshotMessage */
  snapshot: 's',
  /** server -> client: TuningPatch applied by the server (everyone predicts with the same numbers) */
  tuning: 't',
  /** server -> client: WelcomeMessage, once after joining */
  welcome: 'w',
} as const;

/** Options sent with create / join. */
export interface JoinOptions {
  name: string;
  color: number;
  protocol: number;
  role?: Role;
  /** Only when opening a ship: what kind of voyage. */
  mode?: GameMode;
  /** Only when opening a ship: a ship from the editor (design code), absent = the standard ship. */
  design?: string;
}

/** Longest design code accepted from the network. */
export const MAX_DESIGN_CODE = 4096;

/** A ship design from the network: decoded and playable (no validation errors), else null. */
export function parseDesignCode(v: unknown): ShipDesign | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_DESIGN_CODE) return null;
  const d = decodeDesign(v);
  if (!d) return null;
  if (validateShipDesign(d).some((i) => i.level === 'error')) return null;
  return d;
}

/** A role from the network (anything unknown = no role). */
export function parseRole(v: unknown): Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v) ? (v as Role) : 'none';
}

/** A game mode from the network (anything unknown = campaign). */
export function parseMode(v: unknown): GameMode {
  return typeof v === 'string' && (GAME_MODES as readonly string[]).includes(v) ? (v as GameMode) : 'campaign';
}

export interface WelcomeMessage {
  protocol: number;
  code: string;
  /** Full tuning difference to the defaults. */
  tuning: TuningPatch;
  /** The room's ship (design code), null = the standard ship. */
  design: string | null;
}

export interface SnapshotMessage {
  state: GameState;
  /** Per player: sequence number of the last input the server has applied. */
  acks: Record<string, number>;
  /** All events since the previous snapshot (state.events is emptied). */
  events: GameEvent[];
  /** Session id of the host (may use debug commands). */
  host: string;
}

/**
 * Inputs for consecutive ticks, packed as numbers:
 * [firstSeq, bits0, target0, bits1, target1, ...] - target is null when unused.
 */
export type InputMessage = (number | null)[];

const BITS: (keyof Omit<PlayerInput, 'target'>)[] = ['left', 'right', 'up', 'down', 'jump', 'interact', 'pick'];
/** Inputs older than this are not resent / accepted in one message. */
export const MAX_INPUTS_PER_MESSAGE = 30;

export function inputBits(i: Readonly<PlayerInput>): number {
  let b = 0;
  BITS.forEach((k, n) => {
    if (i[k]) b |= 1 << n;
  });
  return b;
}

export function inputFromBits(bits: number, target: number | null): PlayerInput {
  const i: PlayerInput = { ...EMPTY_INPUT };
  BITS.forEach((k, n) => {
    i[k] = (bits & (1 << n)) !== 0;
  });
  i.target = target;
  return i;
}

export function encodeInputs(firstSeq: number, inputs: readonly Readonly<PlayerInput>[]): InputMessage {
  const msg: InputMessage = [firstSeq];
  for (const i of inputs) msg.push(inputBits(i), i.target === null ? null : Math.round(i.target * 1000) / 1000);
  return msg;
}

/** Decodes and validates an input message from the network. Invalid parts are dropped. */
export function decodeInputs(msg: unknown): { seq: number; input: PlayerInput }[] {
  if (!Array.isArray(msg) || msg.length < 3) return [];
  const first = msg[0];
  if (typeof first !== 'number' || !Number.isInteger(first) || first < 0) return [];
  const out: { seq: number; input: PlayerInput }[] = [];
  const n = Math.min((msg.length - 1) >> 1, MAX_INPUTS_PER_MESSAGE);
  for (let k = 0; k < n; k++) {
    const bits = msg[1 + k * 2];
    const t = msg[2 + k * 2];
    if (typeof bits !== 'number' || !Number.isInteger(bits) || bits < 0 || bits > 127) break;
    const target = typeof t === 'number' && Number.isFinite(t) && Math.abs(t) < 10 ? t : null;
    out.push({ seq: first + k, input: inputFromBits(bits, target) });
  }
  return out;
}

/** Characters the pixel font can draw (names are shown above the players). */
const NAME_CHARS = /[^A-Z0-9ÄÖÜ .!?-]/g;
export const MAX_NAME_LENGTH = 10;

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .toUpperCase()
    .replace(/ß/g, 'SS')
    .replace(NAME_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

/** Room codes: 4 letters without easily confused ones (I, O, 0, 1). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 4;

export function makeRoomCode(random: () => number): string {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return s;
}

export function normalizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, ROOM_CODE_LENGTH);
}

export function isRoomCode(s: string): boolean {
  return s.length === ROOM_CODE_LENGTH && [...s].every((c) => CODE_ALPHABET.includes(c));
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates a command received over the network. Returns null for anything unexpected. */
export function parseCommand(raw: unknown): SimCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  switch (c.type) {
    case 'debugLeak':
      return c.point === undefined ? { type: 'debugLeak' } : finite(c.point) ? { type: 'debugLeak', point: Math.floor(c.point) } : null;
    case 'debugWater':
      return finite(c.compartment) && finite(c.volume) ? { type: 'debugWater', compartment: Math.floor(c.compartment), volume: c.volume } : null;
    case 'seaState':
      return finite(c.value) ? { type: 'seaState', value: c.value } : null;
    case 'debugRoll':
      return c.value === null ? { type: 'debugRoll', value: null } : finite(c.value) ? { type: 'debugRoll', value: c.value } : null;
    case 'tune': {
      if (!c.patch || typeof c.patch !== 'object') return null;
      // applyTuningPatch ignores unknown keys and non-finite numbers itself
      return { type: 'tune', patch: c.patch as TuningPatch };
    }
    case 'reset':
      return { type: 'reset' };
    case 'debugHazard':
      return typeof c.what === 'string' && (DEBUG_HAZARDS as readonly string[]).includes(c.what) ? { type: 'debugHazard', what: c.what as DebugHazard } : null;
    case 'debugAdvance':
      return finite(c.meters) ? { type: 'debugAdvance', meters: Math.max(0, Math.min(2000, c.meters)) } : null;
    case 'ping':
      // the server fills in who pinged
      return finite(c.x) && finite(c.y) ? { type: 'ping', player: typeof c.player === 'string' ? c.player : '', x: c.x, y: c.y } : null;
    default:
      return null;
  }
}
