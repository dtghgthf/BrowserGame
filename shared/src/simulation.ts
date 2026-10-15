import { GRAVITY, SIM_DT } from './constants';
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
  PLAYER,
  PLAYER_HALF_HEIGHT,
  PLAYER_HEIGHT,
  slideVelocity,
  type LadderZone,
} from './player';
import { nextRandom } from './rng';
import { seaSurfaceY } from './sea';
import { createShipState, shipToWorld, updateShip } from './ship';
import type {
  BubbleKey,
  GameEvent,
  GameState,
  ObjectKind,
  ObjectState,
  PlayerState,
  StationKind,
  StationState,
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

export const GAMEPLAY = {
  /** Leak inflow in m^2/s per sqrt(m) of depth below the outside waterline. */
  leakRate: 0.3,
  /** Volume removed per pump stroke (half swing), m^2. */
  pumpStroke: 0.16,
  /** Pump handle speed (handle units per second, full swing = 2 units). */
  pumpHandleSpeed: 8,
  /** Rudder change per second while turning the wheel. */
  wheelSpeed: 0.9,
  searchlightSpeed: 1.5,
  cannonSpeed: 1.0,
  workshopCooldown: 1.0,
  /** Fraction of total hull capacity at which the ship is lost. */
  sinkFraction: 0.8,
  sunkResetTime: 5,
  overboardTime: 2.5,
  bubbleTime: 3,
} as const;

export interface SimulationOptions {
  seed?: number;
  seaState?: number;
  layout?: ShipLayout;
}

interface PlayerRuntime {
  body: RigidBody;
  collider: Collider;
  airTime: number;
  jumpBuffer: number;
  fallSpeed: number;
  spawnIndex: number;
  filter: number;
  /** Horizontal input direction of the current tick (for animation). */
  moveDir: number;
}

interface ObjectRuntime {
  body: RigidBody;
  collider: Collider;
  spawn: Vec2 | null;
}

const STATION_KINDS: Partial<Record<MarkerDef['type'], StationKind>> = {
  wheel: 'wheel',
  pump: 'pump',
  searchlight: 'searchlight',
  cannon: 'cannon',
  workshop: 'workshop',
};

/** Stations a player can enter (workshop is used by pressing E/F next to it instead). */
const OPERABLE: ReadonlySet<StationKind> = new Set(['wheel', 'pump', 'searchlight', 'cannon']);

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
  state!: GameState;

  private world!: World;
  private hatchColliders: Collider[] = [];
  private readonly players = new Map<string, PlayerRuntime>();
  private readonly objects = new Map<number, ObjectRuntime>();
  private forcedRoll: number | null = null;
  private leakCursor = 0;
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
    this.seed = options.seed ?? 1337;
    this.initialSeaState = options.seaState ?? 0.75;
    this.reset();
  }

  // ---------------------------------------------------------------- setup

  /** Rebuilds the physics world and resets the game state. Players are kept. */
  reset(): void {
    const playerIds = this.state ? this.state.players.map((p) => p.id) : [];
    if (this.world) this.world.free();
    this.players.clear();
    this.objects.clear();

    this.world = new RAPIER.World({ x: 0, y: 0 });
    this.world.timestep = SIM_DT;
    const statics = buildStaticColliders(this.world, this.layout);
    this.hatchColliders = statics.hatchColliders;

    const seaState = this.state?.ship.seaState ?? this.initialSeaState;
    this.state = {
      tick: 0,
      time: 0,
      rng: this.seed >>> 0,
      status: 'sailing',
      statusTimer: 0,
      ship: createShipState(seaState),
      players: [],
      objects: [],
      hatches: this.layout.hatches.map((h) => ({ id: h.id, open: true })),
      compartments: this.waterGeometry.map((g) => createCompartmentState(g)),
      leaks: [],
      stations: this.createStations(),
      events: [{ type: 'reset' }],
      nextObjectId: 1,
    };
    this.layout.hatches.forEach((h) => applyHatchState(this.hatchColliders[h.id]!, h, true));

    for (const m of this.layout.markers) {
      if (m.type === 'crate' || m.type === 'barrel' || m.type === 'plank') {
        const spec = OBJECT_SPECS[m.type];
        const p = tileToLocal(this.layout, m.tx + 0.5, m.ty + 1);
        this.spawnObject(m.type, p.x, p.y - spec.hy - 0.01, true);
      }
    }
    for (const id of playerIds) this.addPlayer(id);
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

  addPlayer(id: string): PlayerState {
    const existing = this.state.players.find((p) => p.id === id);
    if (existing) return existing;
    const used = new Set(this.state.players.map((p) => p.color));
    let color = 0;
    while (used.has(color)) color++;
    const spawn = this.spawnPoint(color);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(spawn.x, spawn.y).lockRotations().setGravityScale(0).setCcdEnabled(true),
    );
    const filter = PLAYER_FILTER_BASE | GROUP.PLATFORM;
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER.halfHeight, PLAYER.radius)
        .setMass(PLAYER.mass)
        .setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0)
        .setCollisionGroups(groups(GROUP.PLAYER, filter)),
      body,
    );
    this.players.set(id, { body, collider, airTime: 0, jumpBuffer: 0, fallSpeed: 0, spawnIndex: color, filter, moveDir: 0 });
    const p: PlayerState = {
      id,
      color,
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
    };
    this.state.players.push(p);
    return p;
  }

  /** Moves a player (ship-local meters, body centre). Used by tests and debug tools. */
  teleportPlayer(id: string, x: number, y: number): void {
    const rt = this.players.get(id);
    const p = this.state.players.find((pp) => pp.id === id);
    if (!rt || !p) return;
    rt.body.setTranslation({ x, y }, true);
    rt.body.setLinvel({ x: 0, y: 0 }, true);
    p.x = x;
    p.y = y;
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
    const { body, collider } = createObjectBody(this.world, kind, x, y);
    this.objects.set(id, { body, collider, spawn: rememberSpawn ? { x, y } : null });
    const o: ObjectState = { id, kind, x, y, angle: 0, vx: 0, vy: 0, carriedBy: null };
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

    if (s.status === 'sunk') {
      s.statusTimer -= dt;
      if (s.statusTimer <= 0) {
        this.reset();
        return;
      }
    }

    // ship motion (uses the water distribution from the previous step)
    let volume = 0;
    let moment = 0;
    for (const c of s.compartments) {
      volume += c.volume;
      moment += c.volume * c.centroidX;
    }
    updateShip(s.ship, s.time, dt, { volume, moment });
    if (this.forcedRoll !== null) {
      s.ship.roll = this.forcedRoll;
      s.ship.rollVel = 0;
      s.ship.ay = 0;
      s.ship.gravity.x = Math.sin(this.forcedRoll) * GRAVITY;
      s.ship.gravity.y = Math.cos(this.forcedRoll) * GRAVITY;
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
        this.state.ship.seaState = clamp(c.value, 0, 1.5);
        break;
      case 'debugRoll':
        this.forcedRoll = c.value;
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
    p.bubble = { key, time: GAMEPLAY.bubbleTime };
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
    const grounded = this.probeGround(rt);
    p.grounded = grounded;
    rt.airTime = grounded ? 0 : rt.airTime + dt;
    rt.jumpBuffer = pressed('jump') ? PLAYER.jumpBuffer : Math.max(0, rt.jumpBuffer - dt);

    // an E/jump press that leaves a station or cancels an action is consumed
    let consumed = false;

    // ---- station mode: the player is parked at the station, inputs drive it
    if (p.station !== null) {
      const st = this.state.stations[p.station]!;
      if (pressed('interact') || pressed('jump')) {
        this.leaveStation(p);
        consumed = true;
        rt.jumpBuffer = 0;
      } else {
        this.operateStation(st, input, dt);
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
        rt.jumpBuffer = 0;
      } else {
        p.action.progress += dt;
        const v = rt.body.linvel();
        rt.body.setLinvel({ x: approach(v.x, 0, PLAYER.groundAccel * dt), y: clampFall(v.y + g.y * dt) }, true);
        if (p.action.progress >= PLAYER.repairTime) this.finishRepair(p);
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
    const speed = moveSpeed(carrying, p.inWater);
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
        rt.jumpBuffer = 0;
      }
    }
    if (p.climbing !== null) {
      const z = this.ladders[p.climbing]!;
      const climb = PLAYER.climbSpeed * (carrying ? PLAYER.carryClimbFactor : 1);
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
      if (rt.jumpBuffer > 0) {
        leave = true;
        rt.jumpBuffer = 0;
        vy = -PLAYER.jumpSpeed * 0.55;
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
      const target = dir * speed + (swimming ? 0 : slideVelocity(g.x));
      vx = approach(vx, target, PLAYER.groundAccel * dt);
      vy += g.y * dt;
    } else {
      if (dir !== 0) vx = approach(vx, dir * speed, PLAYER.airAccel * dt);
      vx += g.x * dt * (swimming ? 0.3 : 1);
      vy += g.y * dt * (swimming ? 0.3 : 1);
    }
    if (swimming) {
      vx *= 1 - 2 * dt;
      vy *= 1 - 2.5 * dt;
    }
    const canJump = grounded || rt.airTime < PLAYER.coyoteTime || swimming;
    if (rt.jumpBuffer > 0 && canJump) {
      vy = -PLAYER.jumpSpeed * (carrying ? PLAYER.carryJumpFactor : 1) * (swimming ? 0.7 : 1);
      rt.jumpBuffer = 0;
      rt.airTime = PLAYER.coyoteTime;
      this.emit({ type: 'jump', player: p.id });
    }
    vy = clampFall(vy);
    rt.body.setLinvel({ x: vx, y: vy }, true);
    this.setPlatformFilter(p, rt, true);
  }

  /** Ray casts below the feet. Uses the player's current collision filter so non-solid platforms are ignored. */
  private probeGround(rt: PlayerRuntime): boolean {
    const t = rt.body.translation();
    const feet = t.y + PLAYER_HALF_HEIGHT;
    const flags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    const grp = groups(GROUP.PLAYER, rt.filter);
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
        if (Math.abs(t.x - g.x) > g.width / 2 + PLAYER.radius) continue;
        if (feet > g.top + 0.1 && head < g.bottom) {
          solid = false;
          break;
        }
      }
    }
    const filter = PLAYER_FILTER_BASE | (solid ? GROUP.PLATFORM : 0);
    if (filter !== rt.filter) {
      rt.filter = filter;
      rt.collider.setCollisionGroups(groups(GROUP.PLAYER, filter));
    }
  }

  private respawnPlayer(p: PlayerState, rt: PlayerRuntime): void {
    const s = this.spawnPoint(rt.spawnIndex);
    rt.body.setEnabled(true);
    rt.body.setTranslation(s, true);
    rt.body.setLinvel({ x: 0, y: 0 }, true);
    p.overboard = 0;
    p.x = s.x;
    p.y = s.y;
  }

  // ---------------------------------------------------------------- interactions

  private interact(p: PlayerState, rt: PlayerRuntime): void {
    const feetY = p.y + PLAYER_HALF_HEIGHT;
    type Candidate = { d: number; run: () => void };
    const candidates: Candidate[] = [];

    for (const st of this.state.stations) {
      const dx = Math.abs(st.x - p.x);
      const dy = Math.abs(st.y - feetY);
      if (dy > 0.6) continue;
      if (st.kind === 'workshop') {
        if (dx < 1.0 && p.carrying === null) candidates.push({ d: dx, run: () => this.takePlank(p) });
      } else if (OPERABLE.has(st.kind) && st.occupant === null && dx < PLAYER.stationRange) {
        candidates.push({ d: dx, run: () => this.enterStation(p, rt, st) });
      }
    }
    for (const h of this.layout.hatches) {
      const g = hatchGeometry(this.layout, h);
      const dx = Math.abs(g.x - p.x);
      if (dx > g.width / 2 + PLAYER.hatchRange) continue;
      const headY = p.y - PLAYER_HALF_HEIGHT;
      const fromAbove = Math.abs(feetY - g.top) < 0.4;
      const fromBelow = headY > g.bottom - 0.1 && headY - g.bottom < 1.4;
      if (fromAbove || fromBelow) candidates.push({ d: dx + 0.25, run: () => this.toggleHatch(h.id) });
    }
    for (const leak of this.state.leaks) {
      if (!leak.active) continue;
      const lp = this.leakInteriorPoint(leak.point);
      const d = Math.hypot(lp.x - p.x, lp.y - p.y);
      if (d < PLAYER.leakRange) {
        candidates.push({
          d: d - 0.5,
          run: () => {
            const obj = p.carrying !== null ? this.state.objects.find((o) => o.id === p.carrying) : undefined;
            if (obj && obj.kind === 'plank') p.action = { kind: 'repair', target: leak.id, progress: 0 };
            else this.say(p, 'plank');
          },
        });
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    candidates[0]?.run();
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

  private operateStation(st: StationState, input: Readonly<PlayerInput>, dt: number): void {
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    switch (st.kind) {
      case 'wheel': {
        st.value = clamp(st.value + dir * GAMEPLAY.wheelSpeed * dt, -1, 1);
        this.state.ship.rudder = st.value;
        break;
      }
      case 'pump': {
        // alternate left/right (or up/down) to swing the handle; each full swing pumps water
        const pdir = dir !== 0 ? dir : (input.down ? 1 : 0) - (input.up ? 1 : 0);
        if (pdir === 0) break;
        const before = st.value;
        st.value = clamp(st.value + pdir * GAMEPLAY.pumpHandleSpeed * dt, -1, 1);
        const reachedEnd = (pdir > 0 && before < 1 && st.value >= 1) || (pdir < 0 && before > -1 && st.value <= -1);
        if (reachedEnd) {
          const comp = this.pumpCompartment(st);
          if (comp >= 0) {
            const c = this.state.compartments[comp]!;
            const removed = Math.min(c.volume, GAMEPLAY.pumpStroke);
            c.volume -= removed;
            refreshSurface(this.waterGeometry[comp]!, c);
            st.aux += 1;
            this.emit({ type: 'pumpStroke', station: st.id, volume: removed });
          }
        }
        break;
      }
      case 'searchlight':
        st.value = wrapAngle(st.value + dir * GAMEPLAY.searchlightSpeed * dt);
        break;
      case 'cannon':
        st.value = clamp(st.value + dir * GAMEPLAY.cannonSpeed * dt, -1.3, 0.35);
        break;
      case 'workshop':
        break;
    }
  }

  private pumpCompartment(st: StationState): number {
    return compartmentAtLocal(this.layout, st.x, st.y - 0.25);
  }

  private toggleHatch(id: number): void {
    const hs = this.state.hatches[id]!;
    const def = this.layout.hatches[id]!;
    if (hs.open && this.hatchBlocked(id)) return;
    hs.open = !hs.open;
    applyHatchState(this.hatchColliders[id]!, def, hs.open);
    this.emit({ type: 'hatch', hatch: id, open: hs.open });
  }

  /** A hatch cannot be closed while something sits inside the opening. */
  private hatchBlocked(id: number): boolean {
    const g = hatchGeometry(this.layout, this.layout.hatches[id]!);
    const inside = (x: number, y: number, hx: number, hy: number) =>
      Math.abs(x - g.x) < g.width / 2 + hx - 0.02 && y + hy > g.top + 0.02 && y - hy < g.bottom - 0.02;
    for (const p of this.state.players) if (inside(p.x, p.y, PLAYER.radius, PLAYER_HALF_HEIGHT)) return true;
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
    let bestD: number = PLAYER.pickRange;
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
    ws.value = GAMEPLAY.workshopCooldown;
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
      { x: t.x + p.facing * (PLAYER.radius + s.hx + 0.06), y: feet - s.hy - 0.03 },
      { x: t.x + p.facing * (PLAYER.radius + s.hx + 0.06), y: feet - s.hy - 0.45 },
      { x: t.x, y: t.y - PLAYER_HALF_HEIGHT - s.hy - 0.05 },
      { x: t.x - p.facing * (PLAYER.radius + s.hx + 0.06), y: feet - s.hy - 0.03 },
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
        const cand = (this.leakCursor + i) % n;
        if (!this.state.leaks.some((l) => l.point === cand && l.active)) {
          idx = cand;
          break;
        }
      }
      this.leakCursor = ((idx ?? 0) + 1) % n;
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
      leak.inflow = head > 0 ? GAMEPLAY.leakRate * Math.sqrt(head) : 0;
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
    if (cap > 0 && v / cap >= GAMEPLAY.sinkFraction) {
      s.status = 'sunk';
      s.statusTimer = GAMEPLAY.sunkResetTime;
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
    for (const ws of s.stations) if (ws.kind === 'workshop' && ws.value > 0) ws.value = Math.max(0, ws.value - dt);

    for (const p of s.players) {
      const rt = this.players.get(p.id)!;
      if (p.overboard > 0) continue;
      const t = rt.body.translation();
      const v = rt.body.linvel();
      const wasFalling = rt.fallSpeed;
      p.x = t.x;
      p.y = t.y;
      p.vx = v.x;
      p.vy = v.y;
      if (!p.grounded) rt.fallSpeed = Math.max(rt.fallSpeed, v.y);
      else if (wasFalling > 0) {
        if (wasFalling > 5) this.emit({ type: 'land', player: p.id, speed: wasFalling });
        rt.fallSpeed = 0;
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
        p.overboard = GAMEPLAY.overboardTime;
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
      if (o.x < minX || o.x > maxX || o.y > maxY) {
        this.emit({ type: 'splash', x: o.x, y: o.y, strength: 0.6 });
        if (rt.spawn) {
          rt.body.setTranslation(rt.spawn, true);
          rt.body.setLinvel({ x: 0, y: 0 }, true);
          rt.body.setRotation(0, true);
          rt.body.setAngvel(0, true);
          o.x = rt.spawn.x;
          o.y = rt.spawn.y;
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
    return this.forcedRoll;
  }
}
