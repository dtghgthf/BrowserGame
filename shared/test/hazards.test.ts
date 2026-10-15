import { describe, expect, it } from 'vitest';
import {
  BOW_OFFSET,
  DEFAULT_TUNING,
  EMPTY_INPUT,
  PLAYER_HALF_HEIGHT,
  SIM_DT,
  Simulation,
  compartmentAtLocal,
  hookPoint,
  pirateShip,
  tileToLocal,
  type GameEvent,
  type PlayerInput,
  type SimCommand,
  type TuningPatch,
} from '../src';

const input = (over: Partial<PlayerInput> = {}): PlayerInput => ({ ...EMPTY_INPUT, ...over });

function run(sim: Simulation, seconds: number, inp: () => Record<string, PlayerInput> = () => ({}), cmds: SimCommand[] = []): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    sim.step(inp(), SIM_DT, i === 0 ? cmds : []);
    events.push(...sim.state.events);
  }
  return events;
}

function tap(sim: Simulation, id: string, key: keyof PlayerInput, hold: Partial<PlayerInput> = {}): GameEvent[] {
  sim.step({ [id]: input({ ...hold, [key]: true }) });
  const ev = [...sim.state.events];
  sim.step({ [id]: input(hold) });
  return [...ev, ...sim.state.events];
}

/** Calm sea, no random encounters, no rocks, no storm events. */
async function calm(tuning: TuningPatch = {}): Promise<Simulation> {
  const sim = await Simulation.create({
    seaState: 0,
    tuning: { ...tuning, gameplay: { encounterFirstAt: 99, waveEvery: 0, lightningEvery: 0, ...tuning.gameplay } },
  });
  sim.state.voyage.nextRockX = 1e9;
  return sim;
}

function stand(sim: Simulation, id: string, x: number, feetY: number): void {
  sim.teleportPlayer(id, x, feetY - PLAYER_HALF_HEIGHT - 0.02);
  run(sim, 0.3);
}

/** Top of the main deck (feet height) in ship-local meters. */
const deckY = (sim: Simulation) => tileToLocal(sim.layout, 0, 13).y;

describe('fire', () => {
  it('a fire grows and spreads along the floor, flooding puts it out', async () => {
    const sim = await calm();
    const f = sim.state.fires;
    run(sim, 0.1, () => ({}), [{ type: 'debugHazard', what: 'fire' }]);
    expect(f.length).toBe(1);
    const first = sim.state.fires[0]!;
    // it burns on a floor tile
    run(sim, 30);
    expect(sim.state.fires.length).toBeGreaterThan(1);
    expect(sim.state.fires.every((x) => Math.abs(x.ty - first.ty) <= 2)).toBe(true);
    // fill the compartment: the water drowns the fire
    const c = sim.layout.compartmentOf[first.ty * sim.layout.width + first.tx]!;
    if (c >= 0) {
      run(sim, 0.1, () => ({}), [{ type: 'debugWater', compartment: c, volume: 60 }]);
      run(sim, 0.5);
      expect(sim.state.fires.some((x) => sim.layout.compartmentOf[x.ty * sim.layout.width + x.tx] === c)).toBe(false);
    }
  });

  it('a bucket scoops water from the flooded hold and douses a fire', async () => {
    const sim = await calm();
    sim.addPlayer('a');
    run(sim, 0.5);
    const bucket = sim.state.objects.find((o) => o.kind === 'bucket')!;
    // flood the middle deck a bit
    run(sim, 0.1, () => ({}), [{ type: 'debugWater', compartment: 0, volume: 8 }]);
    run(sim, 3);
    stand(sim, 'a', bucket.x, bucket.y + 0.25);
    tap(sim, 'a', 'pick');
    expect(sim.state.players[0]!.carrying).toBe(bucket.id);
    expect(sim.state.players[0]!.inWater).toBeGreaterThan(0.12);
    const v0 = sim.state.compartments[0]!.volume;
    tap(sim, 'a', 'interact');
    expect(bucket.fill).toBe(1);
    expect(sim.state.compartments[0]!.volume).toBeLessThan(v0);
    // a fire right next to the player
    const p = sim.state.players[0]!;
    const t = { x: (p.x + 0.4) / sim.layout.tileSize + sim.layout.origin.x, y: (p.y + PLAYER_HALF_HEIGHT - 0.1) / sim.layout.tileSize + sim.layout.origin.y };
    sim.state.fires.push({ id: 500, tx: Math.floor(t.x), ty: Math.floor(t.y), heat: 0.8, age: 0 });
    sim.state.compartments[0]!.volume = 0;
    const events = tap(sim, 'a', 'interact');
    expect(events.some((e) => e.type === 'extinguish')).toBe(true);
    expect(sim.state.fires.length).toBe(0);
    expect(bucket.fill).toBe(0);
    expect(sim.state.voyage.firesPut).toBe(1);
  });

  it('a long fire next to the hull burns a leak', async () => {
    const sim = await calm({ gameplay: { fireDamageTime: 2, fireSpread: 0 } });
    const lp = sim.layout.leakPoints.find((l) => l.inward.y === 0)!;
    // floor tile next to the leak point
    let ty = lp.ty;
    while (ty < sim.layout.height - 2 && sim.layout.tiles[(ty + 1) * sim.layout.width + lp.tx + lp.inward.x] !== 2) ty++;
    sim.state.fires.push({ id: 1, tx: lp.tx + lp.inward.x, ty, heat: 1, age: 0 });
    run(sim, 3);
    expect(sim.state.leaks.some((l) => l.active)).toBe(true);
  });
});

