import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODE_DEFAULTS, DEFAULT_TUNING, applyTuningPatch, cloneTuning, diffTuning } from '../src';

describe('tuning data', () => {
  it('tuning.json contains every key with a finite number', () => {
    const file = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'src', 'tuning.json'), 'utf8')) as Record<string, Record<string, unknown>>;
    for (const [group, values] of Object.entries(CODE_DEFAULTS)) {
      for (const key of Object.keys(values)) {
        expect(typeof file[group]?.[key], `${group}.${key}`).toBe('number');
        expect(Number.isFinite(file[group]![key]), `${group}.${key}`).toBe(true);
      }
    }
  });

  it('patches only apply known, finite numbers', () => {
    const t = cloneTuning(DEFAULT_TUNING);
    const applied = applyTuningPatch(t, {
      player: { walkSpeed: 9, nonsense: 3, jumpSpeed: 'high', climbSpeed: Number.NaN },
      ship: { speed: 1 },
      unknownGroup: { x: 1 },
    });
    expect(applied).toBe(2);
    expect(t.player.walkSpeed).toBe(9);
    expect(t.player.jumpSpeed).toBe(DEFAULT_TUNING.player.jumpSpeed);
    expect(t.ship.speed).toBe(1);
    expect(applyTuningPatch(t, null)).toBe(0);
  });

  it('diffTuning returns exactly the changed values', () => {
    const t = cloneTuning(DEFAULT_TUNING);
    t.player.walkSpeed += 1;
    t.gameplay.leakRate = 0.5;
    expect(diffTuning(DEFAULT_TUNING, t)).toEqual({
      player: { walkSpeed: DEFAULT_TUNING.player.walkSpeed + 1 },
      gameplay: { leakRate: 0.5 },
    });
    expect(diffTuning(DEFAULT_TUNING, DEFAULT_TUNING)).toEqual({});
  });
});
