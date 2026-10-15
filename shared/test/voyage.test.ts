import { describe, expect, it } from 'vitest';
import {
  BOW_OFFSET,
  EMPTY_INPUT,
  PLAYER_HALF_HEIGHT,
  SIM_DT,
  Simulation,
  monsterHead,
  type GameEvent,
  type PlayerInput,
  type SimCommand,
  type TuningPatch,
} from '../src';

const input = (over: Partial<PlayerInput> = {}): PlayerInput => ({ ...EMPTY_INPUT, ...over });

/** Runs `seconds` and returns all events of that time. */
function run(sim: Simulation, seconds: number, inp: () => Record<string, PlayerInput> = () => ({}), cmds: SimCommand[] = []): GameEvent[] {
  const events: GameEvent[] = [];
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) {
    sim.step(inp(), SIM_DT, i === 0 ? cmds : []);
    events.push(...sim.state.events);
  }
  return events;
}

/** A calm sea without random rocks or kraken unless a test places them. */
async function calm(tuning: TuningPatch = {}): Promise<Simulation> {
  const sim = await Simulation.create({ seaState: 0, tuning: { ...tuning, gameplay: { monsterFirstAt: 99, ...tuning.gameplay } } });
  sim.state.voyage.nextRockX = 1e9;
  return sim;
}

function enter(sim: Simulation, id: string, kind: string) {
  const st = sim.state.stations.find((s) => s.kind === kind)!;
  sim.teleportPlayer(id, st.x, st.y - PLAYER_HALF_HEIGHT - 0.02);
  run(sim, 0.3);
  sim.step({ [id]: input({ interact: true }) });
  sim.step({ [id]: input() });
  return st;
}

describe('voyage', () => {
  it('the storm grows towards the lighthouse, arriving ends the round and restarts it', async () => {
    const sim = await calm({ gameplay: { voyageLength: 40, arrivedResetTime: 2 } });
    sim.addPlayer('a');
    const sea0 = sim.state.ship.seaState;
    run(sim, 8);
    expect(sim.state.ship.seaState).toBeGreaterThan(sea0 + 0.1);
    const events = run(sim, 15);
    expect(events.some((e) => e.type === 'arrived')).toBe(true);
    expect(events.some((e) => e.type === 'reset')).toBe(true);
    expect(sim.state.status).toBe('sailing');
    expect(sim.state.ship.x).toBeLessThan(20);
  });

  it('a rock in the lane is hit at the bow and makes a leak; one beside the lane is passed', async () => {
    const sim = await calm();
    sim.addPlayer('a');
    const ship = sim.state.ship;
    sim.state.rocks.push({ id: 900, x: ship.x + BOW_OFFSET + 3, lateral: ship.lateral + 0.5, radius: 2, spotted: false, hit: false });
    sim.state.rocks.push({ id: 901, x: ship.x + BOW_OFFSET + 8, lateral: ship.lateral + 12, radius: 2, spotted: false, hit: false });
    const events = run(sim, 6);
    expect(events.filter((e) => e.type === 'rockHit').map((e) => (e as { rock: number }).rock)).toEqual([900]);
    expect(sim.state.voyage.rocksHit).toBe(1);
    expect(sim.state.voyage.rocksPassed).toBe(1);
    const leak = sim.state.leaks.find((l) => l.active)!;
    expect(sim.layout.leakPoints[leak.point]!.tx).toBeGreaterThan(sim.layout.width / 2);
  });

  it('the searchlight spots rocks far ahead, the operator shouts', async () => {
    const sim = await calm();
    sim.addPlayer('a');
    const st = enter(sim, 'a', 'searchlight');
    const ship = sim.state.ship;
    st.value = -1.2;
    sim.state.rocks.push({ id: 5, x: ship.x + 70, lateral: 0, radius: 2.5, spotted: false, hit: false });
    // pointing at the sky: nothing
    run(sim, 0.5, () => ({ a: input({ target: -1.2 }) }));
    expect(sim.state.rocks[0]!.spotted).toBe(false);
    // sweep down towards the horizon
    let events: GameEvent[] = [];
    for (let a = -0.6; a < 0.5 && !sim.state.rocks[0]!.spotted; a += 0.02) events.push(...run(sim, 0.05, () => ({ a: input({ target: a }) })));
    expect(sim.state.rocks[0]!.spotted).toBe(true);
    expect(st.value).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'shout' && e.key === 'rock')).toBe(true);
  });
});

