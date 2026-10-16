import { EMPTY_INPUT, type PlayerInput } from '@lw/shared';

type BoolKey = Exclude<keyof PlayerInput, 'target'>;
// directions too: a quick tap on A/D/W/S steps through choices (chart table) and must not fall between two ticks
const EDGE_KEYS: BoolKey[] = ['jump', 'interact', 'pick', 'left', 'right', 'up', 'down'];
const BOOL_KEYS: BoolKey[] = ['left', 'right', 'up', 'down', 'jump', 'interact', 'pick'];

/**
 * Turns device state into one PlayerInput per simulation tick. Presses are
 * latched until a tick consumed them, so a tap shorter than one tick (or one
 * that happens between two ticks) is never lost.
 */
export class InputSampler {
  private readonly latched: Partial<Record<BoolKey, boolean>> = {};
  private readonly held: PlayerInput = { ...EMPTY_INPUT };
  /** Last analog target since the previous tick: a tap on the screen shorter than a tick still reaches the simulation. */
  private pendingTarget: number | null = null;

  /** Updates the held state for this frame (call once per rendered frame). */
  setHeld(input: PlayerInput): void {
    for (const k of BOOL_KEYS) {
      if (input[k] && !this.held[k] && EDGE_KEYS.includes(k)) this.latched[k] = true;
      this.held[k] = input[k];
    }
    // analog station target: the latest value wins; it is kept for one tick after the pointer let go
    this.held.target = input.target;
    if (input.target !== null && input.target !== undefined) this.pendingTarget = input.target;
  }

  /** Registers a press even if the key was released again within the same frame. */
  press(k: BoolKey): void {
    this.latched[k] = true;
  }

  /** Input for the next tick. */
  sample(): PlayerInput {
    const out = { ...this.held };
    if (out.target === null || out.target === undefined) out.target = this.pendingTarget;
    for (const k of EDGE_KEYS) if (this.latched[k]) out[k] = true;
    return out;
  }

  /** Must be called after every simulation tick that used `sample()`. */
  consumed(): void {
    for (const k of EDGE_KEYS) {
      // a latched press stays visible for exactly one tick, then is released
      // (if the key is still held, `held` keeps it true)
      this.latched[k] = false;
    }
    this.pendingTarget = null;
  }
}
