import fileDefaults from './tuning.json';

/**
 * All gameplay numbers as plain data. Defaults come from `tuning.json`
 * (written by the in-game tuning panel via "Als Standard speichern"); every
 * Simulation owns its own copy and changes travel as `{ type: 'tune' }`
 * commands, so a future server can apply exactly the same values.
 */
export interface PlayerTuning {
  walkSpeed: number;
  carrySpeedFactor: number;
  groundAccel: number;
  airAccel: number;
  jumpSpeed: number;
  carryJumpFactor: number;
  maxFall: number;
  /** Steady slide speed per m/s^2 of tangential gravity while standing on a tilted deck. */
  slideFactor: number;
  climbSpeed: number;
  carryClimbFactor: number;
  coyoteTime: number;
  jumpBuffer: number;
  waterSlow: number;
  repairTime: number;
  stationRange: number;
  pickRange: number;
  hatchRange: number;
  leakRange: number;
  /** Seconds to pry a crate open (crowbar: x crowbarFactor). */
  openTime: number;
  /** Seconds to ram a ball home in the cannon. */
  ramTime: number;
  /** Repair time multiplier once the crew found a hammer. */
  hammerFactor: number;
  crowbarFactor: number;
  /** Seconds to cut a pirate grappling hook. */
  cutTime: number;
  /** Seconds to lash a loose crate or barrel down at its place in the hold. */
  lashTime: number;
}

export interface ShipTuning {
  initialSeaState: number;
  /** Maximum roll caused by the waves alone (degrees). */
  maxWaveRollDeg: number;
  /** Absolute roll limit including list (degrees). */
  maxRollDeg: number;
  rollResponse: number;
  offCourseRoll: number;
  rollStiffness: number;
  rollDamping: number;
  heaveStiffness: number;
  heaveDamping: number;
  hullHalfLength: number;
  heaveGravityFactor: number;
  turnRate: number;
  rudderHeelDeg: number;
  speed: number;
  listPerMoment: number;
  maxListDeg: number;
  sinkagePerVolume: number;
  inertiaPerVolume: number;
}

export interface GameplayTuning {
  gravity: number;
  leakRate: number;
  pumpStroke: number;
  pumpHandleSpeed: number;
  wheelSpeed: number;
  searchlightSpeed: number;
  cannonSpeed: number;
  sinkFraction: number;
  sunkResetTime: number;
  overboardTime: number;
  bubbleTime: number;
  /** Phase 4: voyage, storm, hazards. */
  voyageLength: number;
  stormGrowth: number;
  rockSpacingMin: number;
  rockSpacingMax: number;
  rockSpotRange: number;
  rockSeeRange: number;
  shipBeam: number;
  rockShake: number;
  ballSpeed: number;
  monsterHp: number;
  monsterSpeed: number;
  monsterAttackInterval: number;
  arrivedResetTime: number;
  pingTime: number;
  /** Phase 5: saw strokes per plank, wood at the start, solo cannon loading, searchlight oil. */
  sawStrokes: number;
  startTimber: number;
  cannonSoloLoad: number;
  /** Oil the searchlight burns per second (1 = full tank). */
  oilBurn: number;
  /** Phase 5b: encounters (share of the voyage before the first one, spacing in m, weights). */
  encounterFirstAt: number;
  encounterEvery: number;
  weightKraken: number;
  weightPirates: number;
  weightIce: number;
  weightWhirl: number;
  weightFlotsam: number;
  /** Fire: heat per second, spread chance per second at full heat, seconds until it damages the hull, rain on the open deck, bucket of water (m^2). */
  fireGrowth: number;
  fireSpread: number;
  fireDamageTime: number;
  rainDouse: number;
  bucketVolume: number;
  /** Storm: breaking waves and lightning above this sea state. */
  waveMinSea: number;
  waveEvery: number;
  wavePush: number;
  lightningEvery: number;
  lightningFireChance: number;
  /** Pirates: hits to drive them off, seconds between shots, scatter (m), hook after, chance a hit sets a fire, ship speed while hooked. */
  pirateHp: number;
  pirateFireInterval: number;
  pirateAccuracy: number;
  pirateHookAfter: number;
  pirateFireChance: number;
  hookSlow: number;
  /** Ice field length (m), hits per floe; whirlpool radius and pull. */
  iceFieldLength: number;
  iceHp: number;
  whirlRadius: number;
  whirlPull: number;
  /** Life ring: throw speed, line length, meters per pull; seconds a swimmer waits for rescue; swim speed. */
  ringSpeed: number;
  ringRope: number;
  ringPullStroke: number;
  rescueWindow: number;
  swimSpeed: number;
  /** Cargo: roll (deg) above which lashings may snap, chance per second at twice that roll, list weight of a loose crate (m^2 of water). */
  cargoBreakRoll: number;
  cargoBreakRate: number;
  cargoWeight: number;
  /** Whirlpool pull while only one person holds the wheel (two = 1 - whirlHold of the pull is resisted). */
  whirlHold: number;
  /** Pump wear: heat per stroke, cooling per second, heat above which strokes get weak, stroke factor when hot. */
  pumpHeat: number;
  pumpCool: number;
  pumpHotAt: number;
  pumpHotFactor: number;
  /** Phase 6: coins for a leg x this, passive bilge pump (m^2/s), chance a hit makes no leak (copper). */
  rewardFactor: number;
  bilgeRate: number;
  hullArmor: number;
  /** Roles: carpenter action time x, engineer pump stroke x, lookout searchlight range x, gunner solo loading time x. */
  roleCarpenter: number;
  roleEngineer: number;
  roleLookout: number;
  roleGunner: number;
}

