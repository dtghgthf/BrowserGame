import { describe, expect, it } from 'vitest';
import {
  EMPTY_INPUT,
  PLAYER_HALF_HEIGHT,
  SIM_DT,
  Simulation,
  type GameEvent,
  type PlayerInput,
  type SimCommand,
  type TuningPatch,
} from '../src';

const deg = (d: number) => (d * Math.PI) / 180;
const input = (over: Partial<PlayerInput> = {}): PlayerInput => ({ ...EMPTY_INPUT, ...over });

function run(sim: Simulation, seconds: number, inp: () => Record<string, PlayerInput> = () => ({}), cmds: SimCommand[] = []): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    sim.step(inp(), SIM_DT, i === 0 ? cmds : []);
    events.push(...sim.state.events);
  }
  return events;
}

function tap(sim: Simulation, id: string, key: keyof PlayerInput): void {
  sim.step({ [id]: input({ [key]: true }) });
  sim.step({ [id]: input() });
}

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

const cargo = (sim: Simulation) => sim.state.objects.filter((o) => o.kind === 'crate' || o.kind === 'barrel');

describe('cargo', () => {
  it('starts lashed down and stays put while the ship heels a little', async () => {
    const sim = await calm();
    run(sim, 0.5);
    expect(cargo(sim).length).toBeGreaterThan(0);
    expect(cargo(sim).every((o) => o.lashed)).toBe(true);
    const before = cargo(sim).map((o) => o.x);
    run(sim, 2, () => ({}), [{ type: 'debugRoll', value: deg(10) }]);
    expect(cargo(sim).map((o) => o.x)).toEqual(before);
  });

  it('lashings snap in a hard heel, loose cargo slides and adds to the list', async () => {
    const sim = await calm({ gameplay: { cargoBreakRate: 5 } });
    sim.addPlayer('a');
    run(sim, 0.5);
    const events = run(sim, 3, () => ({}), [{ type: 'debugRoll', value: deg(24) }]);
    expect(events.some((e) => e.type === 'cargoLoose')).toBe(true);
    expect(cargo(sim).some((o) => !o.lashed)).toBe(true);
    // the cargo slid towards the low side; with the roll free again the ship lists that way
    sim.step({}, SIM_DT, [{ type: 'debugRoll', value: null }]);
    const shifted = cargo(sim).filter((o) => !o.lashed && o.spawn).reduce((m, o) => m + (o.x - o.spawn!.x), 0);
    expect(Math.abs(shifted)).toBeGreaterThan(1);
    run(sim, 0.2);
    expect(Math.sign(sim.state.ship.list)).toBe(Math.sign(shifted));
    expect(Math.abs(sim.state.ship.list)).toBeGreaterThan(deg(0.5));
  });

  it('a loose crate is lashed again next to a cargo place (E), picking it up unties it', async () => {
    const sim = await calm();
    sim.addPlayer('a');
    run(sim, 0.5);
    const crate = sim.state.objects.find((o) => o.kind === 'crate')!;
    sim.setLashed(crate, false);
    stand(sim, 'a', crate.x - 0.6, crate.y + 0.3);
    expect(sim.interactionHints('a').interact?.label).toBe('Festzurren');
    tap(sim, 'a', 'interact');
    expect(sim.state.players[0]!.action?.kind).toBe('lash');
    const events = run(sim, sim.actionDuration('lash') + 0.2);
    expect(events.some((e) => e.type === 'lashed')).toBe(true);
    expect(crate.lashed).toBe(true);
    // lashed: E opens it in place, F unties it and picks it up
    expect(sim.interactionHints('a').interact?.label).toBe('Kiste öffnen');
    tap(sim, 'a', 'pick');
    expect(crate.carriedBy).toBe('a');
    expect(crate.lashed).toBe(false);
  });

  it('survives a state round trip (prediction rebuilds lashed bodies as fixed)', async () => {
    const sim = await calm();
    run(sim, 0.5);
    const loose = cargo(sim)[0]!;
    sim.setLashed(loose, false);
    const copy = await calm();
    copy.loadState(structuredClone(sim.state));
    run(sim, 1, () => ({}), [{ type: 'debugRoll', value: deg(12) }]);
    run(copy, 1, () => ({}), [{ type: 'debugRoll', value: deg(12) }]);
    expect(copy.state.objects.map((o) => [o.lashed, o.x.toFixed(3)])).toEqual(sim.state.objects.map((o) => [o.lashed, o.x.toFixed(3)]));
  });
});

