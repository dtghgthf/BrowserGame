import { GRAVITY } from './constants';
import { DEFAULT_TUNING, type ShipTuning } from './tuning';
import { clamp, rotate, type Vec2 } from './math';
import { waveHeight, waveSlope } from './sea';
import type { ShipState } from './state';

const DEG = Math.PI / 180;

export function createShipState(M: Readonly<ShipTuning> = DEFAULT_TUNING.ship, gravity = GRAVITY, seaState = M.initialSeaState): ShipState {
  return {
    x: 0,
    y: 0,
    vy: 0,
    ay: 0,
    roll: 0,
    rollVel: 0,
    list: 0,
    heading: 0.15,
    rudder: 0,
    speed: M.speed,
    gravity: { x: 0, y: gravity },
    seaState,
    sinkage: 0,
  };
}

/** Slow, deterministic current that pushes the ship off course (rad/s). */
export function courseDrift(t: number): number {
  return 0.05 * Math.sin(t * 0.13 + 1.3) + 0.03 * Math.sin(t * 0.37 + 0.2) + 0.012;
}

/** Wave-only target roll at the ship's position (y-down convention: positive = right side down). */
export function waveRollTarget(ship: ShipState, t: number, M: Readonly<ShipTuning> = DEFAULT_TUNING.ship): number {
  const L = M.hullHalfLength;
  const slope =
    (waveSlope(ship.x - L, t, ship.seaState) +
      2 * waveSlope(ship.x, t, ship.seaState) +
      waveSlope(ship.x + L, t, ship.seaState)) /
    4;
  const response = M.rollResponse * (1 + M.offCourseRoll * Math.abs(Math.sin(ship.heading)));
  // Rising surface to the right (positive slope, y-up) lifts the right side: counter-clockwise = negative roll.
  const max = M.maxWaveRollDeg * DEG;
  return clamp(-Math.atan(slope) * response, -max, max);
}

/** Average wave height under the hull (y-up). */
export function hullWaveHeight(ship: ShipState, t: number, M: Readonly<ShipTuning> = DEFAULT_TUNING.ship): number {
  const L = M.hullHalfLength;
  return (
    (waveHeight(ship.x - L, t, ship.seaState) +
      2 * waveHeight(ship.x, t, ship.seaState) +
      waveHeight(ship.x + L, t, ship.seaState)) /
    4
  );
}

/**
 * Apparent gravity in the ship frame. The ship itself never rotates in the
 * physics world - instead gravity is rotated by -roll. Heave acceleration makes
 * things feel lighter on the way down and heavier on the way up.
 */
export function apparentGravity(roll: number, heaveAccel: number, gravity = GRAVITY, heaveFactor = 0.6, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  const scale = clamp(1 - (heaveAccel / 9.81) * heaveFactor, 0.7, 1.3);
  return rotate({ x: 0, y: gravity * scale }, -roll, out);
}

export interface HullLoad {
  /** Total water volume in m^2. */
  volume: number;
  /** Sum of volume * centroid x (ship-local), m^3. */
  moment: number;
}

/** Advances the ship motion by dt. `t` is the simulation time at the end of the step. */
export function updateShip(
  ship: ShipState,
  t: number,
  dt: number,
  load: HullLoad,
  M: Readonly<ShipTuning> = DEFAULT_TUNING.ship,
  gravity = GRAVITY,
): void {
  // course
  ship.heading = clamp(ship.heading + (ship.rudder * M.turnRate + courseDrift(t)) * dt, -1.3, 1.3);
  ship.speed = M.speed * (0.35 + 0.65 * Math.cos(ship.heading));
  ship.x += ship.speed * dt;

  // list from water distribution and rudder heel
  const maxList = M.maxListDeg * DEG;
  const waterList = clamp(load.moment * M.listPerMoment, -maxList, maxList);
  ship.list = waterList + ship.rudder * M.rudderHeelDeg * DEG;

  // roll: damped spring towards the wave roll + list
  const maxRoll = M.maxRollDeg * DEG;
  const target = clamp(waveRollTarget(ship, t, M) + ship.list, -maxRoll, maxRoll);
  const inertia = 1 + load.volume * M.inertiaPerVolume;
  const rollAcc = (M.rollStiffness * (target - ship.roll) - M.rollDamping * ship.rollVel) / inertia;
  ship.rollVel += rollAcc * dt;
  ship.roll = clamp(ship.roll + ship.rollVel * dt, -maxRoll, maxRoll);

  // heave: follow the averaged wave height plus sinkage from water in the hull
  ship.sinkage = load.volume * M.sinkagePerVolume;
  const targetY = -hullWaveHeight(ship, t, M) + ship.sinkage;
  ship.ay = M.heaveStiffness * (targetY - ship.y) - M.heaveDamping * ship.vy;
  ship.vy += ship.ay * dt;
  ship.y += ship.vy * dt;

  apparentGravity(ship.roll, ship.ay, gravity, M.heaveGravityFactor, ship.gravity);
}

/** Transforms a ship-local point into world coordinates. */
export function shipToWorld(ship: Pick<ShipState, 'x' | 'y' | 'roll'>, p: Vec2, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  rotate(p, ship.roll, out);
  out.x += ship.x;
  out.y += ship.y;
  return out;
}

/** Transforms a world point into ship-local coordinates. */
export function worldToShip(ship: Pick<ShipState, 'x' | 'y' | 'roll'>, p: Vec2, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  return rotate({ x: p.x - ship.x, y: p.y - ship.y }, -ship.roll, out);
}
