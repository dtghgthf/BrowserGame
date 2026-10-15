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
  workshopCooldown: number;
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
  cannonReload: number;
  ballSpeed: number;
  monsterFirstAt: number;
  monsterEvery: number;
  monsterHp: number;
  monsterSpeed: number;
  monsterAttackInterval: number;
  arrivedResetTime: number;
  pingTime: number;
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
    workshopCooldown: 1.0,
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
    cannonReload: 2.2,
    ballSpeed: 24,
    monsterFirstAt: 0.3,
    monsterEvery: 450,
    monsterHp: 3,
    monsterSpeed: 1.4,
    monsterAttackInterval: 7,
    arrivedResetTime: 15,
    pingTime: 4,
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