describe('cannon and kraken', () => {
  it('fires a ball with F, reloads, and breaks a rock where the ball lands', async () => {
    const measure = await calm();
    measure.addPlayer('a');
    enter(measure, 'a', 'cannon');
    run(measure, 1, () => ({ a: input({ target: -0.35 }) }));
    let events = run(measure, 0.05, () => ({ a: input({ target: -0.35, pick: true }) }));
    expect(events.some((e) => e.type === 'cannonFire')).toBe(true);
    expect(measure.state.balls).toHaveLength(1);
    // still reloading: a second press does nothing
    run(measure, 0.05, () => ({ a: input({ target: -0.35 }) }));
    events = run(measure, 0.05, () => ({ a: input({ target: -0.35, pick: true }) }));
    expect(events.some((e) => e.type === 'cannonFire')).toBe(false);
    events = run(measure, 5, () => ({ a: input({ target: -0.35 }) }));
    const splash = events.find((e) => e.type === 'ballSplash') as { x: number } | undefined;
    expect(splash).toBeDefined();
    expect(measure.state.balls).toHaveLength(0);

    // same shot again, with a rock in the lane where it lands
    const sim = await calm();
    sim.addPlayer('a');
    enter(sim, 'a', 'cannon');
    run(sim, 1, () => ({ a: input({ target: -0.35 }) }));
    sim.state.rocks.push({ id: 77, x: splash!.x, lateral: sim.state.ship.lateral, radius: 2, spotted: true, hit: false });
    run(sim, 0.05, () => ({ a: input({ target: -0.35, pick: true }) }));
    events = run(sim, 5, () => ({ a: input({ target: -0.35 }) }));
    expect(events.some((e) => e.type === 'rockBreak')).toBe(true);
    expect(sim.state.voyage.rocksDestroyed).toBe(1);
  });

  it('the kraken surfaces, attacks the bow and flees after three hits', async () => {
    const sim = await calm({ gameplay: { monsterAttackInterval: 3 } });
    sim.addPlayer('a');
    sim.state.voyage.nextMonsterX = sim.state.ship.x;
    let events = run(sim, 0.1);
    expect(events.some((e) => e.type === 'monsterAppear')).toBe(true);
    events = run(sim, 40);
    expect(sim.state.monster!.phase).toBe('attack');
    expect(events.some((e) => e.type === 'monsterAttack')).toBe(true);
    expect(sim.state.leaks.some((l) => l.active)).toBe(true);
    for (let i = 0; i < 3; i++) {
      const h = monsterHead(sim.state)!;
      sim.state.balls.push({ id: 1000 + i, x: h.x, y: h.y, vx: 0, vy: 0, age: 0 });
      run(sim, 0.1);
    }
    expect(sim.state.monster!.phase).toBe('flee');
    expect(sim.state.voyage.monstersRepelled).toBe(1);
    run(sim, 5);
    expect(sim.state.monster).toBeNull();
  });
});

describe('pings and shouts', () => {
  it('a ping takes its meaning from the spot, replaces the last one and fades', async () => {
    const sim = await calm({ gameplay: { pingTime: 1 } });
    sim.addPlayer('a');
    const wheel = sim.state.stations.find((s) => s.kind === 'wheel')!;
    let events = run(sim, 0.05, () => ({}), [{ type: 'ping', player: 'a', x: wheel.x, y: wheel.y - 0.5 }]);
    expect(sim.state.pings).toHaveLength(1);
    expect(sim.state.pings[0]!.kind).toBe('wheel');
    expect(events.some((e) => e.type === 'ping')).toBe(true);
    run(sim, 0.2, () => ({}), [{ type: 'debugLeak', point: 1 }]);
    const lp = sim.leakInteriorPoint(1);
    run(sim, 0.05, () => ({}), [{ type: 'ping', player: 'a', x: lp.x, y: lp.y }]);
    expect(sim.state.pings).toHaveLength(1);
    expect(sim.state.pings[0]!.kind).toBe('leak');
    run(sim, 0.05, () => ({}), [{ type: 'ping', player: 'a', x: 40, y: 2 }]);
    expect(sim.state.pings[0]!.kind).toBe('danger');
    // unknown players cannot ping
    events = run(sim, 0.05, () => ({}), [{ type: 'ping', player: 'ghost', x: 0, y: 0 }]);
    expect(events.some((e) => e.type === 'ping')).toBe(false);
    run(sim, 1.2);
    expect(sim.state.pings).toHaveLength(0);
  });

  it('somebody calls for the helmsman when the ship goes off course and nobody steers', async () => {
    const sim = await calm();
    sim.addPlayer('a');
    sim.state.shouts.wheel = 0;
    sim.state.ship.heading = 0.8;
    const events = run(sim, 0.2);
    expect(events.some((e) => e.type === 'shout' && e.key === 'wheel' && e.player === 'a')).toBe(true);
    expect(sim.state.players[0]!.bubble?.key).toBe('wheel');
  });
});
