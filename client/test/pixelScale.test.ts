import { describe, expect, it } from 'vitest';
import { computePixelLayout } from '../src/render/pixelScale';

describe('pixel layout', () => {
  it('1080p maps to 480x270 at 4x', () => {
    const l = computePixelLayout(1920, 1080, 1);
    expect(l).toMatchObject({ width: 480, height: 270, scale: 4 });
  });

  it('always uses an integer scale that fits the screen', () => {
    for (const [w, h, dpr] of [
      [1366, 768, 1],
      [1024, 768, 2],
      [1180, 820, 2],
      [2560, 1440, 1],
      [1280, 800, 1],
    ] as const) {
      const l = computePixelLayout(w, h, dpr);
      expect(Number.isInteger(l.scale)).toBe(true);
      expect(l.deviceWidth).toBe(l.width * l.scale);
      expect(l.deviceHeight).toBe(l.height * l.scale);
      expect(l.deviceWidth).toBeLessThanOrEqual(Math.round(w * dpr));
      expect(l.deviceHeight).toBeLessThanOrEqual(Math.round(h * dpr));
      expect(l.height).toBeGreaterThanOrEqual(200);
      expect(l.height).toBeLessThanOrEqual(400);
    }
  });

  it('a phone in landscape gets bigger pixels (about 190 px of height) and no side bars', () => {
    for (const [w, h, dpr] of [
      [844, 390, 3],
      [932, 430, 3],
      [740, 360, 2],
      [800, 340, 2.75],
    ] as const) {
      const l = computePixelLayout(w, h, dpr);
      expect(l.height).toBeGreaterThanOrEqual(150);
      expect(l.height).toBeLessThanOrEqual(230);
      expect(l.scale / dpr).toBeGreaterThanOrEqual(1.7);
      // the full width is used (at most one game pixel short)
      expect(Math.round(w * dpr) - l.deviceWidth).toBeLessThan(l.scale);
    }
  });

  it('an iPad in landscape gets about 270 px of height', () => {
    const l = computePixelLayout(1024, 768, 2);
    expect(l.height).toBeGreaterThanOrEqual(250);
    expect(l.height).toBeLessThanOrEqual(310);
  });
});
