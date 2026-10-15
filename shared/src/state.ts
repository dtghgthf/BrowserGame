import type { PlayerInput } from './input';
import type { Vec2 } from './math';

/**
 * The complete game state as plain, serialisable data. The Rapier world inside
 * `Simulation` mirrors the physical parts of it; after every step the bodies are
 * written back here. Renderers and (later) the network layer only read this.
 *
 * Coordinates: everything inside the ship is in ship-local meters, y pointing down,
 * origin at the ship pivot (see SHIP_ORIGIN). World coordinates are only used for
 * the ship itself and the sea.
 */
export interface ShipState {
  /** World x of the pivot (distance travelled), meters. */
  x: number;
  /** World y of the pivot (y-down, calm sea level = 0). */
  y: number;
  /** Heave velocity / acceleration (y-down). */
  vy: number;
  ay: number;
  /** Roll angle in radians. Positive = clockwise on screen (bow / right side goes down). */
  roll: number;
  rollVel: number;
  /** Static heel caused by water in the hull and the rudder (radians, part of the roll target). */
  list: number;
  /** Course error in radians (0 = heading straight for the lighthouse). */
  heading: number;
  /** Rudder position -1..1 (set by the steering wheel). */
  rudder: number;
  /** Forward speed in m/s. */
  speed: number;
  /** Apparent gravity in the ship frame (m/s^2). */
  gravity: Vec2;
  /** Wave amplitude scale. 0 = flat calm, 1 = rough, 1.3 = storm. */
  seaState: number;
  /** Extra draft caused by water in the hull (m). */
  sinkage: number;
}

export type AnimState = 'idle' | 'run' | 'jump' | 'fall' | 'climb' | 'station' | 'repair' | 'swim';

export interface PlayerAction {
  kind: 'repair';
  target: number;
  progress: number;
}

export type BubbleKey = 'leak' | 'water' | 'plank' | 'help';

export interface PlayerState {
  id: string;
  /** Display name (lobby). */
  name: string;
  /** Colour slot 0..3. */
  color: number;
  /** Disconnected, waiting for a reconnect (rendered faded). */
  away: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  /** 0..1 how deep the player stands in water. */
  inWater: number;
  /** Ladder id while climbing. */
  climbing: number | null;
  /** Station id while operating a station. */
  station: number | null;
  /** Object id of the carried object. */
  carrying: number | null;
  action: PlayerAction | null;
  anim: AnimState;
  animTime: number;
  prevInput: PlayerInput;
  /** Seconds until respawn after falling overboard (0 = on board). */
  overboard: number;
  /** Automatic speech bubble (communication without voice). */
  bubble: { key: BubbleKey; time: number } | null;
  // Controller internals. They live in the state (not in the simulation object)
  // so a client can load a server snapshot and re-simulate from it exactly.
  /** Seconds since the player last stood on the ground (coyote time). */
  airTime: number;
  /** Remaining jump buffer in seconds. */
  jumpBuffer: number;
  /** Highest downward speed of the current fall (landing events). */
  fallSpeed: number;
  /** Whether one-way platforms (open ladder hatches) are currently solid for this player. */
  solidPlatforms: boolean;
}

export type ObjectKind = 'crate' | 'barrel' | 'plank';

export interface ObjectState {
  id: number;
  kind: ObjectKind;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  /** Angular velocity (rad/s). */
  av: number;
  carriedBy: string | null;
  /** Where the object respawns after falling overboard (null = it is removed instead). */
  spawn: Vec2 | null;
}

export interface HatchState {
  id: number;
  open: boolean;
}

export interface CompartmentState {
  id: number;
  /** Water volume in m^2. */
  volume: number;
  /** Ship-local y of the water surface at the compartment's centre column (only meaningful if volume > 0). */
  surfaceY: number;
  /** Slope dy/dx of the water surface in the ship frame. */
  slope: number;
  slopeVel: number;
  /** Ship-local x of the water's centre of mass. */
  centroidX: number;
}

export interface LeakState {
  id: number;
  /** Index into layout.leakPoints. */
  point: number;
  active: boolean;
  /** Current inflow in m^2/s (for effects / UI). */
  inflow: number;
}

export type StationKind = 'wheel' | 'pump' | 'searchlight' | 'cannon' | 'workshop';

export interface StationState {
  id: number;
  kind: StationKind;
  /** Ship-local position where the operator stands (feet). */
  x: number;
  y: number;
  occupant: string | null;
  /**
   * wheel: rudder -1..1, pump: handle -1..1, searchlight: beam angle (rad, ship frame),
   * cannon: aim angle, workshop: cooldown seconds.
   */
  value: number;
  /** wheel: visual wheel angle, pump: total strokes, searchlight: intensity, workshop: planks handed out. */
  aux: number;
}

export type GameEvent =
  | { type: 'leak'; leak: number }
  | { type: 'repaired'; leak: number }
  | { type: 'pumpStroke'; player: string | null; station: number; volume: number }
  | { type: 'hatch'; player: string | null; hatch: number; open: boolean }
  | { type: 'pickup'; player: string; object: number }
  | { type: 'drop'; player: string; object: number }
  | { type: 'jump'; player: string }
  | { type: 'land'; player: string; speed: number }
  | { type: 'splash'; x: number; y: number; strength: number }
  | { type: 'station'; player: string; station: number; enter: boolean }
  | { type: 'overboard'; player: string }
  | { type: 'sunk' }
  | { type: 'reset' };

export type GameStatus = 'sailing' | 'sunk';

export interface GameState {
  tick: number;
  time: number;
  rng: number;
  status: GameStatus;
  statusTimer: number;
  ship: ShipState;
  players: PlayerState[];
  objects: ObjectState[];
  hatches: HatchState[];
  compartments: CompartmentState[];
  leaks: LeakState[];
  stations: StationState[];
  /** Events produced during the last step (cleared at the start of each step). */
  events: GameEvent[];
  nextObjectId: number;
  /** Debug: roll angle forced by F4 (radians) or null. */
  forcedRoll: number | null;
  /** Next leak point tried by the debug leak key. */
  leakCursor: number;
}
