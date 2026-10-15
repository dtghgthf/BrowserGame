import { describe, expect, it } from 'vitest';
import { EMPTY_INPUT } from '@lw/shared';
import { InputSampler } from '../src/input/InputSampler';

describe('InputSampler', () => {
  it('keeps a short tap for exactly one tick', () => {
    const s = new InputSampler();
    s.setHeld({ ...EMPTY_INPUT, jump: true }); // pressed this frame
    s.setHeld({ ...EMPTY_INPUT }); // released before any tick ran
    expect(s.sample().jump).toBe(true);
    s.consumed();
    expect(s.sample().jump).toBe(false);
  });

  it('a held key stays held across ticks', () => {
    const s = new InputSampler();
    s.setHeld({ ...EMPTY_INPUT, interact: true, left: true });
    expect(s.sample().interact).toBe(true);
    s.consumed();
    expect(s.sample().interact).toBe(true);
    expect(s.sample().left).toBe(true);
  });
});
