import { GRAVITY } from './constants';
import { clamp, rotate, type Vec2 } from './math';
import { waveHeight, waveSlope } from './sea';
import type { ShipState } from './state';

/** Tunables of the ship motion model. */
export const SHIP_MOTION = {
  /** Maximum roll caused by the waves alone (±15°). */
  maxWaveRoll: (15 * Math.PI) / 180,
  /** Absolute roll limit including list from water (beyond this the ship is lost anyway). */
  maxRoll: (26 * Math.PI) / 180,
  /** Scale from (averaged) wave slope to target roll. */
  rollResponse: 0.85,
  /** Extra roll when the ship is off course (waves hit it from the side). */
  offCourseRoll: 0.8,
  /** Roll spring stiffness (1/s^2) and damping (1/s). Natural period ~4 s. */
  rollStiffness: 2.6,
  rollDamping: 1.5,
  /** Heave spring. */
  heaveStiffness: 3.2,
  heaveDamping: 2.4,
  /** Half length over which the hull averages the waves (m). */
  hullHalfLength: 12,
  /** Fraction of the heave acceleration felt as change of gravity. */
  heaveGravityFactor: 0.6,
  /** Turn rate per rudder unit (rad/s). */
  turnRate: 0.22,
  /** Heel caused by full rudder (rad). */
  rudderHeel: 0.045,
  /** Base forward speed m/s. */
  speed: 3.2,
  /** List per unit water moment (rad per m^3). */
  listPerMoment: 0.0011,
  maxList: 0.36,
  /** Extra draft per m^2 of water in the hull. */
  sinkagePerVolume: 0.022,
  /** How much water in the hull slows down the roll (inertia per m^2). */
  inertiaPerVolume: 0.012,
} as const;

export function createShipState(seaState = 0.75): ShipState {
  const s: ShipState = {
    x: 0,
    y: 0,
    vy: 0,
    ay: 0,
    roll: 0,
    rollVel: 0,
    list: 0,
    heading: 0.15,
    rudder: 0,
    speed: SHIP_MOTION.speed,
    gravity: { x: 0, y: GRAVITY },
    seaState,
    sinkage: 0,
  };
  return s;
}

/** Slow, deterministic current that pushes the ship off course (rad/s). */
export function courseDrift(t: number): number {
  return 0.05 * Math.sin(t * 0.13 + 1.3) + 0.03 * Math.sin(t * 0.37 + 0.2) + 0.012;
}

/** Wave-only target roll at the ship's position (y-down convention: positive = right side down). */
export function waveRollTarget(ship: ShipState, t: number): number {
  const L = SHIP_MOTION.hullHalfLength;
  const slope =
    (waveSlope(ship.x - L, t, ship.seaState) +
      2 * waveSlope(ship.x, t, ship.seaState) +
      waveSlope(ship.x + L, t, ship.seaState)) /
    4;
  const response = SHIP_MOTION.rollResponse * (1 + SHIP_MOTION.offCourseRoll * Math.abs(Math.sin(ship.heading)));
  // Rising surface to the right (positive slope, y-up) lifts the right side: counter-clockwise = negative roll.
  return clamp(-Math.atan(slope) * response, -SHIP_MOTION.maxWaveRoll, SHIP_MOTION.maxWaveRoll);
}

/** Average wave height under the hull (y-up). */
export function hullWaveHeight(ship: ShipState, t: number): number {
  const L = SHIP_MOTION.hullHalfLength;
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
export function apparentGravity(roll: number, heaveAccel: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  const scale = clamp(1 - (heaveAccel / 9.81) * SHIP_MOTION.heaveGravityFactor, 0.7, 1.3);
  return rotate({ x: 0, y: GRAVITY * scale }, -roll, out);
}

export interface HullLoad {
  /** Total water volume in m^2. */
  volume: number;
  /** Sum of volume * centroid x (ship-local), m^3. */
  moment: number;
}

/** Advances the ship motion by dt. `t` is the simulation time at the end of the step. */
export function updateShip(ship: ShipState, t: number, dt: number, load: HullLoad): void {
  const M = SHIP_MOTION;
  // course
  ship.heading = clamp(ship.heading + (ship.rudder * M.turnRate + courseDrift(t)) * dt, -1.3, 1.3);
  ship.speed = M.speed * (0.35 + 0.65 * Math.cos(ship.heading));
  ship.x += ship.speed * dt;

  // list from water distribution and rudder heel
  const waterList = clamp(load.moment * M.listPerMoment, -M.maxList, M.maxList);
  ship.list = waterList + ship.rudder * M.rudderHeel;

  // roll: damped spring towards the wave roll + list
  const target = clamp(waveRollTarget(ship, t) + ship.list, -M.maxRoll, M.maxRoll);
  const inertia = 1 + load.volume * M.inertiaPerVolume;
  const rollAcc = (M.rollStiffness * (target - ship.roll) - M.rollDamping * ship.rollVel) / inertia;
  ship.rollVel += rollAcc * dt;
  ship.roll = clamp(ship.roll + ship.rollVel * dt, -M.maxRoll, M.maxRoll);

  // heave: follow the averaged wave height plus sinkage from water in the hull
  ship.sinkage = load.volume * M.sinkagePerVolume;
  const targetY = -hullWaveHeight(ship, t) + ship.sinkage;
  ship.ay = M.heaveStiffness * (targetY - ship.y) - M.heaveDamping * ship.vy;
  ship.vy += ship.ay * dt;
  ship.y += ship.vy * dt;

  apparentGravity(ship.roll, ship.ay, ship.gravity);
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
