import { beforeAll, describe, expect, it } from 'vitest';
import {
  EMPTY_INPUT,
  DEFAULT_TUNING,
  PLAYER_HALF_HEIGHT,
  SIM_DT,
  Simulation,
  tileToLocal,
  type PlayerInput,
  type SimCommand,
} from '../src';

/** Index of the leak point in the stern of the lower deck (tile 6,22). */
const STERN_LEAK = 1;
const deg = (d: number) => (d * Math.PI) / 180;
const input = (over: Partial<PlayerInput> = {}): PlayerInput => ({ ...EMPTY_INPUT, ...over });

function run(sim: Simulation, seconds: number, inp: (t: number) => Record<string, PlayerInput> = () => ({}), cmds: SimCommand[] = []) {
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) sim.step(inp(i * SIM_DT), SIM_DT, i === 0 ? cmds : []);
}

/** Presses a key for one tick, then releases it for one tick. */
function tap(sim: Simulation, id: string, key: keyof PlayerInput, hold: Partial<PlayerInput> = {}) {
  sim.step({ [id]: input({ ...hold, [key]: true }) });
  sim.step({ [id]: input(hold) });
}

let calmSim: Simulation;
beforeAll(async () => {
  calmSim = await Simulation.create({ seaState: 0 });
});

describe('player physics', () => {
  it('spawns on the top deck and lands on it', async () => {
    const sim = await Simulation.create({ seaState: 0 });
    sim.addPlayer('a');
    run(sim, 1);
    const p = sim.state.players[0]!;
    expect(p.grounded).toBe(true);
    const deckTop = tileToLocal(sim.layout, 0, 13).y;
    expect(p.y + PLAYER_HALF_HEIGHT).toBeCloseTo(deckTop, 1);
  });

  it('slides noticeably when the ship lists, but can still walk uphill', async () => {
    const sim = await Simulation.create({ seaState: 0 });
    sim.addPlayer('a');
    run(sim, 0.5, () => ({}), [{ type: 'debugRoll', value: deg(15) }]);
    const x0 = sim.state.players[0]!.x;
    run(sim, 1);
    const slid = sim.state.players[0]!.x - x0;
    expect(slid).toBeGreaterThan(0.8); // ~1.8 m/s steady slide towards the low side
    expect(slid).toBeLessThan(3);

    const x1 = sim.state.players[0]!.x;
    run(sim, 1, () => ({ a: input({ left: true }) }));
    expect(sim.state.players[0]!.x).toBeLessThan(x1 - 1.2); // uphill still possible
  });

  it('jumps', async () => {
    const sim = await Simulation.create({ seaState: 0 });
    sim.addPlayer('a');
    run(sim, 0.6);
    const y0 = sim.state.players[0]!.y;
    let minY = y0;
    sim.step({ a: input({ jump: true }) });
    for (let i = 0; i < 40; i++) {
      sim.step({ a: input() });
      minY = Math.min(minY, sim.state.players[0]!.y);
    }
    expect(y0 - minY).toBeGreaterThan(0.9);
    expect(y0 - minY).toBeLessThan(1.6);
  });

  it('climbs down a ladder through an open hatch and back up', async () => {
    const sim = await Simulation.create({ seaState: 0 });
    sim.addPlayer('a');
    const ladder = sim.ladders.find((l) => l.hatchId !== null && sim.layout.hatches[l.hatchId]!.ty === 13 && l.x < 0)!;
    sim.teleportPlayer('a', ladder.x, ladder.top - PLAYER_HALF_HEIGHT - 0.05);
    run(sim, 0.3);
    expect(sim.state.players[0]!.grounded).toBe(true); // standing on the open hatch (one-way platform)
    run(sim, 2.5, () => ({ a: input({ down: true }) }));
    const p = sim.state.players[0]!;
    expect(p.y + PLAYER_HALF_HEIGHT).toBeCloseTo(ladder.bottom, 0);
    run(sim, 3, () => ({ a: input({ up: true }) }));
    const q = sim.state.players[0]!;
    expect(q.climbing).toBeNull();
    expect(q.y + PLAYER_HALF_HEIGHT).toBeLessThanOrEqual(ladder.top + 0.05);
  });

  it('falls through an open cargo hatch, but not through a closed one', async () => {
    const sim = await Simulation.create({ seaState: 0 });
    sim.addPlayer('a');
    const cargo = sim.layout.hatches.find((h) => !h.hasLadder)!;
    const c = tileToLocal(sim.layout, cargo.tx + cargo.width / 2, cargo.ty);
    sim.teleportPlayer('a', c.x, c.y - PLAYER_HALF_HEIGHT - 0.3);
    run(sim, 1);
    expect(sim.state.players[0]!.y).toBeGreaterThan(c.y + 1); // fell to the lower deck

    const sim2 = await Simulation.create({ seaState: 0 });
    sim2.addPlayer('a');
    sim2.teleportPlayer('a', c.x + 1.5, c.y - PLAYER_HALF_HEIGHT - 0.05);
    run(sim2, 0.3);
    // walk onto the hatch area while closed: close it first with E
    sim2.teleportPlayer('a', c.x + 1.0, c.y - PLAYER_HALF_HEIGHT - 0.05);
    run(sim2, 0.2);
    tap(sim2, 'a', 'interact');
    expect(sim2.state.hatches[cargo.id]!.open).toBe(false);
    run(sim2, 1, () => ({ a: input({ left: true }) }));
    expect(sim2.state.players[0]!.y).toBeLessThan(c.y);
  });

  it('carrying an object slows the player down', async () => {
    const sim = await Simulation.create({ seaState: 0 });
    sim.addPlayer('a');
    const crate = sim.state.objects.find((o) => o.kind === 'crate')!;
    sim.teleportPlayer('a', crate.x - 0.8, crate.y + 0.375 - PLAYER_HALF_HEIGHT - 0.02);
    run(sim, 0.4);
    tap(sim, 'a', 'pick');
    expect(sim.state.players[0]!.carrying).toBe(crate.id);
    run(sim, 1, () => ({ a: input({ left: true }) }));
    expect(Math.abs(sim.state.players[0]!.vx)).toBeCloseTo(DEFAULT_TUNING.player.walkSpeed * DEFAULT_TUNING.player.carrySpeedFactor, 1);
    tap(sim, 'a', 'pick');
    expect(sim.state.players[0]!.carrying).toBeNull();
    expect(sim.state.objects.find((o) => o.id === crate.id)!.carriedBy).toBeNull();
  });
});

