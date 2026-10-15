import { tileToLocal, type LadderDef, type ShipLayout } from './layout/parseLayout';
import { clamp } from './math';
import type { PlayerTuning } from './tuning';

/** Fixed player body shape (not tunable at runtime: it is the physics collider). */
export const PLAYER_SHAPE = {
  /**
   * Capsule radius and half length of the straight segment: total height 1.28 m (20.5 px),
   * width 0.44 m - narrower than a one-tile hatch (0.5 m) so players fit through.
   */
  radius: 0.22,
  halfHeight: 0.42,
  mass: 70,
} as const;

export const PLAYER_HEIGHT = 2 * (PLAYER_SHAPE.halfHeight + PLAYER_SHAPE.radius);
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
export function slideVelocity(T: Readonly<PlayerTuning>, gravityX: number): number {
  return gravityX * T.slideFactor;
}

export function moveSpeed(T: Readonly<PlayerTuning>, carrying: boolean, inWater: number): number {
  let s = T.walkSpeed * (carrying ? T.carrySpeedFactor : 1);
  if (inWater > 0.25) s *= T.waterSlow;
  return s;
}

export function clampFall(T: Readonly<PlayerTuning>, vy: number): number {
  return clamp(vy, -T.maxFall * 2, T.maxFall);
}
