import { describe, expect, it } from 'vitest';
import lookFile from '../src/look.json';
import { applyLookPatch, DEFAULT_LOOK, type LookTuning } from '../src/look';

describe('look tuning', () => {
  it('look.json has every look value as a finite number', () => {
    for (const k of Object.keys(DEFAULT_LOOK)) {
      const v = (lookFile as Record<string, unknown>)[k];
      expect(typeof v, k).toBe('number');
    }
  });

  it('patches ignore unknown keys and non-numbers', () => {
    const l: LookTuning = { ...DEFAULT_LOOK };
    expect(applyLookPatch(l, { exposure: 2, nope: 1, gamma: 'x', fogDensity: Number.POSITIVE_INFINITY })).toBe(1);
    expect(l.exposure).toBe(2);
    expect(l.gamma).toBe(DEFAULT_LOOK.gamma);
  });
});
