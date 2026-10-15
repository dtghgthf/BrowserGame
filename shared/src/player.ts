import { tileToLocal, type LadderDef, type ShipLayout } from './layout/parseLayout';
import { clamp } from './math';

/** Player movement tunables (meters, seconds). */
export const PLAYER = {
  /**
   * Capsule radius and half length of the straight segment: total height 1.28 m (20.5 px),
   * width 0.44 m - narrower than a one-tile hatch (0.5 m) so players fit through.
   */
  radius: 0.22,
  halfHeight: 0.42,
  mass: 70,
  walkSpeed: 4.2,
  carrySpeedFactor: 0.62,
  groundAccel: 36,
  airAccel: 14,
  jumpSpeed: 7.2,
  carryJumpFactor: 0.82,
  maxFall: 14,
  /**
   * Steady-state slide speed per m/s^2 of tangential gravity while standing on a
   * tilted deck. At 15° roll (5.7 m/s^2 tangential) this is ~1.8 m/s - clearly
   * noticeable, but slower than walking, so the player can always walk uphill.
   */
  slideFactor: 0.32,
  climbSpeed: 3.2,
  carryClimbFactor: 0.6,
  coyoteTime: 0.1,
  jumpBuffer: 0.12,
  stationRange: 0.9,
  pickRange: 1.0,
  hatchRange: 0.7,
  leakRange: 1.4,
  repairTime: 1.6,
  waterSlow: 0.55,
} as const;

export const PLAYER_HEIGHT = 2 * (PLAYER.halfHeight + PLAYER.radius);
/** Distance from body centre to feet / head. */
export const PLAYER_HALF_HEIGHT = PLAYER_HEIGHT / 2;

export interface LadderZone {
  id: number;
  x: number;
  top: number;
  bottom: number;
  hatchId: number | null;
}

export function ladderZone(layout: ShipLayout, l: LadderDef): LadderZone {
  return {
    id: l.id,
    x: tileToLocal(layout, l.tx + 0.5, 0).x,
    top: tileToLocal(layout, 0, l.top).y,
    bottom: tileToLocal(layout, 0, l.bottom + 1).y,
    hatchId: l.hatchId,
  };
}

/** Finds a ladder the player (centre px, feet y) can grab when pressing up or down. */
export function findGrabbableLadder(
  zones: readonly LadderZone[],
  px: number,
  feetY: number,
  wantUp: boolean,
  wantDown: boolean,
): LadderZone | null {
  const headY = feetY - PLAYER_HEIGHT;
  for (const z of zones) {
    if (Math.abs(px - z.x) > 0.4) continue;
    if (feetY < z.top - 0.1 || headY > z.bottom) continue;
    if (wantUp && feetY > z.top + 0.15) return z;
    if (wantDown && feetY < z.bottom - 0.15) return z;
  }
  return null;
}

/** Steady slide speed caused by tangential gravity while grounded. */
export function slideVelocity(gravityX: number): number {
  return gravityX * PLAYER.slideFactor;
}

export function moveSpeed(carrying: boolean, inWater: number): number {
  let s = PLAYER.walkSpeed * (carrying ? PLAYER.carrySpeedFactor : 1);
  if (inWater > 0.25) s *= PLAYER.waterSlow;
  return s;
}

export function clampFall(vy: number): number {
  return clamp(vy, -PLAYER.maxFall * 2, PLAYER.maxFall);
}
