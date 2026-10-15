import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, EMPTY_INPUT, PLAYER_HALF_HEIGHT, SIM_DT, Simulation, rollLoot, type GameEvent, type PlayerInput } from '../src';

const input = (over: Partial<PlayerInput> = {}): PlayerInput => ({ ...EMPTY_INPUT, ...over });

function run(sim: Simulation, seconds: number, inp: () => Record<string, PlayerInput> = () => ({})): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    sim.step(inp());
    events.push(...sim.state.events);
  }
  return events;
}

function tap(sim: Simulation, id: string, key: keyof PlayerInput): GameEvent[] {
  sim.step({ [id]: input({ [key]: true }) });
  const ev = [...sim.state.events];
  sim.step({ [id]: input() });
  return [...ev, ...sim.state.events];
}

async function calm(): Promise<Simulation> {
  const sim = await Simulation.create({ seaState: 0, tuning: { gameplay: { encounterFirstAt: 99 } } });
  sim.state.voyage.nextRockX = 1e9;
  sim.addPlayer('a');
  run(sim, 0.5);
  return sim;
}

/** Stands the player next to a spot (feet on the floor below it). */
function stand(sim: Simulation, x: number, feetY: number): void {
  sim.teleportPlayer('a', x, feetY - PLAYER_HALF_HEIGHT - 0.02);
  run(sim, 0.3);
}

describe('crates', () => {
  it('loot is decided by the seed and the same for every simulation', async () => {
    const a = await Simulation.create({ seed: 42 });
    const b = await Simulation.create({ seed: 42 });
    const crates = (s: Simulation) => s.state.objects.filter((o) => o.kind === 'crate').map((o) => o.contents);
    expect(crates(a)).toEqual(crates(b));
    expect(crates(a).every((c) => c.length >= 1 && c.length <= 3)).toBe(true);
    // over many rolls every kind shows up
    const seen = new Set<string>();
    const st = { rng: 7 };
    for (let i = 0; i < 400; i++) for (const k of rollLoot(st)) seen.add(k);
    expect(seen.size).toBe(9);
  });

  it('prying a crate open spills its contents and fills the stock', async () => {
    const sim = await calm();
    const crate = sim.state.objects.find((o) => o.kind === 'crate')!;
    crate.contents = ['plank', 'timber', 'coins'];
    const timber = sim.state.voyage.timber;
    const objects = sim.state.objects.length;
    stand(sim, crate.x - 0.7, crate.y + 0.375);
    tap(sim, 'a', 'interact');
    expect(sim.state.players[0]!.action?.kind).toBe('open');
    const events = run(sim, DEFAULT_TUNING.player.openTime + 0.2);
    const open = events.find((e) => e.type === 'crateOpen');
    expect(open).toMatchObject({ loot: ['plank', 'timber', 'coins'] });
    expect(crate.opened).toBe(true);
    expect(crate.contents).toEqual([]);
    expect(sim.state.objects.length).toBe(objects + 1);
    expect(sim.state.voyage.timber).toBe(timber + 1);
    expect(sim.state.voyage.coins).toBeGreaterThanOrEqual(5);
    expect(sim.state.voyage.cratesOpened).toBe(1);
  });

  it('a crowbar makes opening faster, an empty crate becomes wood at the workshop', async () => {
    const sim = await calm();
    sim.state.voyage.crowbar = true;
    const crate = sim.state.objects.find((o) => o.kind === 'crate')!;
    crate.contents = ['rat'];
    sim.state.voyage.timber = 3;
    stand(sim, crate.x - 0.7, crate.y + 0.375);
    tap(sim, 'a', 'interact');
    run(sim, DEFAULT_TUNING.player.openTime * DEFAULT_TUNING.player.crowbarFactor + 0.1);
    expect(crate.opened).toBe(true);
    // the rat took a bite of the wood
    expect(sim.state.voyage.timber).toBe(2);
    expect(sim.state.players[0]!.bubble?.key).toBe('rat');

    tap(sim, 'a', 'pick');
    expect(sim.state.players[0]!.carrying).toBe(crate.id);
    const ws = sim.state.stations.find((s) => s.kind === 'workshop')!;
    stand(sim, ws.x + 0.4, ws.y);
    tap(sim, 'a', 'interact');
    expect(sim.state.objects.some((o) => o.id === crate.id)).toBe(false);
    expect(sim.state.voyage.timber).toBe(3);
  });
});

