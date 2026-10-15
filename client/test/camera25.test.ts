import { describe, expect, it } from 'vitest';
import { Camera25 } from '../src/stage/Camera25';

function cam(): Camera25 {
  const c = new Camera25();
  c.target = { x: 2, y: -1, z: 0 };
  c.cx = 240;
  c.cy = 135;
  c.pxPerMeter = 16;
  c.baseDistance = 12;
  c.distance = 12;
  c.update();
  return c;
}

describe('Camera25', () => {
  it('without yaw / pitch the z = 0 plane matches the 2D view (16 px per meter)', () => {
    const c = cam();
    const p = c.project({ x: 3, y: 0, z: 0 })!;
    expect(p.x).toBeCloseTo(240 + 16, 6);
    expect(p.y).toBeCloseTo(135 + 16, 6);
    expect(p.depth).toBeCloseTo(12, 6);
  });

  it('things in front are bigger and nearer, things behind smaller and farther', () => {
    const c = cam();
    const front = c.project({ x: 3, y: -1, z: 2 })!;
    const back = c.project({ x: 3, y: -1, z: -2 })!;
    expect(front.x - 240).toBeGreaterThan(16);
    expect(back.x - 240).toBeLessThan(16);
    expect(front.depth).toBeLessThan(back.depth);
  });

  it('dollying in zooms around the target', () => {
    const c = cam();
    c.distance = 6;
    c.update();
    const p = c.project({ x: 3, y: -1, z: 0 })!;
    expect(p.x).toBeCloseTo(240 + 32, 6);
    expect(c.project(c.target)!.x).toBeCloseTo(240, 6);
  });

  it('unproject is the inverse of project on a plane, also with yaw, pitch and roll', () => {
    const c = cam();
    c.yaw = 0.4;
    c.pitch = 0.2;
    c.roll = 0.1;
    c.rollPivot = { x: 0, y: 0, z: 0 };
    c.distance = 7;
    c.update();
    for (const pt of [
      { x: 2.5, y: -1.2, z: 0 },
      { x: 0.3, y: 0.4, z: -1.5 },
      { x: 4, y: -2, z: 1 },
    ]) {
      const s = c.project(pt)!;
      const back = c.unproject(s.x, s.y, pt.z)!;
      expect(back.x).toBeCloseTo(pt.x, 5);
      expect(back.y).toBeCloseTo(pt.y, 5);
    }
  });

  it('a positive yaw shows the right side: points in front move left relative to points behind', () => {
    const c = cam();
    c.yaw = 0.5;
    c.update();
    const front = c.project({ x: 2, y: -1, z: 1 })!;
    const back = c.project({ x: 2, y: -1, z: -1 })!;
    expect(front.x).toBeLessThan(back.x);
  });

  it('the target always appears at the principal point, a camera above looks down on the floor', () => {
    const c = cam();
    c.yaw = 0.3;
    c.pitch = 0.4;
    c.distance = 5;
    c.update();
    const t = c.project(c.target)!;
    expect(t.x).toBeCloseTo(240, 6);
    expect(t.y).toBeCloseTo(135, 6);
    expect(t.depth).toBeCloseTo(5, 6);
    // looking down: a floor point in front of the target is lower on screen than one behind it
    const near = c.project({ x: 2, y: 0, z: 1 })!;
    const far = c.project({ x: 2, y: 0, z: -1 })!;
    expect(near.y).toBeGreaterThan(far.y);
  });

  it('points behind the camera are not projected', () => {
    const c = cam();
    expect(c.project({ x: 2, y: -1, z: 13 })).toBeNull();
  });
});
