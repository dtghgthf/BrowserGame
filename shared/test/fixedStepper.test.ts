import { describe, expect, it } from 'vitest';
import { FixedStepper, SIM_DT } from '../src';

describe('FixedStepper', () => {
  it('runs one step per 1/60 s and keeps the remainder', () => {
    const s = new FixedStepper(SIM_DT);
    let steps = 0;
    s.advance(1 / 60, () => steps++);
    expect(steps).toBe(1);
    s.advance(1 / 120, () => steps++);
    expect(steps).toBe(1);
    expect(s.alpha).toBeCloseTo(0.5, 5);
    s.advance(1 / 120, () => steps++);
    expect(steps).toBe(2);
  });

  it('runs two steps for a 30 fps frame and none for a tiny frame', () => {
    const s = new FixedStepper(SIM_DT);
    expect(s.advance(1 / 30, () => {})).toBe(2);
    expect(s.advance(0.001, () => {})).toBe(0);
  });

  it('produces the same number of steps regardless of frame rate', () => {
    for (const fps of [30, 60, 75, 120, 144, 240]) {
      const s = new FixedStepper(SIM_DT);
      let steps = 0;
      for (let i = 0; i < fps * 10; i++) s.advance(1 / fps, () => steps++);
      expect(Math.abs(steps - 600)).toBeLessThanOrEqual(1);
    }
  });

  it('always passes the fixed dt to the step function', () => {
    const s = new FixedStepper(SIM_DT);
    const dts: number[] = [];
    s.advance(0.05, (dt) => dts.push(dt));
    expect(dts.every((d) => d === SIM_DT)).toBe(true);
  });

  it('guards against the spiral of death', () => {
    const s = new FixedStepper(SIM_DT, 4, 0.25);
    const steps = s.advance(10, () => {});
    expect(steps).toBe(4);
    expect(s.accumulator).toBeLessThan(SIM_DT);
    expect(s.droppedSteps).toBeGreaterThan(0);
  });
});