export interface Tuning {
  player: PlayerTuning;
  ship: ShipTuning;
  gameplay: GameplayTuning;
}

export type TuningGroup = keyof Tuning;
export type TuningPatch = { [G in TuningGroup]?: Partial<Tuning[G]> };

/** Fallback values (used for keys missing in tuning.json). */
export const CODE_DEFAULTS: Readonly<Tuning> = {
  player: {
    walkSpeed: 5.6,
    carrySpeedFactor: 0.62,
    groundAccel: 44,
    airAccel: 16,
    jumpSpeed: 7.2,
    carryJumpFactor: 0.82,
    maxFall: 14,
    slideFactor: 0.32,
    climbSpeed: 3.6,
    carryClimbFactor: 0.6,
    coyoteTime: 0.1,
    jumpBuffer: 0.12,
    waterSlow: 0.55,
    repairTime: 1.6,
    stationRange: 0.9,
    pickRange: 1.0,
    hatchRange: 0.7,
    leakRange: 1.4,
    openTime: 2.2,
    ramTime: 0.7,
    hammerFactor: 0.6,
    crowbarFactor: 0.5,
    cutTime: 1.2,
    lashTime: 1.4,
  },
  ship: {
    initialSeaState: 0.75,
    maxWaveRollDeg: 15,
    maxRollDeg: 26,
    rollResponse: 0.85,
    offCourseRoll: 0.8,
    rollStiffness: 2.6,
    rollDamping: 1.5,
    heaveStiffness: 3.2,
    heaveDamping: 2.4,
    hullHalfLength: 12,
    heaveGravityFactor: 0.6,
    turnRate: 0.22,
    rudderHeelDeg: 2.6,
    speed: 3.2,
    listPerMoment: 0.0011,
    maxListDeg: 20.6,
    sinkagePerVolume: 0.022,
    inertiaPerVolume: 0.012,
  },
  gameplay: {
    gravity: 22,
    leakRate: 0.3,
    pumpStroke: 0.16,
    pumpHandleSpeed: 8,
    wheelSpeed: 0.9,
    searchlightSpeed: 1.5,
    cannonSpeed: 1.0,
    sinkFraction: 0.42,
    sunkResetTime: 5,
    overboardTime: 2.5,
    bubbleTime: 3,
    voyageLength: 1500,
    stormGrowth: 0.5,
    rockSpacingMin: 45,
    rockSpacingMax: 105,
    rockSpotRange: 95,
    rockSeeRange: 18,
    shipBeam: 2.6,
    rockShake: 0.5,
    ballSpeed: 24,
    monsterHp: 3,
    monsterSpeed: 1.4,
    monsterAttackInterval: 7,
    arrivedResetTime: 15,
    pingTime: 4,
    sawStrokes: 5,
    startTimber: 6,
    cannonSoloLoad: 3.2,
    oilBurn: 0.006,
    encounterFirstAt: 0.18,
    encounterEvery: 240,
    weightKraken: 3,
    weightPirates: 2,
    weightIce: 2,
    weightWhirl: 1.5,
    weightFlotsam: 2.5,
    fireGrowth: 0.08,
    fireSpread: 0.12,
    fireDamageTime: 16,
    rainDouse: 0.03,
    bucketVolume: 0.12,
    waveMinSea: 1.0,
    waveEvery: 38,
    wavePush: 7,
    lightningEvery: 75,
    lightningFireChance: 0.45,
    pirateHp: 4,
    pirateFireInterval: 6,
    pirateAccuracy: 3,
    pirateHookAfter: 14,
    pirateFireChance: 0.5,
    hookSlow: 0.45,
    iceFieldLength: 220,
    iceHp: 2,
    whirlRadius: 12,
    whirlPull: 0.6,
    ringSpeed: 11,
    ringRope: 22,
    ringPullStroke: 1.4,
    rescueWindow: 30,
    swimSpeed: 1.1,
    cargoBreakRoll: 11,
    cargoBreakRate: 0.25,
    cargoWeight: 2.5,
    whirlHold: 0.45,
    pumpHeat: 0.022,
    pumpCool: 0.04,
    pumpHotAt: 0.8,
    pumpHotFactor: 0.45,
    rewardFactor: 1,
    bilgeRate: 0,
    hullArmor: 0,
    roleCarpenter: 0.65,
    roleEngineer: 1.3,
    roleLookout: 1.3,
    roleGunner: 0.6,
  },
};

