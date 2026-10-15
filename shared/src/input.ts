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
}

export const EMPTY_INPUT: Readonly<PlayerInput> = Object.freeze({
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  interact: false,
  pick: false,
});

export function copyInput(src: Readonly<PlayerInput>, dst: PlayerInput = { ...EMPTY_INPUT }): PlayerInput {
  dst.left = src.left;
  dst.right = src.right;
  dst.up = src.up;
  dst.down = src.down;
  dst.jump = src.jump;
  dst.interact = src.interact;
  dst.pick = src.pick;
  return dst;
}

export type InputMap = Readonly<Record<string, Readonly<PlayerInput>>>;

/** Debug / meta commands. Also plain data so they can travel over the network later. */
export type SimCommand =
  | { type: 'debugLeak'; point?: number }
  | { type: 'debugWater'; compartment: number; volume: number }
  | { type: 'seaState'; value: number }
  | { type: 'debugRoll'; value: number | null }
  | { type: 'reset' };
