import { SIM_DT, WORLD_GRAVITY } from './constants';
import { copyInput, EMPTY_INPUT, type InputMap, type PlayerInput, type SimCommand } from './input';
import { COMPARTMENT_NAMES, SHIP_MAP, SHIP_ORIGIN } from './layout/shipMap';
import { compartmentAtLocal, parseLayout, tileToLocal, type MarkerDef, type ShipLayout } from './layout/parseLayout';
import { approach, clamp, wrapAngle, type Vec2 } from './math';
import {
  applyHatchState,
  buildStaticColliders,
  createObjectBody,
  GROUP,
  groups,
  initPhysics,
  OBJECT_SPECS,
  PLAYER_FILTER_BASE,
  RAPIER,
  type Collider,
  type RigidBody,
  type World,
} from './physics';
import {
  clampFall,
  findGrabbableLadder,
  ladderZone,
  moveSpeed,
  PLAYER_HALF_HEIGHT,
  PLAYER_SHAPE,
  PLAYER_HEIGHT,
  slideVelocity,
  type LadderZone,
} from './player';
import { nextRandom } from './rng';
import { courseLateralAt, predictCourse, rockThreat } from './navigation';
import { seaSurfaceY } from './sea';
import { createShipState, shipToWorld, updateShip } from './ship';
import { applyTuningPatch, cloneTuning, DEFAULT_TUNING, type Tuning, type TuningPatch } from './tuning';
import type {
  BubbleKey,
  GameEvent,
  GameState,
  ObjectKind,
  ObjectState,
  PingKind,
  PlayerState,
  StationKind,
  StationState,
  VoyageState,
} from './state';
import {
  buildCompartmentGeometry,
  createCompartmentState,
  depthBelowSurface,
  hatchGeometry,
  refreshSurface,
  updateWater,
  type CompartmentGeometry,
} from './water';


export interface SimulationOptions {
  seed?: number;
  /** Initial sea state; defaults to tuning.ship.initialSeaState. */
  seaState?: number;
  layout?: ShipLayout;
  /** Overrides on top of DEFAULT_TUNING. */
  tuning?: TuningPatch;
}

/** Physics handles of a player. Everything else about the player lives in PlayerState. */
interface PlayerRuntime {
  body: RigidBody;
  collider: Collider;
  /** Horizontal input direction of the current tick (for animation, not carried across ticks). */
  moveDir: number;
}

interface ObjectRuntime {
  body: RigidBody;
  collider: Collider;
}

export interface AddPlayerOptions {
  name?: string;
  /** Preferred colour slot 0..3 (the next free one is used if it is taken). */
  color?: number;
}

/** Number of distinct coat colours / spawn points. */
export const PLAYER_COLORS = 4;

const STATION_KINDS: Partial<Record<MarkerDef['type'], StationKind>> = {
  wheel: 'wheel',
  pump: 'pump',
  searchlight: 'searchlight',
  cannon: 'cannon',
  workshop: 'workshop',
};

/** Stations a player can enter (workshop is used by pressing E/F next to it instead). */
const OPERABLE: ReadonlySet<StationKind> = new Set(['wheel', 'pump', 'searchlight', 'cannon']);

/** Language independent icon for an interaction (touch context buttons). */
export type HintIcon = 'wheel' | 'pump' | 'searchlight' | 'cannon' | 'workshop' | 'plank' | 'hatch' | 'repair' | 'exit' | 'grab' | 'drop' | 'fire';

/** Rocks closer than this (m ahead of the ship pivot) are created; the sea chart looks this far. */
export const ROCK_LOOKAHEAD = 160;
/** World x offset of the bow tip from the ship pivot (m). */
export const BOW_OFFSET = 15.6;
/** Seconds the ship needs to stop after arriving. */
const ARRIVE_STOP_TIME = 4;
/** The lighthouse island stands this far past the end of the voyage (m, world x). */
export const LIGHTHOUSE_ISLAND = 26;
/** Where the kraken grabs the bow (m ahead of the pivot). */
export const MONSTER_ATTACK_OFFSET = 19;
/** Ship-local position of the searchlight lens pivot and the cannon barrel pivot relative to their station (m). */
export const SEARCHLIGHT_PIVOT = { x: -5 / 16, y: -12 / 16 } as const;
export const CANNON_PIVOT = { x: 6 / 16, y: -6 / 16 } as const;
const CANNON_LENGTH = 14 / 16;

/** World position of the kraken's head. */
export function monsterHead(state: Pick<GameState, 'ship' | 'time' | 'monster'>): Vec2 | null {
  const m = state.monster;
  if (!m) return null;
  const x = state.ship.x + m.offset;
  return { x, y: seaSurfaceY(x, state.time, state.ship.seaState) - 1.3 + m.depth * 4 };
}

export interface Hint {
  label: string;
  icon: HintIcon;
}

let defaultLayout: ShipLayout | null = null;
export function getShipLayout(): ShipLayout {
  defaultLayout ??= parseLayout(SHIP_MAP, { origin: SHIP_ORIGIN, compartmentNames: COMPARTMENT_NAMES });
  return defaultLayout;
}

/**
 * The authoritative game simulation. Runs identically in the browser (local play)
 * and, from phase 3 on, on the Colyseus server. It never touches the DOM or any
 * renderer: input goes in as data, `state` comes out as data.
 */
export class Simulation {
  readonly layout: ShipLayout;
  readonly waterGeometry: CompartmentGeometry[];
  readonly ladders: LadderZone[];
  /** This simulation's gameplay numbers (change them with a `tune` command). */
  readonly tuning: Tuning;
  state!: GameState;

  private world!: World;
  private hatchColliders: Collider[] = [];
  private readonly players = new Map<string, PlayerRuntime>();
  private readonly objects = new Map<number, ObjectRuntime>();
  private readonly seed: number;
  private readonly initialSeaState: number;

  /** Initialises Rapier (once) and creates a simulation. */
  static async create(options: SimulationOptions = {}): Promise<Simulation> {
    await initPhysics();
    return new Simulation(options);
  }

  private constructor(options: SimulationOptions) {
    this.layout = options.layout ?? getShipLayout();
    this.waterGeometry = this.layout.compartments.map((c) => buildCompartmentGeometry(this.layout, c));
    this.ladders = this.layout.ladders.map((l) => ladderZone(this.layout, l));
    this.tuning = cloneTuning(DEFAULT_TUNING);
    applyTuningPatch(this.tuning, options.tuning);
    this.seed = options.seed ?? 1337;
    this.initialSeaState = options.seaState ?? this.tuning.ship.initialSeaState;
    this.reset();
  }

  // ---------------------------------------------------------------- setup

  /** Rebuilds the physics world and resets the game state. Players are kept. */
  reset(): void {
    const keep = this.state ? this.state.players.map((p) => ({ id: p.id, name: p.name, color: p.color, away: p.away })) : [];
    const forcedRoll = this.state?.forcedRoll ?? null;
    if (this.world) this.world.free();
    this.players.clear();
    this.objects.clear();

    this.world = new RAPIER.World({ x: 0, y: 0 });
    this.world.timestep = SIM_DT;
    const statics = buildStaticColliders(this.world, this.layout);
    this.hatchColliders = statics.hatchColliders;

    const seaState = this.state?.voyage.seaBase ?? this.initialSeaState;
    this.state = {
      tick: 0,
      time: 0,
      rng: this.seed >>> 0,
      status: 'sailing',
      statusTimer: 0,
      ship: createShipState(this.tuning.ship, this.tuning.gameplay.gravity, seaState),
      players: [],
      objects: [],
      hatches: this.layout.hatches.map((h) => ({ id: h.id, open: true })),
      compartments: this.waterGeometry.map((g) => createCompartmentState(g)),
      leaks: [],
      stations: this.createStations(),
      events: [{ type: 'reset' }],
      nextObjectId: 1,
      forcedRoll,
      leakCursor: 0,
      voyage: this.createVoyage(seaState),
      rocks: [],
      monster: null,
      balls: [],
      pings: [],
      shouts: { wheel: 6, water: 0, rock: 0 },
      nextId: 1,
    };
    this.layout.hatches.forEach((h) => applyHatchState(this.hatchColliders[h.id]!, h, true));

    for (const m of this.layout.markers) {
      if (m.type === 'crate' || m.type === 'barrel' || m.type === 'plank') {
        const spec = OBJECT_SPECS[m.type];
        const p = tileToLocal(this.layout, m.tx + 0.5, m.ty + 1);
        this.spawnObject(m.type, p.x, p.y - spec.hy - 0.01, true);
      }
    }
    for (const k of keep) this.addPlayer(k.id, k).away = k.away;
  }