describe('loose objects', () => {
  it('crates slide when the ship lists', async () => {
    const sim = await Simulation.create({ seaState: 0 });
    run(sim, 1);
    const before = sim.state.objects.filter((o) => o.kind === 'crate').map((o) => o.x);
    run(sim, 1.5, () => ({}), [{ type: 'debugRoll', value: deg(14) }]);
    const after = sim.state.objects.filter((o) => o.kind === 'crate').map((o) => o.x);
    const moved = after.map((x, i) => x - before[i]!);
    expect(Math.max(...moved)).toBeGreaterThan(0.5);
  });
});

describe('ship motion', () => {
  it('rolls within ±15° from waves alone and actually moves', async () => {
    const sim = await Simulation.create({ seaState: 1 });
    let max = 0;
    let min = 0;
    for (let i = 0; i < 60 * 60; i++) {
      sim.step({});
      max = Math.max(max, sim.state.ship.roll);
      min = Math.min(min, sim.state.ship.roll);
    }
    expect(max).toBeLessThanOrEqual(deg(15) + 1e-6);
    expect(min).toBeGreaterThanOrEqual(-deg(15) - 1e-6);
    expect(max - min).toBeGreaterThan(deg(8));
  });

  it('the steering wheel changes the course', async () => {
    const sim = await Simulation.create({ seaState: 0 });
    sim.addPlayer('a');
    const wheel = sim.state.stations.find((s) => s.kind === 'wheel')!;
    sim.teleportPlayer('a', wheel.x, wheel.y - PLAYER_HALF_HEIGHT - 0.02);
    run(sim, 0.3);
    tap(sim, 'a', 'interact');
    expect(sim.state.players[0]!.station).toBe(wheel.id);
    const h0 = sim.state.ship.heading;
    run(sim, 3, () => ({ a: input({ left: true }) }));
    expect(sim.state.ship.rudder).toBeLessThan(-0.9);
    expect(sim.state.ship.heading).toBeLessThan(h0 - 0.2);
    tap(sim, 'a', 'interact');
    expect(sim.state.players[0]!.station).toBeNull();
  });
});