describe('wheel helper', () => {
  it('a second player lends a hand at the wheel and halves the whirlpool pull', async () => {
    const drift = async (helper: boolean, whirl = true) => {
      const sim = await calm({ gameplay: { whirlPull: 3 } });
      sim.addPlayer('a');
      sim.addPlayer('b');
      run(sim, 0.3);
      const wheel = sim.state.stations.find((s) => s.kind === 'wheel')!;
      stand(sim, 'a', wheel.x, wheel.y);
      tap(sim, 'a', 'interact');
      expect(wheel.occupant).toBe('a');
      if (helper) {
        stand(sim, 'b', wheel.x - 0.5, wheel.y);
        expect(sim.interactionHints('b').interact?.label).toBe('Mit anpacken');
        tap(sim, 'b', 'interact');
        expect(wheel.helper).toBe('b');
        expect(sim.state.players[1]!.station).toBe(wheel.id);
      }
      if (whirl) sim.state.whirl = { x: sim.state.ship.x + 8, lateral: sim.state.ship.lateral + 10, radius: 12, spotted: false, hit: false };
      const lat0 = sim.state.ship.lateral;
      run(sim, 1);
      return { d: sim.state.ship.lateral - lat0, sim, wheel };
    };
    const base = (await drift(false, false)).d;
    const alone = (await drift(false)).d - base;
    const two = await drift(true);
    expect(alone).toBeGreaterThan(0.5);
    expect(two.d - base).toBeLessThan(alone * 0.6);
    // the helmsman leaves: the helper takes over
    tap(two.sim, 'a', 'interact');
    expect(two.wheel.occupant).toBe('b');
    expect(two.wheel.helper).toBeNull();
  });
});

describe('pump wear', () => {
  it('pumping nonstop heats the pump and weakens the strokes; a rest cools it', async () => {
    const sim = await calm();
    sim.addPlayer('a');
    run(sim, 0.3);
    sim.step({}, SIM_DT, [{ type: 'debugWater', compartment: 1, volume: 40 }]);
    const pump = sim.state.stations.find((s) => s.kind === 'pump')!;
    stand(sim, 'a', pump.x, pump.y);
    tap(sim, 'a', 'interact');
    const events: GameEvent[] = [];
    for (let k = 0; k < 200 && pump.charge <= sim.tuning.gameplay.pumpHotAt + 0.1; k++) {
      events.push(...run(sim, 0.26, () => ({ a: input({ left: k % 2 === 0, right: k % 2 === 1 }) })));
    }
    expect(pump.charge).toBeGreaterThan(sim.tuning.gameplay.pumpHotAt);
    expect(events.some((e) => e.type === 'pumpHot')).toBe(true);
    const hot = events.filter((e) => e.type === 'pumpStroke');
    // a hot stroke moves less water
    const strokes: number[] = [];
    for (let k = 0; k < 2; k++) {
      for (const e of run(sim, 0.26, () => ({ a: input({ left: k % 2 === 0, right: k % 2 === 1 }) }))) if (e.type === 'pumpStroke') strokes.push(e.volume);
    }
    expect(hot.length).toBeGreaterThan(10);
    expect(strokes[0]!).toBeLessThan(sim.tuning.gameplay.pumpStroke * 0.6);
    run(sim, 8);
    expect(pump.charge).toBeLessThan(sim.tuning.gameplay.pumpHotAt);
  });
});
