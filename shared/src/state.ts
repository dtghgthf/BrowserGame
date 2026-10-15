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
  /** Course error in radians (0 = parallel to the course line towards the lighthouse). */
  heading: number;
  /** Sideways offset from the course line (m, top-down view; + = starboard). Decides which rocks are in the way. */
  lateral: number;
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

/**
 * Timed actions: repair a leak (target = leak id), open a crate (object id),
 * ram the cannon ball home (station id), cut a pirate grappling hook (0).
 */
export type PlayerActionKind = 'repair' | 'open' | 'ram' | 'cut';

export interface PlayerAction {
  kind: PlayerActionKind;
  target: number;
  progress: number;
}

export type BubbleKey =
  | 'leak'
  | 'water'
  | 'plank'
  | 'help'
  | 'wheel'
  | 'rock'
  | 'monster'
  | 'land'
  | 'rat'
  | 'oil'
  | 'wood'
  | 'fire'
  | 'wave'
  | 'pirate'
  | 'overboard'
  | 'whirl'
  | 'flotsam';

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
  /** While overboard: world x of the swimmer (the ship sails away, the life ring can reach him). */
  seaX: number;
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

export type ObjectKind = 'crate' | 'barrel' | 'plank' | 'bucket' | 'oilcan' | 'ball';

/**
 * What can be inside a crate. Objects pop out as objects; `timber` and `coins`
 * go to the ship's stock, `hammer` / `crowbar` are tools for the whole crew,
 * the `rat` jumps out and runs away (and nibbles a plank of the stock).
 */
export type LootKind = 'plank' | 'timber' | 'ball' | 'oilcan' | 'bucket' | 'coins' | 'hammer' | 'crowbar' | 'rat';

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
  /** Crate: what is inside (decided by the seeded RNG when it is created). */
  contents: LootKind[];
  /** Crate / barrel: lid pried open. */
  opened: boolean;
  /** Bucket: water 0..1, oil can / barrel: oil 0..1. */
  fill: number;
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

export type StationKind = 'wheel' | 'pump' | 'searchlight' | 'cannon' | 'workshop' | 'rack' | 'ring';

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
  /** wheel: visual wheel angle, pump: total strokes, searchlight: intensity, workshop: planks made. */
  aux: number;
  /**
   * cannon: load 0 = empty, 1 = ball inside, 2 = rammed / ready (fractions while the operator loads alone),
   * searchlight: oil 0..1, workshop: saw progress of the current plank 0..1.
   */
  charge: number;
}

/** A fire on a deck tile (fires burn on floors: an air tile with something solid below). */
export interface FireState {
  id: number;
  tx: number;
  ty: number;
  /** 0..1, grows while it burns. */
  heat: number;
  /** Seconds burning (long fires damage the hull). */
  age: number;
}

export type RockKind = 'rock' | 'ice';

/** The pirates' sloop: sails ahead of the bow, fires back and throws a grappling hook. */
export type PiratePhase = 'approach' | 'fight' | 'flee';

export interface PirateState {
  /** Distance ahead of the ship pivot (m). */
  offset: number;
  hp: number;
  phase: PiratePhase;
  timer: number;
  fireIn: number;
  /** > 0: a grappling hook holds the bow (seconds it has held). */
  hook: number;
  hookIn: number;
  hurt: number;
  spotted: boolean;
}

/** A whirlpool ahead: pulls the ship sideways and spins it. */
export interface WhirlState {
  x: number;
  lateral: number;
  radius: number;
  spotted: boolean;
  /** The ship went through the middle (one hard knock). */
  hit: boolean;
}

/** A crate drifting in the water, to be fished out alongside. */
export interface FlotsamState {
  id: number;
  x: number;
  lateral: number;
  spotted: boolean;
}

export type RingPhase = 'flying' | 'floating' | 'pulling';

/** The life ring on its line (world coordinates). */
export interface RingState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: RingPhase;
  /** The swimmer holding on. */
  holder: string | null;
}

/** A rock ahead in the fog. Coordinates in the top-down sense: along the course (world x) and sideways. */
export interface RockState {
  id: number;
  /** World x (distance along the course). */
  x: number;
  /** Sideways position (m), compare with ship.lateral. */
  lateral: number;
  radius: number;
  /** Seen by the crew (searchlight or close enough): shown on the sea chart. */
  spotted: boolean;
  /** The ship already ran into it. */
  hit: boolean;
  kind: RockKind;
  /** Cannon hits it still takes (ice needs two). */
  hp: number;
}

export type MonsterPhase = 'approach' | 'attack' | 'flee';

/** The kraken: surfaces ahead in the fog, grabs the bow and punches leaks until it is shot away. */
export interface MonsterState {
  /** Distance ahead of the ship pivot (m, world x offset). */
  offset: number;
  /** 0 = surfaced, 1 = submerged. */
  depth: number;
  hp: number;
  phase: MonsterPhase;
  /** Seconds in the current phase. */
  timer: number;
  /** Seconds until the next attack (phase attack). */
  attackIn: number;
  spotted: boolean;
  /** > 0 right after a hit (seconds, for the flash). */
  hurt: number;
}

