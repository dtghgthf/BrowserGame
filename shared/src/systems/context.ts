import type { ShipLayout } from '../layout/parseLayout';
import type { Vec2 } from '../math';
import type { BubbleKey, GameEvent, GameState, PlayerState } from '../state';
import type { Tuning } from '../tuning';
import type { CompartmentGeometry } from '../water';

/** A ray in world space (searchlight beam). */
export interface BeamRay {
  x: number;
  y: number;
  angle: number;
}

/**
 * What the gameplay systems (`shared/src/systems/*`) may use of the simulation.
 * `Simulation` implements it; systems are plain functions over this context so
 * `simulation.ts` stays about players, physics and water.
 */
export interface SimContext {
  readonly state: GameState;
  readonly tuning: Tuning;
  readonly layout: ShipLayout;
  readonly waterGeometry: readonly CompartmentGeometry[];
  emit(e: GameEvent): void;
  say(p: PlayerState, key: BubbleKey): void;
  /** Uniform random number in [min, max) from the seeded RNG in the state. */
  rand(min: number, max: number): number;
  /** Next id for rocks, balls, pings, encounters. */
  nextId(): number;
  /** The player closest to a ship-local point who is on board (and free if asked). */
  closestPlayer(x: number, y: number, free?: boolean): PlayerState | null;
  /** Opens a leak in a part of the hull; false if none is left there. */
  leakAt(where: 'bow' | 'bottom' | 'any'): boolean;
  /** Pours water straight into a compartment (m^2). */
  addWater(compartment: number, volume: number): void;
  /** World-space ray of the searchlight, or null if it is dark. */
  searchlightRay(): BeamRay | null;
  inBeam(ray: BeamRay, x: number, y: number, size: number, range: number): boolean;
  /** Ship-local centre of the interior tile next to a leak point. */
  leakInteriorPoint(point: number): Vec2;
}
