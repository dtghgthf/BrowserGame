import { describe, expect, it } from 'vitest';
import { visibilityPolygon, type Segment } from '../src/render/lighting/visibility';

function pointInPolygon(x: number, y: number, pts: number[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i]!;
    const yi = pts[i + 1]!;
    const xj = pts[j]!;
    const yj = pts[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const box = (x0: number, y0: number, x1: number, y1: number): Segment[] => [
  { ax: x0, ay: y0, bx: x1, by: y0 },
  { ax: x1, ay: y0, bx: x1, by: y1 },
  { ax: x1, ay: y1, bx: x0, by: y1 },
  { ax: x0, ay: y1, bx: x0, by: y0 },
];

describe('visibility polygon', () => {
  it('without occluders it is the bounding square', () => {
    const poly = visibilityPolygon(0, 0, 50, []);
    expect(pointInPolygon(40, 40, poly)).toBe(true);
    expect(pointInPolygon(-40, 10, poly)).toBe(true);
    expect(pointInPolygon(60, 0, poly)).toBe(false);
  });

  it('a wall casts a shadow behind it', () => {
    const wall: Segment[] = [{ ax: 20, ay: -10, bx: 20, by: 10 }];
    const poly = visibilityPolygon(0, 0, 100, wall);
    expect(pointInPolygon(10, 0, poly)).toBe(true); // in front of the wall
    expect(pointInPolygon(40, 0, poly)).toBe(false); // in its shadow
    expect(pointInPolygon(40, 30, poly)).toBe(true); // beside the shadow
  });

  it('a light inside a room only lights the room', () => {
    const room = box(-30, -20, 30, 20);
    const poly = visibilityPolygon(0, 0, 200, room);
    expect(pointInPolygon(25, 15, poly)).toBe(true);
    expect(pointInPolygon(35, 0, poly)).toBe(false);
    for (let i = 0; i < poly.length; i += 2) {
      expect(Math.abs(poly[i]!)).toBeLessThanOrEqual(30.0001);
      expect(Math.abs(poly[i + 1]!)).toBeLessThanOrEqual(20.0001);
    }
  });

  it('penetration lets light reach a few px into walls', () => {
    const room = box(-30, -20, 30, 20);
    const poly = visibilityPolygon(0, 0, 200, room, { penetration: 4 });
    expect(pointInPolygon(32, 0, poly)).toBe(true);
    expect(pointInPolygon(36, 0, poly)).toBe(false);
  });

  it('a cone only covers its angle range', () => {
    const poly = visibilityPolygon(0, 0, 100, [], { direction: 0, halfAngle: 0.3 });
    const fan = [0, 0, ...poly];
    expect(pointInPolygon(60, 0, fan)).toBe(true);
    expect(pointInPolygon(60, 30, fan)).toBe(false);
    expect(pointInPolygon(-60, 0, fan)).toBe(false);
  });
});