describe('storm', () => {
  it('a breaking wave knocks players on the open deck, not below', async () => {
    const sim = await calm();
    sim.addPlayer('deck');
    sim.addPlayer('hold');
    run(sim, 0.5);
    stand(sim, 'deck', 2, deckY(sim));
    stand(sim, 'hold', -9, tileToLocal(sim.layout, 0, 19).y);
    expect(compartmentAtLocal(sim.layout, sim.state.players[1]!.x, sim.state.players[1]!.y)).toBeGreaterThanOrEqual(0);
    const before = sim.state.players.map((p) => p.x);
    const events = run(sim, 0.4, () => ({}), [{ type: 'debugHazard', what: 'wave' }]);
    expect(events.some((e) => e.type === 'wave')).toBe(true);
    expect(sim.state.players[0]!.x).toBeLessThan(before[0]! - 0.8);
    expect(Math.abs(sim.state.players[1]!.x - before[1]!)).toBeLessThan(0.3);
  });

  it('waves are announced in a storm', async () => {
    const sim = await Simulation.create({ seaState: 1.2, tuning: { gameplay: { encounterFirstAt: 99, waveEvery: 5, lightningEvery: 4 } } });
    sim.state.voyage.nextRockX = 1e9;
    sim.state.voyage.waveIn = 1;
    sim.state.voyage.lightningIn = 1;
    const events = run(sim, 4);
    expect(events.some((e) => e.type === 'waveWarn')).toBe(true);
    expect(events.some((e) => e.type === 'wave')).toBe(true);
    expect(events.some((e) => e.type === 'lightning')).toBe(true);
  });
});