describe('leak, pump and repair', () => {
  it('a leak lets water in, the pump removes it, a plank repairs it', async () => {
    const sim = await Simulation.create({ seaState: 0 });
    sim.addPlayer('a');
    run(sim, 0.5, () => ({}), [{ type: 'debugLeak', point: STERN_LEAK }]);
    expect(sim.state.leaks[0]!.active).toBe(true);
    const comp = sim.layout.leakPoints[STERN_LEAK]!.compartment;
    run(sim, 10);
    const v10 = sim.state.compartments[comp]!.volume;
    expect(v10).toBeGreaterThan(1);
    expect(sim.state.leaks[0]!.inflow).toBeGreaterThan(0.1);

    // pump: enter the station and alternate left/right
    const pump = sim.state.stations.find((s) => s.kind === 'pump')!;
    sim.teleportPlayer('a', pump.x, pump.y - PLAYER_HALF_HEIGHT - 0.02);
    run(sim, 0.3);
    tap(sim, 'a', 'interact');
    expect(sim.state.players[0]!.station).toBe(pump.id);
    const vBefore = sim.state.compartments[comp]!.volume;
    const leakIn = sim.state.leaks[0]!.inflow;
    for (let k = 0; k < 20; k++) {
      run(sim, 0.3, () => ({ a: input({ left: k % 2 === 0, right: k % 2 === 1 }) }));
    }
    const strokes = sim.state.stations[pump.id]!.aux;
    expect(strokes).toBeGreaterThanOrEqual(18);
    const vAfter = sim.state.compartments[comp]!.volume;
    // 6 s of pumping at ~3.3 strokes/s removes more water than the leak brings in
    expect(vAfter).toBeLessThan(vBefore);
    expect(vAfter).toBeLessThan(vBefore + leakIn * 6 - strokes * DEFAULT_TUNING.gameplay.pumpStroke * 0.9);
    tap(sim, 'a', 'interact');

    // get a plank from the workshop
    const ws = sim.state.stations.find((s) => s.kind === 'workshop')!;
    sim.teleportPlayer('a', ws.x, ws.y - PLAYER_HALF_HEIGHT - 0.02);
    run(sim, 0.3);
    tap(sim, 'a', 'pick');
    const plankId = sim.state.players[0]!.carrying;
    expect(plankId).not.toBeNull();
    expect(sim.state.objects.find((o) => o.id === plankId)!.kind).toBe('plank');

    // walk to the leak and repair it
    const lp = sim.leakInteriorPoint(STERN_LEAK);
    sim.teleportPlayer('a', lp.x - 0.3, lp.y);
    run(sim, 0.5);
    tap(sim, 'a', 'interact');
    expect(sim.state.players[0]!.action?.kind).toBe('repair');
    run(sim, DEFAULT_TUNING.player.repairTime + 0.2);
    expect(sim.state.leaks[0]!.active).toBe(false);
    expect(sim.state.players[0]!.carrying).toBeNull();
    expect(sim.state.objects.some((o) => o.id === plankId)).toBe(false);
    const vRepaired = sim.state.compartments[comp]!.volume;
    run(sim, 5);
    expect(sim.state.compartments[comp]!.volume).toBeLessThanOrEqual(vRepaired + 1e-9);
  });

  it('water in the hull increases the list towards the flooded side', async () => {
    const sim = await Simulation.create({ seaState: 0 });
    run(sim, 0.2, () => ({}), [{ type: 'debugLeak', point: STERN_LEAK }]);
    run(sim, 40);
    const leakX = sim.leakHullPoint(STERN_LEAK).x;
    const list = sim.state.ship.list;
    expect(Math.sign(list)).toBe(Math.sign(leakX));
    expect(Math.abs(list)).toBeGreaterThan(deg(2));
  });
});

