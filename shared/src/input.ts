import type { TuningPatch } from './tuning';

/**
 * Player input for one simulation tick. Inputs are plain data: the client
 * samples keyboard/touch into this shape, the (future) server receives it over
 * the network. The simulation derives edges (press events) itself by comparing
 * with the previous tick's input.
 */
export interface PlayerInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jump: boolean;
  /** E: interact, enter/leave station, open/close hatch, repair. */
  interact: boolean;
  /** F: pick up / drop objects, take a plank at the workshop. */
  pick: boolean;
  /**
   * Analog target for the station the player operates (e.g. dragging the
   * steering wheel): wheel/pump -1..1, searchlight/cannon = angle in radians.
   * null when not used.
   */
  target: number | null;
}

export const EMPTY_INPUT: Readonly<PlayerInput> = Object.freeze({
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  interact: false,
  pick: false,
  target: null,
});

export function copyInput(src: Readonly<PlayerInput>, dst: PlayerInput = { ...EMPTY_INPUT }): PlayerInput {
  dst.left = src.left;
  dst.right = src.right;
  dst.up = src.up;
  dst.down = src.down;
  dst.jump = src.jump;
  dst.interact = src.interact;
  dst.pick = src.pick;
  dst.target = src.target ?? null;
  return dst;
}

export const DEBUG_HAZARDS = ['rock', 'monster', 'pirates', 'ice', 'whirl', 'flotsam', 'fire', 'wave', 'lightning'] as const;
export type DebugHazard = (typeof DEBUG_HAZARDS)[number];

export type InputMap = Readonly<Record<string, Readonly<PlayerInput>>>;

/** Debug / meta commands. Also plain data so they can travel over the network later. */
export type SimCommand =
  | { type: 'debugLeak'; point?: number }
  | { type: 'debugWater'; compartment: number; volume: number }
  | { type: 'seaState'; value: number }
  | { type: 'debugRoll'; value: number | null }
  | { type: 'tune'; patch: TuningPatch }
  /** Debug: start a hazard right now (rock ahead, an encounter, a fire, a wave, lightning). */
  | { type: 'debugHazard'; what: DebugHazard }
  /** Debug: sail forward this many meters. */
  | { type: 'debugAdvance'; meters: number }
  /** A player marks a spot (ship-local meters). Allowed for everybody online. */
  | { type: 'ping'; player: string; x: number; y: number }
  | { type: 'reset' };