describe('encounters', () => {
  it('the encounter table follows its weights', async () => {
    const sim = await calm({ gameplay: { encounterFirstAt: 0, weightKraken: 0, weightPirates: 1, weightIce: 0, weightWhirl: 0, weightFlotsam: 0 } });
    sim.state.voyage.nextEncounterX = sim.state.ship.x;
    const events = run(sim, 0.1);
    expect(events.some((e) => e.type === 'pirateAppear')).toBe(true);
    expect(sim.state.monster).toBeNull();
  });

  it('pirates fire at the ship, hook the bow and flee after enough hits', async () => {
    const sim = await calm({ gameplay: { pirateFireInterval: 2, pirateHookAfter: 4, pirateAccuracy: 0.5 } });
    sim.addPlayer('a');
    run(sim, 0.1, () => ({}), [{ type: 'debugHazard', what: 'pirates' }]);
    let events = run(sim, 25);
    expect(sim.state.pirate!.phase).toBe('fight');
    expect(events.some((e) => e.type === 'pirateFire')).toBe(true);
    expect(events.some((e) => e.type === 'shipHit')).toBe(true);
    expect(events.some((e) => e.type === 'hook' && e.on)).toBe(true);
    // hooked: the ship is slowed down
    expect(sim.state.pirate!.hook).toBeGreaterThan(0);
    expect(sim.state.ship.speed).toBeLessThan(DEFAULT_TUNING.ship.speed * 0.6);
    // cut the hook at the bow
    sim.state.pirate!.hookIn = 1e9;
    const point = hookPoint(sim.layout);
    stand(sim, 'a', point.x - 0.5, point.y);
    tap(sim, 'a', 'interact');
    expect(sim.state.players[0]!.action?.kind).toBe('cut');
    run(sim, DEFAULT_TUNING.player.cutTime + 0.1);
    expect(sim.state.pirate!.hook).toBe(0);
    // cannon balls into the sloop drive it off; it leaves flotsam behind
    for (let i = 0; i < DEFAULT_TUNING.gameplay.pirateHp; i++) {
      const pos = pirateShip(sim.state)!;
      sim.state.balls.push({ id: 900 + i, x: pos.x, y: pos.y - 1.5, vx: 0, vy: 0, age: 0, pirate: false });
      run(sim, 0.05);
    }
    expect(sim.state.pirate!.phase).toBe('flee');
    expect(sim.state.voyage.piratesBeaten).toBe(1);
    expect(sim.state.flotsam.length).toBe(2);
    events = run(sim, 20);
    expect(sim.state.pirate).toBeNull();
  });

  it('a whirlpool pulls the ship sideways; its middle knocks a leak into the keel', async () => {
    const sim = await calm({ gameplay: { whirlPull: 3 } });
    sim.state.whirl = { x: sim.state.ship.x + 14, lateral: sim.state.ship.lateral + 4, radius: 12, spotted: false, hit: false };
    const lat0 = sim.state.ship.lateral;
    run(sim, 2);
    expect(sim.state.ship.lateral).toBeGreaterThan(lat0 + 0.5);
    sim.state.whirl!.lateral = sim.state.ship.lateral;
    sim.state.whirl!.x = sim.state.ship.x + 1;
    const events = run(sim, 0.5);
    expect(events.some((e) => e.type === 'whirlHit')).toBe(true);
    expect(sim.state.leaks.some((l) => l.active)).toBe(true);
  });

  it('ice floes take two cannon hits', async () => {
    const sim = await calm();
    const lane = sim.state.ship.lateral;
    sim.state.rocks.push({ id: 5, x: sim.state.ship.x + 40, lateral: lane, radius: 2, spotted: true, hit: false, kind: 'ice', hp: 2 });
    const drop = (id: number) => sim.state.balls.push({ id, x: sim.state.ship.x + 40, y: 0.5, vx: 0, vy: 1, age: 1, pirate: false });
    drop(1);
    let events = run(sim, 0.05);
    expect(events.some((e) => e.type === 'iceHit')).toBe(true);
    expect(sim.state.rocks).toHaveLength(1);
    drop(2);
    events = run(sim, 0.05);
    expect(events.some((e) => e.type === 'rockBreak')).toBe(true);
    expect(sim.state.rocks).toHaveLength(0);
  });

  it('an ice field turns the next rocks into ice', async () => {
    const sim = await calm();
    sim.state.voyage.nextRockX = sim.state.ship.x + 60;
    run(sim, 0.1, () => ({}), [{ type: 'debugHazard', what: 'ice' }]);
    run(sim, 60);
    expect(sim.state.rocks.some((r) => r.kind === 'ice')).toBe(true);
  });

  it('flotsam in the lane is fished out from the deck and becomes a crate', async () => {
    const sim = await calm();
    sim.addPlayer('a');
    run(sim, 0.5);
    stand(sim, 'a', 4, deckY(sim));
    sim.state.flotsam.push({ id: 7, x: sim.state.ship.x + sim.state.players[0]!.x + 1, lateral: sim.state.ship.lateral, spotted: true });
    const crates = sim.state.objects.filter((o) => o.kind === 'crate').length;
    expect(sim.interactionHints('a').interact?.label).toBe('Treibgut fischen');
    tap(sim, 'a', 'interact');
    expect(sim.state.flotsam).toHaveLength(0);
    expect(sim.state.objects.filter((o) => o.kind === 'crate').length).toBe(crates + 1);
    expect(sim.state.voyage.flotsamFished).toBe(1);
  });

  it('unfished flotsam drifts past the stern and is lost', async () => {
    const sim = await calm();
    sim.state.flotsam.push({ id: 7, x: sim.state.ship.x - BOW_OFFSET - 3, lateral: 30, spotted: true });
    run(sim, 1);
    expect(sim.state.flotsam).toHaveLength(0);
  });
});