describe('analog station input', () => {
  it('dragging the wheel to a target sets the rudder', async () => {
    const sim = await Simulation.create({ seaState: 0 });
    sim.addPlayer('a');
    const wheel = sim.state.stations.find((s) => s.kind === 'wheel')!;
    sim.teleportPlayer('a', wheel.x, wheel.y - PLAYER_HALF_HEIGHT - 0.02);
    run(sim, 0.3);
    tap(sim, 'a', 'interact');
    run(sim, 1.5, () => ({ a: input({ target: 0.6 }) }));
    expect(sim.state.ship.rudder).toBeCloseTo(0.6, 3);
    run(sim, 1.5, () => ({ a: input({ target: -2 }) }));
    expect(sim.state.ship.rudder).toBeCloseTo(-1, 3);
  });

  it('swinging the pump lever by target pumps water', async () => {
    const sim = await Simulation.create({ seaState: 0 });
    sim.addPlayer('a');
    const pump = sim.state.stations.find((s) => s.kind === 'pump')!;
    sim.step({}, SIM_DT, [{ type: 'debugWater', compartment: 1, volume: 10 }]);
    sim.teleportPlayer('a', pump.x, pump.y - PLAYER_HALF_HEIGHT - 0.02);
    run(sim, 0.3);
    tap(sim, 'a', 'interact');
    const v0 = sim.state.compartments[1]!.volume;
    for (let k = 0; k < 10; k++) run(sim, 0.3, () => ({ a: input({ target: k % 2 ? 1 : -1 }) }));
    expect(sim.state.stations[pump.id]!.aux).toBeGreaterThanOrEqual(9);
    expect(sim.state.compartments[1]!.volume).toBeLessThan(v0 - 1.2);
  });

  it('the searchlight turns towards a target angle along the shortest arc', async () => {
    const sim = await Simulation.create({ seaState: 0 });
    sim.addPlayer('a');
    const sl = sim.state.stations.find((s) => s.kind === 'searchlight')!;
    sim.teleportPlayer('a', sl.x, sl.y - PLAYER_HALF_HEIGHT - 0.02);
    run(sim, 0.3);
    tap(sim, 'a', 'interact');
    run(sim, 3, () => ({ a: input({ target: Math.PI - 0.2 }) }));
    expect(Math.abs(sim.state.stations[sl.id]!.value - (Math.PI - 0.2))).toBeLessThan(0.01);
  });
});

describe('tuning', () => {
  it('a tune command changes gameplay live (walk speed)', async () => {
    const sim = await Simulation.create({ seaState: 0 });
    sim.addPlayer('a');
    run(sim, 0.5);
    run(sim, 1, () => ({ a: input({ right: true }) }));
    expect(sim.state.players[0]!.vx).toBeCloseTo(DEFAULT_TUNING.player.walkSpeed, 1);
    sim.step({}, SIM_DT, [{ type: 'tune', patch: { player: { walkSpeed: 2 } } }]);
    run(sim, 1, () => ({ a: input({ left: true }) }));
    expect(sim.state.players[0]!.vx).toBeCloseTo(-2, 1);
    // the defaults themselves are untouched
    expect(DEFAULT_TUNING.player.walkSpeed).not.toBe(2);
  });

  it('options.tuning overrides defaults per simulation', async () => {
    const sim = await Simulation.create({ seaState: 0, tuning: { gameplay: { gravity: 10 } } });
    expect(sim.tuning.gameplay.gravity).toBe(10);
    run(sim, 0.2);
    expect(Math.hypot(sim.state.ship.gravity.x, sim.state.ship.gravity.y)).toBeCloseTo(10, 0);
  });
});

describe('sinking', () => {
  it('a flooded hull sinks the ship and the game restarts after a few seconds', async () => {
    const sim = await Simulation.create({ seaState: 0 });
    sim.addPlayer('a');
    const { capacity } = sim.waterTotals();
    sim.step({}, SIM_DT, [
      { type: 'debugWater', compartment: 0, volume: capacity },
      { type: 'debugWater', compartment: 1, volume: capacity },
    ]);
    sim.step({});
    expect(sim.state.status).toBe('sunk');
    run(sim, DEFAULT_TUNING.gameplay.sunkResetTime + 0.2);
    expect(sim.state.status).toBe('sailing');
    expect(sim.waterTotals().volume).toBe(0);
    expect(sim.state.players.map((p) => p.id)).toEqual(['a']);
  });
});

describe('determinism', () => {
  it('two simulations with identical inputs produce identical states', async () => {
    const a = await Simulation.create({ seaState: 1, seed: 7 });
    const b = await Simulation.create({ seaState: 1, seed: 7 });
    for (const s of [a, b]) {
      s.addPlayer('p1');
      s.addPlayer('p2');
    }
    const script = (t: number) => ({
      p1: input({ right: Math.sin(t) > 0, left: Math.sin(t) < -0.5, jump: Math.floor(t * 3) % 7 === 0 }),
      p2: input({ left: true, jump: Math.floor(t * 2) % 5 === 0 }),
    });
    run(a, 8, script, [{ type: 'debugLeak' }]);
    run(b, 8, script, [{ type: 'debugLeak' }]);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });
});

describe('reset', () => {
  it('reset command restores the initial ship but keeps players', () => {
    calmSim.addPlayer('x');
    run(calmSim, 1, () => ({}), [{ type: 'debugLeak' }]);
    calmSim.step({}, SIM_DT, [{ type: 'reset' }]);
    expect(calmSim.state.leaks).toHaveLength(0);
    expect(calmSim.state.players.map((p) => p.id)).toEqual(['x']);
    expect(calmSim.state.events.some((e) => e.type === 'reset')).toBe(true);
  });
});
