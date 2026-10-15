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
      [844, 390, 3],
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

  it('an iPad in landscape gets about 270 px of height', () => {
    const l = computePixelLayout(1024, 768, 2);
    expect(l.height).toBeGreaterThanOrEqual(250);
    expect(l.height).toBeLessThanOrEqual(310);
  });
});
