import { describe, expect, it } from 'vitest';
import { GRAVITY, apparentGravity, rotate, shipToWorld, worldToShip } from '../src';

const deg = (d: number) => (d * Math.PI) / 180;

describe('gravity rotation in the ship frame', () => {
  it('points straight down when the ship is level and not heaving', () => {
    const g = apparentGravity(0, 0);
    expect(g.x).toBeCloseTo(0, 10);
    expect(g.y).toBeCloseTo(GRAVITY, 10);
  });

  it('is rotated by -roll: positive roll (right side down) pulls things to +x', () => {
    const g = apparentGravity(deg(15), 0);
    expect(g.x).toBeGreaterThan(0);
    expect(g.x).toBeCloseTo(GRAVITY * Math.sin(deg(15)), 8);
    expect(g.y).toBeCloseTo(GRAVITY * Math.cos(deg(15)), 8);
    const gl = apparentGravity(deg(-10), 0);
    expect(gl.x).toBeLessThan(0);
  });

  it('keeps its magnitude under rotation', () => {
    for (const a of [-15, -7, 0, 3, 15]) {
      const g = apparentGravity(deg(a), 0);
      expect(Math.hypot(g.x, g.y)).toBeCloseTo(GRAVITY, 8);
    }
  });

  it('matches world-down transformed into the ship frame', () => {
    const roll = deg(12);
    const ship = { x: 5, y: -1, roll };
    // a point straight below another point in world space...
    const a = worldToShip(ship, { x: 7, y: 0 });
    const b = worldToShip(ship, { x: 7, y: 1 });
    const down = { x: b.x - a.x, y: b.y - a.y };
    const g = apparentGravity(roll, 0);
    expect(down.x * GRAVITY).toBeCloseTo(g.x, 8);
    expect(down.y * GRAVITY).toBeCloseTo(g.y, 8);
  });

  it('heave acceleration changes the felt weight', () => {
    const accelDown = apparentGravity(0, 4); // ship accelerating downwards -> lighter
    const accelUp = apparentGravity(0, -4);
    expect(accelDown.y).toBeLessThan(GRAVITY);
    expect(accelUp.y).toBeGreaterThan(GRAVITY);
  });

  it('shipToWorld and worldToShip are inverse', () => {
    const ship = { x: 12.5, y: 0.7, roll: deg(-9) };
    const p = { x: -3.2, y: 1.7 };
    const w = shipToWorld(ship, p);
    const back = worldToShip(ship, w);
    expect(back.x).toBeCloseTo(p.x, 10);
    expect(back.y).toBeCloseTo(p.y, 10);
    const r = rotate({ x: 1, y: 0 }, Math.PI / 2);
    expect(r.x).toBeCloseTo(0, 10);
    expect(r.y).toBeCloseTo(1, 10); // +90° = clockwise on a y-down screen
  });
});
