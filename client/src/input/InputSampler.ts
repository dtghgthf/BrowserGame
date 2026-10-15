import { EMPTY_INPUT, type PlayerInput } from '@lw/shared';

type Key = keyof PlayerInput;
const EDGE_KEYS: Key[] = ['jump', 'interact', 'pick'];

/**
 * Turns device state into one PlayerInput per simulation tick. Presses are
 * latched until a tick consumed them, so a tap shorter than one tick (or one
 * that happens between two ticks) is never lost.
 */
export class InputSampler {
  private readonly latched: Partial<Record<Key, boolean>> = {};
  private readonly held: PlayerInput = { ...EMPTY_INPUT };

  /** Updates the held state for this frame (call once per rendered frame). */
  setHeld(input: PlayerInput): void {
    for (const k of Object.keys(input) as Key[]) {
      if (input[k] && !this.held[k] && EDGE_KEYS.includes(k)) this.latched[k] = true;
      this.held[k] = input[k];
    }
  }

  /** Registers a press even if the key was released again within the same frame. */
  press(k: Key): void {
    this.latched[k] = true;
  }

  /** Input for the next tick. */
  sample(): PlayerInput {
    const out = { ...this.held };
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
  }
}