describe('cannon loading', () => {
  it('a helper loads a ball from the rack and rams it home', async () => {
    const sim = await calm();
    const cannon = sim.state.stations.find((s) => s.kind === 'cannon')!;
    const rack = sim.state.stations.find((s) => s.kind === 'rack')!;
    cannon.charge = 0;
    stand(sim, rack.x, rack.y);
    tap(sim, 'a', 'pick');
    const ball = sim.state.objects.find((o) => o.id === sim.state.players[0]!.carrying);
    expect(ball?.kind).toBe('ball');
    stand(sim, cannon.x - 0.5, cannon.y);
    tap(sim, 'a', 'interact');
    expect(cannon.charge).toBe(1);
    expect(sim.state.players[0]!.carrying).toBeNull();
    tap(sim, 'a', 'interact');
    expect(sim.state.players[0]!.action?.kind).toBe('ram');
    run(sim, DEFAULT_TUNING.player.ramTime + 0.1);
    expect(cannon.charge).toBe(2);
  });

  it('the gunner reloads alone, slower', async () => {
    const sim = await calm();
    const cannon = sim.state.stations.find((s) => s.kind === 'cannon')!;
    stand(sim, cannon.x, cannon.y);
    tap(sim, 'a', 'interact');
    expect(sim.state.players[0]!.station).toBe(cannon.id);
    let ev = tap(sim, 'a', 'pick');
    expect(ev.some((e) => e.type === 'cannonFire')).toBe(true);
    expect(cannon.charge).toBeLessThan(0.1);
    run(sim, DEFAULT_TUNING.gameplay.cannonSoloLoad * 0.5);
    ev = tap(sim, 'a', 'pick');
    expect(ev.some((e) => e.type === 'cannonFire')).toBe(false);
    run(sim, DEFAULT_TUNING.gameplay.cannonSoloLoad * 0.6);
    expect(cannon.charge).toBe(2);
    ev = tap(sim, 'a', 'pick');
    expect(ev.some((e) => e.type === 'cannonFire')).toBe(true);
  });
});

describe('searchlight oil', () => {
  it('burns down, goes dark and is refilled from an oil can', async () => {
    const sim = await calm();
    const lamp = sim.state.stations.find((s) => s.kind === 'searchlight')!;
    sim.tuning.gameplay.oilBurn = 0.5;
    run(sim, 2.5);
    expect(lamp.charge).toBe(0);
    expect(sim.searchlightRay()).toBeNull();
    sim.tuning.gameplay.oilBurn = 0;
    // fetch the oil can and carry it up
    const can = sim.state.objects.find((o) => o.kind === 'oilcan')!;
    expect(can.fill).toBe(1);
    stand(sim, can.x, can.y + 0.25);
    tap(sim, 'a', 'pick');
    expect(sim.state.players[0]!.carrying).toBe(can.id);
    stand(sim, lamp.x + 0.6, lamp.y);
    tap(sim, 'a', 'interact');
    expect(lamp.charge).toBeCloseTo(1, 5);
    expect(can.fill).toBeCloseTo(0, 5);
    expect(sim.searchlightRay()).not.toBeNull();
  });

  it('an empty can is filled at an oil barrel', async () => {
    const sim = await calm();
    const can = sim.state.objects.find((o) => o.kind === 'oilcan')!;
    can.fill = 0;
    const barrel = sim.state.objects.find((o) => o.kind === 'barrel')!;
    stand(sim, can.x, can.y + 0.25);
    tap(sim, 'a', 'pick');
    stand(sim, barrel.x - 0.7, barrel.y + 0.375);
    tap(sim, 'a', 'interact');
    expect(can.fill).toBeCloseTo(1, 5);
    expect(barrel.fill).toBeCloseTo(0, 5);
  });
});