describe('man overboard', () => {
  it('alone he respawns quickly; with a crew he waits for the life ring', async () => {
    const solo = await calm();
    solo.addPlayer('a');
    run(solo, 0.5);
    solo.teleportPlayer('a', -40, 0);
    run(solo, 0.2);
    expect(solo.state.players[0]!.overboard).toBeGreaterThan(0);
    expect(solo.state.players[0]!.overboard).toBeLessThanOrEqual(DEFAULT_TUNING.gameplay.overboardTime);

    const sim = await calm();
    sim.addPlayer('a');
    sim.addPlayer('b');
    run(sim, 0.5);
    sim.teleportPlayer('a', -40, 0);
    run(sim, 0.2);
    expect(sim.state.players[0]!.overboard).toBeGreaterThan(DEFAULT_TUNING.gameplay.overboardTime);
    expect(sim.state.players[1]!.bubble?.key).toBe('overboard');
  });

  it('the ring is thrown, caught and pulled in: the swimmer is back on board', async () => {
    const sim = await calm();
    sim.addPlayer('a');
    sim.addPlayer('b');
    run(sim, 0.5);
    const ringSt = sim.state.stations.find((s) => s.kind === 'ring')!;
    stand(sim, 'b', ringSt.x, ringSt.y);
    tap(sim, 'b', 'interact');
    expect(sim.state.players[1]!.station).toBe(ringSt.id);
    // a is in the water behind the ship
    sim.teleportPlayer('a', -40, 0);
    run(sim, 0.1);
    const swimmer = sim.state.players[0]!;
    expect(swimmer.overboard).toBeGreaterThan(0);
    // throw towards the swimmer, straight from where he is (the ship sails on, he drifts back)
    const events = tap(sim, 'b', 'pick');
    expect(events.some((e) => e.type === 'ringThrow')).toBe(true);
    run(sim, 2);
    const ring = sim.state.ring!;
    expect(ring.phase).not.toBe('flying');
    // he swims to the ring
    swimmer.seaX = ring.x + 0.5;
    let caught = run(sim, 0.2);
    expect(caught.some((e) => e.type === 'ringCatch')).toBe(true);
    expect(sim.state.ring!.phase).toBe('pulling');
    // pull hand over hand
    caught = [];
    for (let k = 0; k < 40 && sim.state.ring; k++) caught.push(...run(sim, 0.3, () => ({ b: input({ left: k % 2 === 0, right: k % 2 === 1 }) })));
    expect(caught.some((e) => e.type === 'rescued')).toBe(true);
    expect(sim.state.players[0]!.overboard).toBe(0);
    expect(sim.state.voyage.rescues).toBe(1);
    run(sim, 1);
    expect(sim.state.players[0]!.y).toBeLessThan(0);
  });
});