  private createVoyage(seaBase: number): VoyageState {
    const G = this.tuning.gameplay;
    return {
      length: G.voyageLength,
      seaBase,
      nextRockX: 70,
      nextMonsterX: G.voyageLength * G.monsterFirstAt,
      rocksHit: 0,
      rocksPassed: 0,
      rocksDestroyed: 0,
      monstersRepelled: 0,
      leaksRepaired: 0,
      landSighted: false,
    };
  }

  private createStations(): StationState[] {
    const stations: StationState[] = [];
    for (const m of this.layout.markers) {
      const kind = STATION_KINDS[m.type];
      if (!kind) continue;
      const p = tileToLocal(this.layout, m.tx + 0.5, m.ty + 1);
      const value = kind === 'searchlight' ? 0.25 : kind === 'cannon' ? -0.2 : 0;
      stations.push({ id: stations.length, kind, x: p.x, y: p.y, occupant: null, value, aux: kind === 'searchlight' ? 1 : 0 });
    }
    return stations;
  }

  private spawnPoint(index: number): Vec2 {
    const spawns = this.layout.markers.filter((m) => m.type === 'spawn');
    const m = spawns[index % Math.max(spawns.length, 1)];
    if (!m) return { x: 0, y: -2 };
    const p = tileToLocal(this.layout, m.tx + 0.5, m.ty + 1);
    return { x: p.x, y: p.y - PLAYER_HALF_HEIGHT - 0.02 };
  }

  addPlayer(id: string, options: AddPlayerOptions = {}): PlayerState {
    const existing = this.state.players.find((p) => p.id === id);
    if (existing) return existing;
    const used = new Set(this.state.players.map((p) => p.color));
    const wanted = options.color !== undefined && Number.isInteger(options.color) ? ((options.color % PLAYER_COLORS) + PLAYER_COLORS) % PLAYER_COLORS : 0;
    let color = wanted;
    for (let i = 0; i < PLAYER_COLORS && used.has(color); i++) color = (wanted + i + 1) % PLAYER_COLORS;
    if (used.has(color)) {
      color = 0;
      while (used.has(color)) color++;
    }
    const spawn = this.spawnPoint(color);
    this.players.set(id, this.createPlayerBody(spawn.x, spawn.y));
    const p: PlayerState = {
      id,
      name: options.name ?? '',
      color,
      away: false,
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      facing: 1,
      grounded: false,
      inWater: 0,
      climbing: null,
      station: null,
      carrying: null,
      action: null,
      anim: 'idle',
      animTime: 0,
      prevInput: { ...EMPTY_INPUT },
      overboard: 0,
      bubble: null,
      airTime: 0,
      jumpBuffer: 0,
      fallSpeed: 0,
      solidPlatforms: true,
    };
    this.state.players.push(p);
    return p;
  }