const GROUPS: readonly TuningGroup[] = ['player', 'ship', 'gameplay'];

export function cloneTuning(t: Readonly<Tuning>): Tuning {
  return { player: { ...t.player }, ship: { ...t.ship }, gameplay: { ...t.gameplay } };
}

/**
 * Copies known, finite numeric values from `patch` into `target`. Unknown keys
 * and non-numbers are ignored, so stale or hand-edited files cannot break the game.
 * Returns the number of values that were applied.
 */
export function applyTuningPatch(target: Tuning, patch: unknown): number {
  if (!patch || typeof patch !== 'object') return 0;
  let n = 0;
  for (const g of GROUPS) {
    const src = (patch as Record<string, unknown>)[g];
    if (!src || typeof src !== 'object') continue;
    const dst = target[g] as unknown as Record<string, number>;
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      if (!Object.hasOwn(dst, k) || typeof v !== 'number' || !Number.isFinite(v)) continue;
      dst[k] = v;
      n++;
    }
  }
  return n;
}

/** The values in `current` that differ from `base`. */
export function diffTuning(base: Readonly<Tuning>, current: Readonly<Tuning>): TuningPatch {
  const out: TuningPatch = {};
  for (const g of GROUPS) {
    const b = base[g] as unknown as Record<string, number>;
    const c = current[g] as unknown as Record<string, number>;
    for (const k of Object.keys(b)) {
      if (b[k] !== c[k]) ((out[g] ??= {}) as Record<string, number>)[k] = c[k]!;
    }
  }
  return out;
}

/** Defaults: code fallbacks overridden by tuning.json. */
export const DEFAULT_TUNING: Readonly<Tuning> = (() => {
  const t = cloneTuning(CODE_DEFAULTS);
  applyTuningPatch(t, fileDefaults);
  return t;
})();