/** A cannonball in flight (world coordinates). */
export interface BallState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  /** Who fired it: the crew's balls hit the kraken / rocks / pirates, the pirates' hit the ship. */
  pirate: boolean;
}

export type PingKind =
  | 'here'
  | 'help'
  | 'danger'
  | 'leak'
  | 'hatch'
  | 'plank'
  | 'wheel'
  | 'pump'
  | 'searchlight'
  | 'cannon'
  | 'fire'
  | 'crate'
  | 'ring';

/** A marker a player put on a spot (communication without voice). Ship-local position. */
export interface PingState {
  id: number;
  player: string;
  kind: PingKind;
  x: number;
  y: number;
  /** Seconds left. */
  time: number;
}

export interface VoyageState {
  /** Distance to the lighthouse at the start (m); the ship has arrived when ship.x reaches it. */
  length: number;
  /** Sea state without the storm (debug keys change this one). */
  seaBase: number;
  /** World x where the next rock appears / the next encounter (kraken, pirates, ...) starts. */
  nextRockX: number;
  nextEncounterX: number;
  /** Rocks are ice floes until the ship passes this world x (ice field encounter). */
  iceUntilX: number;
  /** Seconds until the next breaking wave / lightning strike (only in a storm). */
  waveIn: number;
  /** > 0: a breaking wave is coming (warning seconds left). */
  waveWarn: number;
  lightningIn: number;
  firesPut: number;
  piratesBeaten: number;
  flotsamFished: number;
  rescues: number;
  rocksHit: number;
  rocksPassed: number;
  rocksDestroyed: number;
  monstersRepelled: number;
  leaksRepaired: number;
  /** Set when the crew first saw the lighthouse up close (one shout). */
  landSighted: boolean;
  /** Wood in stock for the workshop (one plank each). */
  timber: number;
  /** Coins found on the way (spent in the harbour). */
  coins: number;
  cratesOpened: number;
  /** Tools found in crates (crew-wide): faster repairs / faster opening. */
  hammer: boolean;
  crowbar: boolean;
}

/** Cooldowns of the automatic shouts (seconds). */
export interface ShoutCooldowns {
  wheel: number;
  water: number;
  rock: number;
  oil: number;
  fire: number;
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
  | { type: 'reset' }
  | { type: 'rockSpotted'; rock: number }
  | { type: 'rockHit'; rock: number; x: number }
  | { type: 'rockBreak'; rock: number; x: number }
  | { type: 'cannonFire'; player: string | null; x: number; y: number; angle: number }
  | { type: 'ballSplash'; x: number; y: number }
  | { type: 'monsterAppear' }
  | { type: 'monsterAttack' }
  | { type: 'monsterHit'; hp: number }
  | { type: 'monsterFlee' }
  | { type: 'ping'; player: string; kind: PingKind }
  | { type: 'shout'; player: string; key: BubbleKey }
  | { type: 'arrived' }
  | { type: 'crateOpen'; player: string; object: number; loot: LootKind[] }
  | { type: 'sawStroke'; player: string | null; station: number }
  | { type: 'plankMade'; station: number }
  | { type: 'cannonLoad'; player: string | null; station: number; charge: number }
  | { type: 'refill'; player: string; what: 'oil' }
  | { type: 'breakUp'; player: string }
  | { type: 'fire'; x: number; y: number }
  | { type: 'extinguish'; x: number; y: number }
  | { type: 'bucket'; player: string; what: 'scoop' | 'pour' | 'douse' }
  | { type: 'waveWarn' }
  | { type: 'wave' }
  | { type: 'lightning'; x: number; y: number }
  | { type: 'pirateAppear' }
  | { type: 'pirateFire'; x: number; y: number; angle: number }
  | { type: 'pirateHit'; hp: number }
  | { type: 'pirateFlee' }
  | { type: 'shipHit'; x: number; y: number }
  | { type: 'hook'; on: boolean }
  | { type: 'whirlAppear' }
  | { type: 'whirlHit' }
  | { type: 'iceHit'; rock: number; x: number }
  | { type: 'flotsamFished'; player: string; id: number }
  | { type: 'ringThrow'; player: string }
  | { type: 'ringCatch'; player: string }
  | { type: 'rescued'; player: string };

export type GameStatus = 'sailing' | 'sunk' | 'arrived';

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
  voyage: VoyageState;
  rocks: RockState[];
  monster: MonsterState | null;
  pirate: PirateState | null;
  whirl: WhirlState | null;
  flotsam: FlotsamState[];
  fires: FireState[];
  ring: RingState | null;
  balls: BallState[];
  pings: PingState[];
  shouts: ShoutCooldowns;
  /** Id counter for rocks, balls and pings. */
  nextId: number;
}