  private createPlayerBody(x: number, y: number): PlayerRuntime {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).lockRotations().setGravityScale(0).setCcdEnabled(true),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER_SHAPE.halfHeight, PLAYER_SHAPE.radius)
        .setMass(PLAYER_SHAPE.mass)
        .setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0)
        .setCollisionGroups(groups(GROUP.PLAYER, PLAYER_FILTER_BASE | GROUP.PLATFORM)),
      body,
    );
    return { body, collider, moveDir: 0 };
  }

  /**
   * Replaces the whole game state, e.g. with an authoritative snapshot from the
   * server. Physics bodies are created / removed / moved to match. The state
   * object is taken over (not copied) - pass a fresh object.
   */
  loadState(src: GameState): void {
    for (const [id, rt] of this.players) {
      if (src.players.some((p) => p.id === id)) continue;
      this.world.removeRigidBody(rt.body);
      this.players.delete(id);
    }
    for (const p of src.players) {
      let rt = this.players.get(p.id);
      if (!rt) {
        rt = this.createPlayerBody(p.x, p.y);
        this.players.set(p.id, rt);
      }
      rt.body.setEnabled(p.overboard <= 0);
      rt.body.setTranslation({ x: p.x, y: p.y }, false);
      rt.body.setLinvel({ x: p.vx, y: p.vy }, true);
      rt.collider.setCollisionGroups(groups(GROUP.PLAYER, PLAYER_FILTER_BASE | (p.solidPlatforms ? GROUP.PLATFORM : 0)));
    }
    for (const [id, rt] of this.objects) {
      if (src.objects.some((o) => o.id === id)) continue;
      this.world.removeRigidBody(rt.body);
      this.objects.delete(id);
    }
    for (const o of src.objects) {
      let rt = this.objects.get(o.id);
      if (!rt) {
        rt = createObjectBody(this.world, o.kind, o.x, o.y);
        this.objects.set(o.id, rt);
      }
      rt.body.setEnabled(o.carriedBy === null);
      rt.body.setTranslation({ x: o.x, y: o.y }, false);
      rt.body.setRotation(o.angle, false);
      rt.body.setLinvel({ x: o.vx, y: o.vy }, false);
      rt.body.setAngvel(o.av, true);
    }
    src.hatches.forEach((h) => {
      const def = this.layout.hatches[h.id];
      const collider = this.hatchColliders[h.id];
      if (def && collider) applyHatchState(collider, def, h.open);
    });
    this.world.gravity = { x: src.ship.gravity.x, y: src.ship.gravity.y };
    this.world.propagateModifiedBodyPositionsToColliders();
    this.state = src;
  }

  /** Moves a player (ship-local meters, body centre). Used by tests and debug tools. */
  teleportPlayer(id: string, x: number, y: number): void {
    const rt = this.players.get(id);
    const p = this.state.players.find((pp) => pp.id === id);
    if (!rt || !p) return;
    rt.body.setTranslation({ x, y }, true);
    rt.body.setLinvel({ x: 0, y: 0 }, true);
    this.world.propagateModifiedBodyPositionsToColliders();
    p.x = x;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.climbing = null;
  }

  removePlayer(id: string): void {
    const p = this.state.players.find((pp) => pp.id === id);
    const rt = this.players.get(id);
    if (!p || !rt) return;
    if (p.carrying !== null) this.dropObject(p, rt, true);
    this.leaveStation(p);
    this.world.removeRigidBody(rt.body);
    this.players.delete(id);
    this.state.players = this.state.players.filter((pp) => pp.id !== id);
  }

  private spawnObject(kind: ObjectKind, x: number, y: number, rememberSpawn: boolean): ObjectState {
    const id = this.state.nextObjectId++;
    this.objects.set(id, createObjectBody(this.world, kind, x, y));
    const o: ObjectState = { id, kind, x, y, angle: 0, vx: 0, vy: 0, av: 0, carriedBy: null, spawn: rememberSpawn ? { x, y } : null };
    this.state.objects.push(o);
    return o;
  }

  private removeObject(id: number): void {
    const rt = this.objects.get(id);
    if (rt) this.world.removeRigidBody(rt.body);
    this.objects.delete(id);
    this.state.objects = this.state.objects.filter((o) => o.id !== id);
  }

  dispose(): void {
    this.world.free();
  }

  // ---------------------------------------------------------------- step

  /**
   * Advances the simulation by one fixed step. `inputs` maps player id -> input
   * for this tick; missing players get an empty input.
   */
  step(inputs: InputMap, dt: number = SIM_DT, commands: readonly SimCommand[] = []): void {
    this.state.events = [];
    for (const c of commands) this.applyCommand(c);
    // a 'reset' command replaces the state object, so read it only after the commands
    const s = this.state;
    s.tick++;
    s.time += dt;
    this.world.timestep = dt;

    if (s.status === 'sunk' || s.status === 'arrived') {
      s.statusTimer -= dt;
      if (s.statusTimer <= 0) {
        this.reset();
        return;
      }
    }

    // the storm grows on the way to the lighthouse
    const progress = clamp(s.ship.x / Math.max(1, s.voyage.length), 0, 1);
    s.ship.seaState = clamp(s.voyage.seaBase + this.tuning.gameplay.stormGrowth * Math.pow(progress, 1.2), 0, 1.6);

    // ship motion (uses the water distribution from the previous step)
    let volume = 0;
    let moment = 0;
    for (const c of s.compartments) {
      volume += c.volume;
      moment += c.volume * c.centroidX;
    }
    // arrived: the ship slows down and stops in front of the lighthouse island
    const G = this.tuning.gameplay;
    const throttle = s.status === 'arrived' ? clamp((s.statusTimer - (G.arrivedResetTime - ARRIVE_STOP_TIME)) / ARRIVE_STOP_TIME, 0, 1) : 1;
    updateShip(s.ship, s.time, dt, { volume, moment }, this.tuning.ship, G.gravity, throttle);
    if (s.forcedRoll !== null) {
      s.ship.roll = s.forcedRoll;
      s.ship.rollVel = 0;
      s.ship.ay = 0;
      s.ship.gravity.x = Math.sin(s.forcedRoll) * this.tuning.gameplay.gravity;
      s.ship.gravity.y = Math.cos(s.forcedRoll) * this.tuning.gameplay.gravity;
    }
    this.world.gravity = { x: s.ship.gravity.x, y: s.ship.gravity.y };

    for (const p of s.players) {
      const input = s.status === 'sunk' ? EMPTY_INPUT : (inputs[p.id] ?? EMPTY_INPUT);
      this.updatePlayer(p, input, dt);
    }
    this.updateObjectForces(dt);

    this.world.step();

    this.syncBodies(dt);
    this.updateLeaks(dt);
    updateWater(this.layout, this.waterGeometry, s.compartments, (id) => s.hatches[id]!.open, s.ship.gravity, dt);
    this.updateVoyage(dt);
    this.checkSinking();

    for (const p of s.players) {
      copyInput(s.status === 'sunk' ? EMPTY_INPUT : (inputs[p.id] ?? EMPTY_INPUT), p.prevInput);
      if (p.bubble) {
        p.bubble.time -= dt;
        if (p.bubble.time <= 0) p.bubble = null;
      }
    }
  }

  private applyCommand(c: SimCommand): void {
    switch (c.type) {
      case 'debugLeak':
        this.createLeak(c.point);
        break;
      case 'debugWater': {
        const comp = this.state.compartments[c.compartment];
        const geom = this.waterGeometry[c.compartment];
        if (comp && geom) {
          comp.volume = clamp(comp.volume + c.volume, 0, geom.capacity);
          refreshSurface(geom, comp);
        }
        break;
      }
      case 'seaState':
        this.state.voyage.seaBase = clamp(c.value, 0, 1.5);
        break;
      case 'ping':
        this.addPing(c.player, c.x, c.y);
        break;
      case 'debugHazard': {
        const s = this.state;
        if (c.what === 'monster') s.voyage.nextMonsterX = Math.min(s.voyage.nextMonsterX, s.ship.x);
        else s.rocks.push({ id: this.nextId(), x: s.ship.x + 55, lateral: s.ship.lateral, radius: 2.6, spotted: false, hit: false });
        break;
      }
      case 'debugAdvance': {
        const s = this.state;
        s.ship.x += c.meters;
        s.rocks = [];
        s.voyage.nextRockX = Math.max(s.voyage.nextRockX, s.ship.x + 60);
        break;
      }
      case 'debugRoll':
        this.state.forcedRoll = c.value;
        break;
      case 'tune':
        applyTuningPatch(this.tuning, c.patch);
        break;
      case 'reset':
        this.reset();
        break;
    }
  }

  // ---------------------------------------------------------------- players

  private emit(e: GameEvent): void {
    this.state.events.push(e);
  }

  private say(p: PlayerState, key: BubbleKey): void {
    p.bubble = { key, time: this.tuning.gameplay.bubbleTime };
    this.emit({ type: 'shout', player: p.id, key });
  }

  /** The player closest to a ship-local point who is on board and free (null if nobody). */
  private closestPlayer(x: number, y: number, free = false): PlayerState | null {
    let best: PlayerState | null = null;
    let bd = Infinity;
    for (const p of this.state.players) {
      if (p.overboard > 0 || p.away || (free && p.station !== null)) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  private updatePlayer(p: PlayerState, input: Readonly<PlayerInput>, dt: number): void {
    const rt = this.players.get(p.id)!;
    const prev = p.prevInput;
    rt.moveDir = 0;
    const pressed = (k: keyof PlayerInput) => input[k] && !prev[k];

    if (p.overboard > 0) {
      p.overboard -= dt;
      if (p.overboard <= 0) this.respawnPlayer(p, rt);
      return;
    }

    const g = this.state.ship.gravity;
    const feetY = p.y + PLAYER_HALF_HEIGHT;
    const carrying = p.carrying !== null;
    const grounded = this.probeGround(p, rt);
    p.grounded = grounded;
    p.airTime = grounded ? 0 : p.airTime + dt;
    p.jumpBuffer = pressed('jump') ? this.tuning.player.jumpBuffer : Math.max(0, p.jumpBuffer - dt);

    // an E/jump press that leaves a station or cancels an action is consumed
    let consumed = false;

    // ---- station mode: the player is parked at the station, inputs drive it
    if (p.station !== null) {
      const st = this.state.stations[p.station]!;
      if (pressed('interact') || pressed('jump')) {
        this.leaveStation(p);
        consumed = true;
        p.jumpBuffer = 0;
      } else {
        this.operateStation(st, input, dt, !!pressed('pick'));
        rt.body.setTranslation({ x: st.x, y: st.y - PLAYER_HALF_HEIGHT - 0.01 }, true);
        rt.body.setLinvel({ x: 0, y: 0 }, true);
        this.setPlatformFilter(p, rt, true);
        return;
      }
    }

    // ---- timed action (repairing a leak)
    if (p.action) {
      if (pressed('interact') || pressed('jump')) {
        p.action = null;
        consumed = true;
        p.jumpBuffer = 0;
      } else {
        p.action.progress += dt;
        const v = rt.body.linvel();
        rt.body.setLinvel({ x: approach(v.x, 0, this.tuning.player.groundAccel * dt), y: clampFall(this.tuning.player, v.y + g.y * dt) }, true);
        if (p.action.progress >= this.tuning.player.repairTime) this.finishRepair(p);
        return;
      }
    }

    // ---- interactions
    if (pressed('interact') && !consumed) this.interact(p, rt);
    if (pressed('pick')) this.pickOrDrop(p, rt);
    if (p.station !== null || p.action) return;

    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    rt.moveDir = dir;
    if (dir !== 0) p.facing = dir > 0 ? 1 : -1;
    const speed = moveSpeed(this.tuning.player, carrying, p.inWater);
    const v = rt.body.linvel();
    let vx = v.x;
    let vy = v.y;

    // ---- ladders
    if (p.climbing === null && (input.up || input.down) && !(input.up && input.down)) {
      const z = findGrabbableLadder(this.ladders, p.x, feetY, input.up, input.down);
      const closedBelow =
        z !== null && z.hatchId !== null && !this.state.hatches[z.hatchId]!.open && input.down && feetY <= z.top + 0.15;
      if (z && !closedBelow) {
        p.climbing = z.id;
        p.jumpBuffer = 0;
      }
    }
    if (p.climbing !== null) {
      const z = this.ladders[p.climbing]!;
      const climb = this.tuning.player.climbSpeed * (carrying ? this.tuning.player.carryClimbFactor : 1);
      const vDir = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      vx = (z.x - p.x) * 12;
      vy = vDir * climb;
      let leave = false;
      if (Math.abs(p.x - z.x) > 0.6 || feetY < z.top - 0.3 || feetY - PLAYER_HEIGHT > z.bottom) leave = true;
      if (vDir < 0 && feetY <= z.top + 0.02) {
        // reached the top: step onto the hatch / floor
        leave = true;
        vy = 0;
        rt.body.setTranslation({ x: z.x, y: z.top - PLAYER_HALF_HEIGHT - 0.02 }, true);
      }
      if (vDir > 0 && grounded && feetY >= z.bottom - 0.05) leave = true;
      if (dir !== 0 && grounded && vDir === 0) leave = true;
      if (p.jumpBuffer > 0) {
        leave = true;
        p.jumpBuffer = 0;
        vy = -this.tuning.player.jumpSpeed * 0.55;
        vx = dir * speed;
        this.emit({ type: 'jump', player: p.id });
      }
      if (leave) p.climbing = null;
      this.setPlatformFilter(p, rt, p.climbing === null);
      rt.body.setLinvel({ x: vx, y: vy }, true);
      return;
    }

    // ---- walking / sliding / jumping
    const swimming = p.inWater > 0.55;
    if (grounded) {
      const target = dir * speed + (swimming ? 0 : slideVelocity(this.tuning.player, g.x));
      vx = approach(vx, target, this.tuning.player.groundAccel * dt);
      vy += g.y * dt;
    } else {
      if (dir !== 0) vx = approach(vx, dir * speed, this.tuning.player.airAccel * dt);
      vx += g.x * dt * (swimming ? 0.3 : 1);
      vy += g.y * dt * (swimming ? 0.3 : 1);
    }
    if (swimming) {
      vx *= 1 - 2 * dt;
      vy *= 1 - 2.5 * dt;
    }
    const canJump = grounded || p.airTime < this.tuning.player.coyoteTime || swimming;
    if (p.jumpBuffer > 0 && canJump) {
      vy = -this.tuning.player.jumpSpeed * (carrying ? this.tuning.player.carryJumpFactor : 1) * (swimming ? 0.7 : 1);
      p.jumpBuffer = 0;
      p.airTime = this.tuning.player.coyoteTime;
      this.emit({ type: 'jump', player: p.id });
    }
    vy = clampFall(this.tuning.player, vy);
    rt.body.setLinvel({ x: vx, y: vy }, true);
    this.setPlatformFilter(p, rt, true);
  }

  /** Ray casts below the feet. Uses the player's current collision filter so non-solid platforms are ignored. */
  private probeGround(p: PlayerState, rt: PlayerRuntime): boolean {
    const t = rt.body.translation();
    const feet = t.y + PLAYER_HALF_HEIGHT;
    const flags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    const grp = groups(GROUP.PLAYER, PLAYER_FILTER_BASE | (p.solidPlatforms ? GROUP.PLATFORM : 0));
    for (const dx of [-0.16, 0, 0.16]) {
      const ray = new RAPIER.Ray({ x: t.x + dx, y: feet - 0.1 }, { x: 0, y: 1 });
      const hit = this.world.castRay(ray, 0.16, true, flags, grp, rt.collider);
      if (hit) return true;
    }
    return false;
  }

  /**
   * One-way platforms (open ladder hatches) are solid for a player unless the
   * player is climbing or currently overlapping one of them.
   */
  private setPlatformFilter(p: PlayerState, rt: PlayerRuntime, allowSolid: boolean): void {
    let solid = allowSolid && p.climbing === null;
    if (solid) {
      const t = rt.body.translation();
      const feet = t.y + PLAYER_HALF_HEIGHT;
      const head = t.y - PLAYER_HALF_HEIGHT;
      for (const h of this.layout.hatches) {
        if (!h.hasLadder || !this.state.hatches[h.id]!.open) continue;
        const g = hatchGeometry(this.layout, h);
        if (Math.abs(t.x - g.x) > g.width / 2 + PLAYER_SHAPE.radius) continue;
        if (feet > g.top + 0.1 && head < g.bottom) {
          solid = false;
          break;
        }
      }
    }
    if (solid !== p.solidPlatforms) {
      p.solidPlatforms = solid;
      rt.collider.setCollisionGroups(groups(GROUP.PLAYER, PLAYER_FILTER_BASE | (solid ? GROUP.PLATFORM : 0)));
    }
  }

  private respawnPlayer(p: PlayerState, rt: PlayerRuntime): void {
    const s = this.spawnPoint(p.color);
    rt.body.setEnabled(true);
    rt.body.setTranslation(s, true);
    rt.body.setLinvel({ x: 0, y: 0 }, true);
    p.overboard = 0;
    p.x = s.x;
    p.y = s.y;
  }

  // ---------------------------------------------------------------- interactions

  /** All interactions (E) available to a player, nearest first. Pure query - nothing happens until `run`. */
  private interactionCandidates(p: PlayerState, rt: PlayerRuntime): { d: number; label: string; icon: HintIcon; run: () => void }[] {
    const feetY = p.y + PLAYER_HALF_HEIGHT;
    const candidates: { d: number; label: string; icon: HintIcon; run: () => void }[] = [];
    const STATION_LABEL: Record<StationKind, string> = {
      wheel: 'Steuerrad',
      pump: 'Pumpe',
      searchlight: 'Scheinwerfer',
      cannon: 'Kanone',
      workshop: 'Planke holen',
    };

    for (const st of this.state.stations) {
      const dx = Math.abs(st.x - p.x);
      const dy = Math.abs(st.y - feetY);
      if (dy > 0.6) continue;
      if (st.kind === 'workshop') {
        if (dx < 1.0 && p.carrying === null) candidates.push({ d: dx, label: STATION_LABEL.workshop, icon: 'plank', run: () => this.takePlank(p) });
      } else if (OPERABLE.has(st.kind) && st.occupant === null && dx < this.tuning.player.stationRange) {
        candidates.push({ d: dx, label: STATION_LABEL[st.kind], icon: st.kind, run: () => this.enterStation(p, rt, st) });
      }
    }
    for (const h of this.layout.hatches) {
      const g = hatchGeometry(this.layout, h);
      const dx = Math.abs(g.x - p.x);
      if (dx > g.width / 2 + this.tuning.player.hatchRange) continue;
      const headY = p.y - PLAYER_HALF_HEIGHT;
      const fromAbove = Math.abs(feetY - g.top) < 0.4;
      const fromBelow = headY > g.bottom - 0.1 && headY - g.bottom < 1.4;
      const open = this.state.hatches[h.id]!.open;
      if (fromAbove || fromBelow) {
        candidates.push({ d: dx + 0.25, label: open ? 'Luke schließen' : 'Luke öffnen', icon: 'hatch', run: () => this.toggleHatch(h.id, p.id) });
      }
    }
    for (const leak of this.state.leaks) {
      if (!leak.active) continue;
      const lp = this.leakInteriorPoint(leak.point);
      const d = Math.hypot(lp.x - p.x, lp.y - p.y);
      if (d < this.tuning.player.leakRange) {
        const obj = p.carrying !== null ? this.state.objects.find((o) => o.id === p.carrying) : undefined;
        const hasPlank = obj?.kind === 'plank';
        candidates.push({
          d: d - 0.5,
          label: hasPlank ? 'Leck reparieren' : 'Planke nötig!',
          icon: hasPlank ? 'repair' : 'plank',
          run: () => {
            if (hasPlank) p.action = { kind: 'repair', target: leak.id, progress: 0 };
            else this.say(p, 'plank');
          },
        });
      }
    }
    return candidates.sort((a, b) => a.d - b.d);
  }

  private interact(p: PlayerState, rt: PlayerRuntime): void {
    this.interactionCandidates(p, rt)[0]?.run();
  }

  /** What E and F would do right now for this player (for UI prompts and context buttons). */
  interactionHints(id: string): { interact: Hint | null; pick: Hint | null } {
    const p = this.state.players.find((pp) => pp.id === id);
    const rt = this.players.get(id);
    if (!p || !rt || p.overboard > 0) return { interact: null, pick: null };
    if (p.station !== null) {
      const st = this.state.stations[p.station];
      const pick: Hint | null = st?.kind === 'cannon' ? { label: st.aux > 0 ? 'Lädt ...' : 'Feuer!', icon: 'fire' } : null;
      return { interact: { label: 'Verlassen', icon: 'exit' }, pick };
    }
    if (p.action) return { interact: { label: 'Abbrechen', icon: 'exit' }, pick: null };
    const c = this.interactionCandidates(p, rt)[0];
    const interact: Hint | null = c ? { label: c.label, icon: c.icon } : null;
    let pick: Hint | null = null;
    if (p.carrying !== null) pick = { label: 'Ablegen', icon: 'drop' };
    else {
      const near = this.state.objects.find((o) => !o.carriedBy && Math.hypot(o.x - p.x, (o.y - p.y) * 0.8) < this.tuning.player.pickRange);
      if (near) pick = { label: near.kind === 'crate' ? 'Kiste nehmen' : near.kind === 'barrel' ? 'Fass nehmen' : 'Planke nehmen', icon: 'grab' };
      else {
        const ws = this.state.stations.find((st) => st.kind === 'workshop');
        if (ws && Math.abs(ws.x - p.x) < 1.0 && Math.abs(ws.y - (p.y + PLAYER_HALF_HEIGHT)) < 0.6) pick = { label: 'Planke holen', icon: 'plank' };
      }
    }
    return { interact, pick };
  }

  private enterStation(p: PlayerState, rt: PlayerRuntime, st: StationState): void {
    if (p.carrying !== null) this.dropObject(p, rt, false);
    st.occupant = p.id;
    p.station = st.id;
    p.climbing = null;
    p.facing = st.kind === 'wheel' ? 1 : p.facing;
    this.emit({ type: 'station', player: p.id, station: st.id, enter: true });
  }

  private leaveStation(p: PlayerState): void {
    if (p.station === null) return;
    const st = this.state.stations[p.station]!;
    if (st.occupant === p.id) st.occupant = null;
    this.emit({ type: 'station', player: p.id, station: st.id, enter: false });
    p.station = null;
  }

  /**
   * Station controls. Digital input (left/right) moves the station at a fixed
   * rate; an analog `target` (dragging the wheel / lever / dial in the UI) moves
   * it towards the target, at most a bit faster than the keys - so touch and
   * keyboard players are equally strong.
   */
  private operateStation(st: StationState, input: Readonly<PlayerInput>, dt: number, fire = false): void {
    const G = this.tuning.gameplay;
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const target = input.target;
    const hasTarget = typeof target === 'number' && Number.isFinite(target);
    switch (st.kind) {
      case 'wheel': {
        st.value = hasTarget
          ? approach(st.value, clamp(target, -1, 1), G.wheelSpeed * 2.5 * dt)
          : clamp(st.value + dir * G.wheelSpeed * dt, -1, 1);
        this.state.ship.rudder = st.value;
        break;
      }
      case 'pump': {
        // swing the handle from end to end; each full swing pumps water
        const before = st.value;
        if (hasTarget) {
          st.value = approach(st.value, clamp(target, -1, 1), G.pumpHandleSpeed * dt);
        } else {
          const pdir = dir !== 0 ? dir : (input.down ? 1 : 0) - (input.up ? 1 : 0);
          if (pdir === 0) break;
          st.value = clamp(st.value + pdir * G.pumpHandleSpeed * dt, -1, 1);
        }
        const reachedEnd = (before < 1 && st.value >= 1) || (before > -1 && st.value <= -1);
        if (reachedEnd) {
          const comp = this.pumpCompartment(st);
          if (comp >= 0) {
            const c = this.state.compartments[comp]!;
            const removed = Math.min(c.volume, G.pumpStroke);
            c.volume -= removed;
            refreshSurface(this.waterGeometry[comp]!, c);
            st.aux += 1;
            this.emit({ type: 'pumpStroke', player: st.occupant, station: st.id, volume: removed });
          }
        }
        break;
      }
      case 'searchlight':
        if (hasTarget) {
          const step = G.searchlightSpeed * 1.6 * dt;
          st.value = wrapAngle(st.value + clamp(wrapAngle(target - st.value), -step, step));
        } else {
          st.value = wrapAngle(st.value + dir * G.searchlightSpeed * dt);
        }
        break;
      case 'cannon':
        st.value = hasTarget
          ? approach(st.value, clamp(target, -1.3, 0.35), G.cannonSpeed * 1.6 * dt)
          : clamp(st.value + dir * G.cannonSpeed * dt, -1.3, 0.35);
        if (fire && st.aux <= 0) this.fireCannon(st);
        break;
      case 'workshop':
        break;
    }
  }

  private pumpCompartment(st: StationState): number {
    return compartmentAtLocal(this.layout, st.x, st.y - 0.25);
  }

  private toggleHatch(id: number, player: string | null): void {
    const hs = this.state.hatches[id]!;
    const def = this.layout.hatches[id]!;
    if (hs.open && this.hatchBlocked(id)) return;
    hs.open = !hs.open;
    applyHatchState(this.hatchColliders[id]!, def, hs.open);
    this.emit({ type: 'hatch', player, hatch: id, open: hs.open });
  }

  /** A hatch cannot be closed while something sits inside the opening. */
  private hatchBlocked(id: number): boolean {
    const g = hatchGeometry(this.layout, this.layout.hatches[id]!);
    const inside = (x: number, y: number, hx: number, hy: number) =>
      Math.abs(x - g.x) < g.width / 2 + hx - 0.02 && y + hy > g.top + 0.02 && y - hy < g.bottom - 0.02;
    for (const p of this.state.players) if (inside(p.x, p.y, PLAYER_SHAPE.radius, PLAYER_HALF_HEIGHT)) return true;
    for (const o of this.state.objects) {
      if (o.carriedBy) continue;
      const s = OBJECT_SPECS[o.kind];
      if (inside(o.x, o.y, s.hx, s.hy)) return true;
    }
    return false;
  }

  private pickOrDrop(p: PlayerState, rt: PlayerRuntime): void {
    if (p.carrying !== null) {
      this.dropObject(p, rt, false);
      return;
    }
    let best: ObjectState | null = null;
    let bestD: number = this.tuning.player.pickRange;
    for (const o of this.state.objects) {
      if (o.carriedBy) continue;
      const d = Math.hypot(o.x - p.x, (o.y - p.y) * 0.8);
      if (d < bestD) {
        best = o;
        bestD = d;
      }
    }
    if (best) {
      const ort = this.objects.get(best.id)!;
      ort.body.setEnabled(false);
      best.carriedBy = p.id;
      p.carrying = best.id;
      this.emit({ type: 'pickup', player: p.id, object: best.id });
      return;
    }
    const workshop = this.state.stations.find((st) => st.kind === 'workshop');
    if (workshop && Math.abs(workshop.x - p.x) < 1.0 && Math.abs(workshop.y - (p.y + PLAYER_HALF_HEIGHT)) < 0.6) {
      this.takePlank(p);
    }
  }

  private takePlank(p: PlayerState): void {
    const ws = this.state.stations.find((st) => st.kind === 'workshop');
    if (!ws || p.carrying !== null || ws.value > 0) return;
    const o = this.spawnObject('plank', p.x, p.y - 1, false);
    const ort = this.objects.get(o.id)!;
    ort.body.setEnabled(false);
    o.carriedBy = p.id;
    p.carrying = o.id;
    ws.value = this.tuning.gameplay.workshopCooldown;
    ws.aux += 1;
    this.emit({ type: 'pickup', player: p.id, object: o.id });
  }

  /** Places the carried object in front of the player (or wherever it fits). */
  private dropObject(p: PlayerState, rt: PlayerRuntime, silent: boolean): void {
    const o = this.state.objects.find((oo) => oo.id === p.carrying);
    p.carrying = null;
    if (!o) return;
    const ort = this.objects.get(o.id)!;
    const s = OBJECT_SPECS[o.kind];
    const t = rt.body.translation();
    const feet = t.y + PLAYER_HALF_HEIGHT;
    const shape = new RAPIER.Cuboid(s.hx, s.hy);
    const grp = groups(GROUP.OBJECT, GROUP.WORLD | GROUP.OBJECT | GROUP.HATCH | GROUP.PLATFORM);
    const candidates: Vec2[] = [
      { x: t.x + p.facing * (PLAYER_SHAPE.radius + s.hx + 0.06), y: feet - s.hy - 0.03 },
      { x: t.x + p.facing * (PLAYER_SHAPE.radius + s.hx + 0.06), y: feet - s.hy - 0.45 },
      { x: t.x, y: t.y - PLAYER_HALF_HEIGHT - s.hy - 0.05 },
      { x: t.x - p.facing * (PLAYER_SHAPE.radius + s.hx + 0.06), y: feet - s.hy - 0.03 },
    ];
    let pos = candidates[candidates.length - 1]!;
    for (const c of candidates) {
      let blocked = false;
      this.world.intersectionsWithShape(c, 0, shape, () => {
        blocked = true;
        return false;
      }, undefined, grp);
      if (!blocked) {
        pos = c;
        break;
      }
    }
    const v = rt.body.linvel();
    ort.body.setEnabled(true);
    ort.body.setTranslation(pos, true);
    ort.body.setRotation(0, true);
    ort.body.setLinvel({ x: v.x + p.facing * 0.6, y: Math.min(v.y, 0) }, true);
    ort.body.setAngvel(0, true);
    o.carriedBy = null;
    o.x = pos.x;
    o.y = pos.y;
    o.angle = 0;
    o.vx = v.x + p.facing * 0.6;
    o.vy = Math.min(v.y, 0);
    o.av = 0;
    if (!silent) this.emit({ type: 'drop', player: p.id, object: o.id });
  }

  // ---------------------------------------------------------------- leaks

  /** Ship-local centre of the interior tile next to a leak point. */
  leakInteriorPoint(point: number): Vec2 {
    const lp = this.layout.leakPoints[point]!;
    return tileToLocal(this.layout, lp.tx + lp.inward.x + 0.5, lp.ty + lp.inward.y + 0.5);
  }

  /** Ship-local centre of the hull tile of a leak point. */
  leakHullPoint(point: number): Vec2 {
    const lp = this.layout.leakPoints[point]!;
    return tileToLocal(this.layout, lp.tx + 0.5, lp.ty + 0.5);
  }

  private createLeak(point?: number): void {
    const n = this.layout.leakPoints.length;
    if (n === 0) return;
    let idx = point;
    if (idx === undefined) {
      for (let i = 0; i < n; i++) {
        const cand = (this.state.leakCursor + i) % n;
        if (!this.state.leaks.some((l) => l.point === cand && l.active)) {
          idx = cand;
          break;
        }
      }
      this.state.leakCursor = ((idx ?? 0) + 1) % n;
    }
    if (idx === undefined || idx < 0 || idx >= n) return;
    if (this.state.leaks.some((l) => l.point === idx && l.active)) return;
    const leak = { id: this.state.leaks.length, point: idx, active: true, inflow: 0 };
    this.state.leaks.push(leak);
    this.emit({ type: 'leak', leak: leak.id });
    // the closest crew member shouts (automatic speech bubble)
    const lp = this.leakInteriorPoint(idx);
    let closest: PlayerState | null = null;
    let cd = Infinity;
    for (const p of this.state.players) {
      const d = Math.hypot(p.x - lp.x, p.y - lp.y) + nextRandom(this.state) * 0.01;
      if (d < cd) {
        cd = d;
        closest = p;
      }
    }
    if (closest) this.say(closest, 'leak');
  }

  private finishRepair(p: PlayerState): void {
    const action = p.action!;
    p.action = null;
    const leak = this.state.leaks[action.target];
    if (!leak || !leak.active) return;
    leak.active = false;
    leak.inflow = 0;
    if (p.carrying !== null) {
      const id = p.carrying;
      p.carrying = null;
      this.removeObject(id);
    }
    this.state.voyage.leaksRepaired++;
    this.emit({ type: 'repaired', leak: leak.id });
  }

  private updateLeaks(dt: number): void {
    const s = this.state;
    for (const leak of s.leaks) {
      if (!leak.active) continue;
      const lp = this.layout.leakPoints[leak.point]!;
      const hull = this.leakHullPoint(leak.point);
      const world = shipToWorld(s.ship, hull);
      const outside = world.y - seaSurfaceY(world.x, s.time, s.ship.seaState);
      const comp = s.compartments[lp.compartment]!;
      const geom = this.waterGeometry[lp.compartment]!;
      const inside = depthBelowSurface(geom, comp, hull.x, hull.y);
      const head = outside - inside;
      leak.inflow = head > 0 ? this.tuning.gameplay.leakRate * Math.sqrt(head) : 0;
      if (leak.inflow > 0) {
        comp.volume = Math.min(geom.capacity, comp.volume + leak.inflow * dt);
        refreshSurface(geom, comp);
      }
    }
  }

  private checkSinking(): void {
    const s = this.state;
    if (s.status !== 'sailing') return;
    let v = 0;
    let cap = 0;
    for (const c of s.compartments) v += c.volume;
    for (const g of this.waterGeometry) cap += g.capacity;
    if (cap > 0 && v / cap >= this.tuning.gameplay.sinkFraction) {
      s.status = 'sunk';
      s.statusTimer = this.tuning.gameplay.sunkResetTime;
      this.emit({ type: 'sunk' });
    }
  }

  /** Total water volume and capacity of the hull. */
  waterTotals(): { volume: number; capacity: number } {
    let volume = 0;
    let capacity = 0;
    for (const c of this.state.compartments) volume += c.volume;
    for (const g of this.waterGeometry) capacity += g.capacity;
    return { volume, capacity };
  }

  // ---------------------------------------------------------------- phase 4: voyage, hazards, pings

  private nextId(): number {
    return this.state.nextId++;
  }

  private rand(min: number, max: number): number {
    return min + (max - min) * nextRandom(this.state);
  }

  private updateVoyage(dt: number): void {
    const s = this.state;
    const v = s.voyage;
    const G = this.tuning.gameplay;
    for (const k of ['wheel', 'water', 'rock'] as const) s.shouts[k] = Math.max(0, s.shouts[k] - dt);
    for (const pg of s.pings) pg.time -= dt;
    if (s.pings.some((pg) => pg.time <= 0)) s.pings = s.pings.filter((pg) => pg.time > 0);
    this.updateBalls(dt);
    if (s.status !== 'sailing') return;

    const progress = s.ship.x / Math.max(1, v.length);
    if (s.ship.x >= v.length) {
      s.status = 'arrived';
      s.statusTimer = G.arrivedResetTime;
      s.rocks = [];
      if (s.monster) s.monster.phase = 'flee';
      this.emit({ type: 'arrived' });
      return;
    }
    if (!v.landSighted && progress > 0.92) {
      v.landSighted = true;
      const p = this.closestPlayer(0, -2);
      if (p) this.say(p, 'land');
    }
    this.updateRocks(progress);
    this.updateMonster(dt);
    this.updateShouts();
  }

  private updateRocks(progress: number): void {
    const s = this.state;
    const v = s.voyage;
    const G = this.tuning.gameplay;
    const ship = s.ship;
    // after a jump (debug, reconnect) never spawn a pile of rocks behind the bow
    if (v.nextRockX < ship.x + 60) v.nextRockX = ship.x + 60;
    // new rocks appear far ahead, denser the closer the lighthouse
    while (v.nextRockX - ship.x < ROCK_LOOKAHEAD && v.nextRockX < v.length - 40) {
      // around where the ship will be when it gets there on its current heading:
      // drifting off course does not dodge rocks, only steering does
      const predicted = courseLateralAt(predictCourse(s, this.tuning, ROCK_LOOKAHEAD), v.nextRockX - ship.x);
      const inLane = nextRandom(s) < 0.45;
      const lateral = predicted + (inLane ? this.rand(-1.5, 1.5) : this.rand(-8, 8));
      s.rocks.push({ id: this.nextId(), x: v.nextRockX, lateral, radius: this.rand(1.6, 3.4), spotted: false, hit: false });
      v.nextRockX += this.rand(G.rockSpacingMin, G.rockSpacingMax) * (1 - 0.35 * progress);
    }
    const light = this.searchlightRay();
    for (const r of s.rocks) {
      const ahead = r.x - ship.x;
      if (!r.spotted) {
        const byLight = light !== null && this.inBeam(light, r.x, seaSurfaceY(r.x, s.time, ship.seaState) - 0.6, r.radius, G.rockSpotRange);
        if (byLight || ahead < G.rockSeeRange) {
          r.spotted = true;
          this.emit({ type: 'rockSpotted', rock: r.id });
          if (byLight && s.shouts.rock <= 0) {
            const st = s.stations.find((x) => x.kind === 'searchlight');
            const op = st?.occupant ? s.players.find((p) => p.id === st.occupant) : null;
            const who = op ?? (st ? this.closestPlayer(st.x, st.y) : null);
            if (who) this.say(who, 'rock');
            s.shouts.rock = 6;
          }
        }
      }
      if (!r.hit && ahead <= BOW_OFFSET) {
        if (Math.abs(r.lateral - ship.lateral) < r.radius + G.shipBeam) this.hitRock(r.id);
        else {
          r.hit = true; // passed (no second check)
          v.rocksPassed++;
        }
      }
    }
    if (s.rocks.some((r) => r.x < ship.x - 30)) s.rocks = s.rocks.filter((r) => r.x >= ship.x - 30);
  }

  private hitRock(id: number): void {
    const s = this.state;
    const r = s.rocks.find((x) => x.id === id);
    if (!r) return;
    r.hit = true;
    s.voyage.rocksHit++;
    s.ship.rollVel += (r.lateral > s.ship.lateral ? -1 : 1) * this.tuning.gameplay.rockShake;
    this.emit({ type: 'rockHit', rock: r.id, x: r.x });
    this.emit({ type: 'splash', x: BOW_OFFSET - 1, y: 0.5, strength: 1.4 });
    this.leakAt('bow');
    if (r.radius > 2.8) this.leakAt('bottom');
  }

  /** Opens a new leak in a part of the hull (bow / bottom), if one is still intact there. Returns false if none is left. */
  private leakAt(where: 'bow' | 'bottom' | 'any'): boolean {
    const L = this.layout;
    const midX = L.width / 2;
    const candidates = L.leakPoints.filter((lp) => {
      if (this.state.leaks.some((l) => l.point === lp.id && l.active)) return false;
      if (where === 'bow') return lp.tx > midX + 8 && lp.inward.y === 0;
      if (where === 'bottom') return lp.inward.y !== 0 || lp.tx > midX + 8;
      return true;
    });
    if (candidates.length === 0) return false;
    const pick = candidates[Math.floor(nextRandom(this.state) * candidates.length) % candidates.length]!;
    this.createLeak(pick.id);
    return true;
  }

  /** World-space ray of the searchlight (origin, angle), or null. */
  private searchlightRay(): { x: number; y: number; angle: number } | null {
    const st = this.state.stations.find((x) => x.kind === 'searchlight');
    if (!st || st.aux <= 0) return null;
    const ship = this.state.ship;
    const o = shipToWorld(ship, { x: st.x + SEARCHLIGHT_PIVOT.x, y: st.y + SEARCHLIGHT_PIVOT.y });
    return { x: o.x, y: o.y, angle: st.value + ship.roll };
  }

  private inBeam(ray: { x: number; y: number; angle: number }, x: number, y: number, size: number, range: number): boolean {
    const d = Math.hypot(x - ray.x, y - ray.y);
    if (d > range || d < 0.5) return false;
    const a = Math.atan2(y - ray.y, x - ray.x);
    return Math.abs(wrapAngle(a - ray.angle)) < 0.1 + Math.atan(size / d);
  }

  private updateMonster(dt: number): void {
    const s = this.state;
    const G = this.tuning.gameplay;
    const v = s.voyage;
    if (!s.monster && s.ship.x >= v.nextMonsterX) {
      v.nextMonsterX += G.monsterEvery;
      s.monster = { offset: 55, depth: 1, hp: G.monsterHp, phase: 'approach', timer: 0, attackIn: 2, spotted: false, hurt: 0 };
      this.emit({ type: 'monsterAppear' });
    }
    const m = s.monster;
    if (!m) return;
    m.timer += dt;
    m.hurt = Math.max(0, m.hurt - dt);
    const head = monsterHead(s)!;
    if (!m.spotted && m.depth < 0.6) {
      const light = this.searchlightRay();
      if (m.offset < 26 || (light && this.inBeam(light, head.x, head.y, 2, G.rockSpotRange))) {
        m.spotted = true;
        const st = s.stations.find((x) => x.kind === 'searchlight');
        const who = (st?.occupant && s.players.find((p) => p.id === st.occupant)) || this.closestPlayer(BOW_OFFSET, -1);
        if (who) this.say(who, 'monster');
      }
    }
    switch (m.phase) {
      case 'approach':
        m.depth = Math.max(0, m.depth - dt * 0.5);
        m.offset = Math.max(MONSTER_ATTACK_OFFSET, m.offset - G.monsterSpeed * dt);
        if (m.offset <= MONSTER_ATTACK_OFFSET) {
          m.phase = 'attack';
          m.timer = 0;
          m.attackIn = 2.5;
        }
        break;
      case 'attack':
        m.attackIn -= dt;
        if (m.attackIn <= 0) {
          m.attackIn = G.monsterAttackInterval;
          s.ship.rollVel += 0.25;
          this.emit({ type: 'monsterAttack' });
          if (!this.leakAt('bow')) {
            // no planks left to break: it squeezes the hull and water pours in
            const lower = s.compartments[s.compartments.length - 1];
            const geom = this.waterGeometry[s.compartments.length - 1];
            if (lower && geom) {
              lower.volume = Math.min(geom.capacity, lower.volume + 0.8);
              refreshSurface(geom, lower);
            }
          }
        }
        break;
      case 'flee':
        m.depth = Math.min(1.2, m.depth + dt * 0.6);
        m.offset += dt * 3;
        if (m.depth >= 1.2) s.monster = null;
        break;
    }
  }

  private fireCannon(st: StationState): void {
    const s = this.state;
    const G = this.tuning.gameplay;
    const ship = s.ship;
    const angle = st.value + ship.roll;
    const pivot = shipToWorld(ship, { x: st.x + CANNON_PIVOT.x, y: st.y + CANNON_PIVOT.y });
    const x = pivot.x + Math.cos(angle) * CANNON_LENGTH;
    const y = pivot.y + Math.sin(angle) * CANNON_LENGTH;
    s.balls.push({ id: this.nextId(), x, y, vx: Math.cos(angle) * G.ballSpeed + ship.speed, vy: Math.sin(angle) * G.ballSpeed + ship.vy, age: 0 });
    st.aux = G.cannonReload;
    ship.rollVel -= 0.06;
    this.emit({ type: 'cannonFire', player: st.occupant, x, y, angle });
  }

  private updateBalls(dt: number): void {
    const s = this.state;
    if (s.balls.length === 0) return;
    const ship = s.ship;
    const head = monsterHead(s);
    const keep = [];
    for (const b of s.balls) {
      b.vy += WORLD_GRAVITY * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.age += dt;
      if (head && s.monster && s.monster.phase !== 'flee' && Math.hypot(b.x - head.x, b.y - head.y) < 2.2) {
        this.hitMonster();
        continue;
      }
      if (b.y > seaSurfaceY(b.x, s.time, ship.seaState)) {
        this.emit({ type: 'ballSplash', x: b.x, y: b.y });
        // a rock straight ahead (in the ship's lane) breaks
        const rock = s.rocks.find((r) => !r.hit && Math.abs(r.x - b.x) < r.radius + 0.8 && Math.abs(r.lateral - ship.lateral) < r.radius + 1);
        if (rock) {
          s.rocks = s.rocks.filter((r) => r !== rock);
          s.voyage.rocksDestroyed++;
          this.emit({ type: 'rockBreak', rock: rock.id, x: rock.x });
        }
        continue;
      }
      if (b.age < 8) keep.push(b);
    }
    s.balls = keep;
  }

  private hitMonster(): void {
    const m = this.state.monster;
    if (!m) return;
    m.hp--;
    m.hurt = 0.4;
    this.emit({ type: 'monsterHit', hp: m.hp });
    if (m.hp <= 0) {
      m.phase = 'flee';
      m.timer = 0;
      this.state.voyage.monstersRepelled++;
      this.emit({ type: 'monsterFlee' });
    }
  }

  /** Automatic shouts so the crew knows what is going on without talking. */
  private updateShouts(): void {
    const s = this.state;
    const wheel = s.stations.find((st) => st.kind === 'wheel');
    // a spotted rock on the course and nobody steering: same call as drifting off course
    let rockAhead = false;
    if (wheel && !wheel.occupant && s.shouts.wheel <= 0 && s.tick % 30 === 0 && s.rocks.some((r) => r.spotted && !r.hit)) {
      const course = predictCourse(s, this.tuning, 90);
      rockAhead = s.rocks.some((r) => r.spotted && r.x - s.ship.x < 90 && rockThreat(r, s.ship.x, course, this.tuning.gameplay.shipBeam).danger);
    }
    if (wheel && !wheel.occupant && (Math.abs(s.ship.heading) > 0.45 || rockAhead) && s.shouts.wheel <= 0) {
      const p = this.closestPlayer(wheel.x, wheel.y, true);
      if (p) this.say(p, 'wheel');
      s.shouts.wheel = 14;
    }
    if (s.shouts.water <= 0) {
      for (let i = 0; i < s.compartments.length; i++) {
        const c = s.compartments[i]!;
        const cap = this.waterGeometry[i]!.capacity;
        if (cap > 0 && c.volume / cap > 0.3) {
          const p = this.closestPlayer(c.centroidX, c.surfaceY, true);
          if (p) this.say(p, 'water');
          s.shouts.water = 18;
          break;
        }
      }
    }
  }

  /** What a ping at a ship-local spot means, from what is there. */
  pingKindAt(x: number, y: number): PingKind {
    const s = this.state;
    for (const leak of s.leaks) {
      if (!leak.active) continue;
      const lp = this.leakInteriorPoint(leak.point);
      if (Math.hypot(lp.x - x, lp.y - y) < 1.4) return 'leak';
    }
    for (const st of s.stations) {
      if (Math.abs(st.x - x) < 1.2 && y > st.y - 2 && y < st.y + 0.5) return st.kind === 'workshop' ? 'plank' : st.kind;
    }
    for (const h of this.layout.hatches) {
      const g = hatchGeometry(this.layout, h);
      if (Math.abs(g.x - x) < g.width / 2 + 0.4 && Math.abs(g.top - y) < 0.8) return 'hatch';
    }
    const L = this.layout;
    const tx = x / L.tileSize + L.origin.x;
    const outside = tx < 0 || tx > L.width || (compartmentAtLocal(L, x, y) < 0 && y > 0.5);
    if (outside) return 'danger';
    return 'here';
  }

  private addPing(player: string, x: number, y: number): void {
    const s = this.state;
    if (!s.players.some((p) => p.id === player) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    x = clamp(x, -60, 60);
    y = clamp(y, -30, 30);
    const kind = this.pingKindAt(x, y);
    s.pings = s.pings.filter((pg) => pg.player !== player);
    s.pings.push({ id: this.nextId(), player, kind, x, y, time: this.tuning.gameplay.pingTime });
    this.emit({ type: 'ping', player, kind });
  }

  // ---------------------------------------------------------------- objects & sync

  private updateObjectForces(dt: number): void {
    const s = this.state;
    for (const o of s.objects) {
      if (o.carriedBy) continue;
      const rt = this.objects.get(o.id)!;
      const comp = compartmentAtLocal(this.layout, o.x, o.y);
      if (comp < 0) continue;
      const spec = OBJECT_SPECS[o.kind];
      const depth = depthBelowSurface(this.waterGeometry[comp]!, s.compartments[comp]!, o.x, o.y + spec.hy);
      if (depth <= 0) continue;
      const frac = clamp(depth / (spec.hy * 2), 0, 1);
      const m = spec.mass;
      const g = s.ship.gravity;
      const v = rt.body.linvel();
      const k = spec.buoyancy * frac * dt * m;
      const drag = 1.8 * frac * dt * m;
      rt.body.applyImpulse({ x: -g.x * k - v.x * drag, y: -g.y * k - v.y * drag }, true);
    }
  }

  private syncBodies(dt: number): void {
    const s = this.state;
    const L = this.layout;
    const minX = (0 - L.origin.x - 3) * L.tileSize;
    const maxX = (L.width - L.origin.x + 3) * L.tileSize;
    const maxY = (L.height - L.origin.y + 2) * L.tileSize;
    for (const ws of s.stations) {
      if (ws.kind === 'workshop' && ws.value > 0) ws.value = Math.max(0, ws.value - dt);
      if (ws.kind === 'cannon' && ws.aux > 0) ws.aux = Math.max(0, ws.aux - dt);
    }

    for (const p of s.players) {
      const rt = this.players.get(p.id)!;
      if (p.overboard > 0) continue;
      const t = rt.body.translation();
      const v = rt.body.linvel();
      const wasFalling = p.fallSpeed;
      p.x = t.x;
      p.y = t.y;
      p.vx = v.x;
      p.vy = v.y;
      if (!p.grounded) p.fallSpeed = Math.max(p.fallSpeed, v.y);
      else if (wasFalling > 0) {
        if (wasFalling > 5) this.emit({ type: 'land', player: p.id, speed: wasFalling });
        p.fallSpeed = 0;
      }
      const comp = compartmentAtLocal(L, p.x, p.y);
      p.inWater =
        comp >= 0
          ? clamp(depthBelowSurface(this.waterGeometry[comp]!, s.compartments[comp]!, p.x, p.y + PLAYER_HALF_HEIGHT) / PLAYER_HEIGHT, 0, 1)
          : 0;
      if (p.x < minX || p.x > maxX || p.y > maxY) {
        if (p.carrying !== null) this.dropObject(p, rt, true);
        this.leaveStation(p);
        p.climbing = null;
        p.action = null;
        p.overboard = this.tuning.gameplay.overboardTime;
        rt.body.setEnabled(false);
        this.emit({ type: 'overboard', player: p.id });
        this.emit({ type: 'splash', x: p.x, y: p.y, strength: 1 });
      }
      const anim = this.animFor(p);
      if (anim !== p.anim) {
        p.anim = anim;
        p.animTime = 0;
      } else p.animTime += dt;
    }

    for (const o of s.objects) {
      const rt = this.objects.get(o.id)!;
      if (o.carriedBy) {
        const carrier = s.players.find((pp) => pp.id === o.carriedBy);
        if (carrier) {
          const spec = OBJECT_SPECS[o.kind];
          o.x = carrier.x + carrier.facing * 0.05;
          o.y = carrier.y - PLAYER_HALF_HEIGHT - spec.hy + 0.08;
          o.angle = 0;
          o.vx = carrier.vx;
          o.vy = carrier.vy;
          o.av = 0;
        }
        continue;
      }
      const t = rt.body.translation();
      const v = rt.body.linvel();
      o.x = t.x;
      o.y = t.y;
      o.angle = rt.body.rotation();
      o.vx = v.x;
      o.vy = v.y;
      o.av = rt.body.angvel();
      if (o.x < minX || o.x > maxX || o.y > maxY) {
        this.emit({ type: 'splash', x: o.x, y: o.y, strength: 0.6 });
        if (o.spawn) {
          rt.body.setTranslation(o.spawn, true);
          rt.body.setLinvel({ x: 0, y: 0 }, true);
          rt.body.setRotation(0, true);
          rt.body.setAngvel(0, true);
          o.x = o.spawn.x;
          o.y = o.spawn.y;
          o.angle = 0;
          o.vx = 0;
          o.vy = 0;
          o.av = 0;
        } else {
          this.removeObject(o.id);
        }
      }
    }
  }

  private animFor(p: PlayerState): PlayerState['anim'] {
    if (p.station !== null) return 'station';
    if (p.action) return 'repair';
    if (p.climbing !== null) return 'climb';
    if (p.inWater > 0.55) return 'swim';
    if (!p.grounded) return p.vy < 0 ? 'jump' : 'fall';
    return this.players.get(p.id)?.moveDir ? 'run' : 'idle';
  }

  // ---------------------------------------------------------------- debug

  /** Collider outlines from Rapier's debug renderer (ship-local line segments). */
  debugLines(): { vertices: Float32Array; colors: Float32Array } {
    const b = this.world.debugRender();
    return { vertices: b.vertices, colors: b.colors };
  }

  /** Number of rigid bodies and colliders in the physics world. */
  physicsStats(): { bodies: number; colliders: number } {
    return { bodies: this.world.bodies.len(), colliders: this.world.colliders.len() };
  }

  /** The roll is forced to `value` (radians) while not null - used by tests and the debug menu. */
  get forcedRollValue(): number | null {
    return this.state.forcedRoll;
  }
}
