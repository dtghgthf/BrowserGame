import { EMPTY_INPUT, type GameState, type PlayerInput, type Simulation } from '@lw/shared';

/** Deckhands of the menu scene: id, name, coat colour. */
const CREW = [
  { id: 'menu-a', name: 'MATS', color: 1 },
  { id: 'menu-b', name: 'JULE', color: 2 },
  { id: 'menu-c', name: 'OLE', color: 3 },
];

interface Wanderer {
  id: string;
  dir: number;
  /** Seconds until the next decision. */
  next: number;
  climb: number;
  stuck: number;
  lastX: number;
}

/**
 * The scene behind the main menu: the standard ship sails a calm night sea
 * towards the lighthouse, a few deckhands wander about, and now and then the
 * kraken, the pirates or some flotsam come by. Visitors only show themselves -
 * they turn away before they could do anything. Runs on the local simulation
 * with ordinary inputs; nothing of it is kept when a real voyage starts.
 */
export class Showcase {
  active = false;
  private readonly crew: Wanderer[] = [];
  private visitIn = 6;
  private visit = 0;
  /** Seconds the current visitor has been showing itself near the bow. */
  private linger = 0;

  start(sim: Simulation): void {
    for (const p of [...sim.state.players]) sim.removePlayer(p.id);
    sim.startRun('single', Math.floor(Math.random() * 2 ** 31));
    sim.state.voyage.seaBase = 0.35;
    this.crew.length = 0;
    for (const c of CREW) {
      sim.addPlayer(c.id, { name: c.name, color: c.color });
      this.crew.push({ id: c.id, dir: 0, next: Math.random() * 2, climb: 0, stuck: 0, lastX: 0 });
    }
    this.visitIn = 6;
    this.active = true;
  }

  stop(sim: Simulation): void {
    if (!this.active) return;
    this.active = false;
    for (const c of this.crew) sim.removePlayer(c.id);
    this.crew.length = 0;
  }

  /** Before every step: keep the sea free of real danger, bring a visitor now and then, turn them away early. */
  tick(sim: Simulation, dt: number): void {
    const s = sim.state;
    const v = s.voyage;
    // no rocks, no encounters, no storm waves or lightning; the lighthouse stays on the horizon
    s.rocks.length = 0;
    v.nextRockX = s.ship.x + 1000;
    v.nextEncounterX = s.ship.x + 1000;
    v.waveIn = Math.max(v.waveIn, 60);
    v.waveWarn = 0;
    v.lightningIn = Math.max(v.lightningIn, 60);
    v.length = Math.max(v.length, s.ship.x + 2000);
    s.leaks.forEach((l) => (l.active = false));
    s.fires.length = 0;
    for (const c of s.compartments) c.volume = 0;

    this.visitIn -= dt;
    if (this.visitIn <= 0 && !s.monster && !s.pirate && s.flotsam.length === 0) {
      this.visitIn = 22 + Math.random() * 18;
      this.arrive(sim, this.visit++ % 3);
    }
    // visitors come close to the bow, stay a while where they can be seen, and leave
    const m = s.monster;
    if (m && m.phase !== 'flee') {
      m.attackIn = 99;
      const stop = sim.bowOffset + 7;
      if (m.offset <= stop + 0.5) {
        m.offset = Math.max(m.offset, stop);
        this.linger += dt;
      }
      if (m.phase === 'attack' || this.linger > 7) m.phase = 'flee';
    }
    const pr = s.pirate;
    if (pr && pr.phase !== 'flee') {
      pr.fireIn = 99;
      pr.hookIn = 99;
      const stop = sim.bowOffset + 9;
      if (pr.offset <= stop + 0.5) {
        pr.offset = Math.max(pr.offset, stop);
        this.linger += dt;
      }
      if (pr.phase === 'fight' || this.linger > 8) pr.phase = 'flee';
    }
    if (!m && !pr) this.linger = 0;
    s.balls = s.balls.filter((b) => !b.pirate);
  }

  private arrive(sim: Simulation, kind: number): void {
    const s: GameState = sim.state;
    const G = sim.tuning.gameplay;
    this.linger = 0;
    if (kind === 0) s.monster = { offset: 36, depth: 1, hp: G.monsterHp, phase: 'approach', timer: 0, attackIn: 99, spotted: false, hurt: 0 };
    else if (kind === 1) s.pirate = { offset: 45, hp: G.pirateHp, phase: 'approach', timer: 0, fireIn: 99, hook: 0, hookIn: 99, hurt: 0, spotted: false };
    else s.flotsam.push({ id: s.nextObjectId++, x: s.ship.x + 60, lateral: s.ship.lateral + 5, spotted: false });
  }

  /** The deckhands' inputs: stroll, stop, turn at walls, sometimes climb a ladder or hop. */
  inputs(sim: Simulation, dt: number): Record<string, PlayerInput> {
    const out: Record<string, PlayerInput> = {};
    for (const w of this.crew) {
      const p = sim.state.players.find((pp) => pp.id === w.id);
      if (!p) continue;
      w.next -= dt;
      if (w.next <= 0) {
        const r = Math.random();
        w.dir = r < 0.35 ? 0 : r < 0.67 ? -1 : 1;
        w.climb = Math.random() < 0.15 ? (Math.random() < 0.5 ? -1 : 1) : 0;
        w.next = 1 + Math.random() * 3;
      }
      // walked into a wall: turn round
      if (w.dir !== 0 && Math.abs(p.x - w.lastX) < 0.002 && p.climbing === null) {
        w.stuck += dt;
        if (w.stuck > 0.6) {
          w.dir = -w.dir;
          w.stuck = 0;
        }
      } else w.stuck = 0;
      w.lastX = p.x;
      out[w.id] = {
        ...EMPTY_INPUT,
        left: w.dir < 0,
        right: w.dir > 0,
        up: w.climb < 0,
        down: w.climb > 0,
        jump: w.dir !== 0 && Math.random() < 0.004,
      };
    }
    return out;
  }
}
