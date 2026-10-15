import { describe, expect, it } from 'vitest';
import { EMPTY_INPUT, Simulation, decodeState, encodeState, packSnapshot, unpackSnapshot, type GameState, type PlayerInput } from '../src';

const input = (over: Partial<PlayerInput> = {}): PlayerInput => ({ ...EMPTY_INPUT, ...over });

/** Compares every value; numbers may differ by the quantisation step. */
function expectSame(a: unknown, b: unknown, path = 'state'): void {
  if (typeof a === 'number') {
    expect(typeof b, path).toBe('number');
    const tol = Math.max(3e-3, Math.abs(a) * 1e-6);
    if (Math.abs(a - (b as number)) > tol) throw new Error(`${path}: ${a} != ${String(b)}`);
    return;
  }
  if (a === null || typeof a !== 'object') {
    expect(b, path).toEqual(a);
    return;
  }
  expect(b !== null && typeof b === 'object', path).toBe(true);
  if (Array.isArray(a)) {
    expect((b as unknown[]).length, path).toBe(a.length);
    a.forEach((v, i) => expectSame(v, (b as unknown[])[i], `${path}[${i}]`));
    return;
  }
  const keysA = Object.keys(a).sort();
  expect(Object.keys(b as object).sort(), path).toEqual(keysA);
  for (const k of keysA) expectSame((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
}

/** A busy state: players doing things, carried objects, leaks, rocks, kraken, balls, pings. */
async function busyState(): Promise<GameState> {
  const sim = await Simulation.create({ seaState: 0.9 });
  sim.addPlayer('Kx9_aB3dE', { name: 'GRÖSSE', color: 2 });
  sim.addPlayer('p2', { name: 'BEN' });
  for (let t = 0; t < 200; t++) sim.step({ Kx9_aB3dE: input({ right: t % 80 < 40, jump: t % 50 === 3 }), p2: input({ left: true, pick: t === 60 }) });
  sim.step({}, undefined, [{ type: 'debugLeak' }, { type: 'debugRoll', value: 0.1 }, { type: 'ping', player: 'p2', x: 3, y: -1 }]);
  sim.state.voyage.nextMonsterX = sim.state.ship.x;
  sim.state.voyage.nextRockX = sim.state.ship.x + 30;
  for (let t = 0; t < 60; t++) sim.step({});
  sim.state.balls.push({ id: 99, x: sim.state.ship.x + 10, y: -3, vx: 20, vy: -4, age: 0.3 });
  sim.state.players[0]!.bubble = { key: 'monster', time: 2 };
  sim.state.players[0]!.action = { kind: 'repair', target: 0, progress: 0.5 };
  expect(sim.state.monster).not.toBeNull();
  expect(sim.state.rocks.length).toBeGreaterThan(0);
  expect(sim.state.pings.length).toBe(1);
  return sim.state;
}

describe('snapshot codec', () => {
  it('round-trips every field of the game state', async () => {
    const state = await busyState();
    const plain = JSON.parse(JSON.stringify({ ...state, events: [] })) as GameState;
    expectSame(plain, decodeState(encodeState(state)));
  });

  it('is much smaller than JSON', async () => {
    const state = await busyState();
    const bytes = encodeState(state).length;
    const json = JSON.stringify({ ...state, events: [] }).length;
    expect(bytes).toBeLessThan(json / 4);
  });

  it('packs whole snapshots and survives a byte offset (Node Buffers)', async () => {
    const state = await busyState();
    const wire = packSnapshot({ state, acks: { p2: 5 }, events: [{ type: 'arrived' }], host: 'p2' });
    const shifted = new Uint8Array(wire.s.length + 7);
    shifted.set(wire.s, 7);
    const back = unpackSnapshot({ ...wire, s: shifted.subarray(7) });
    expect(back.acks).toEqual({ p2: 5 });
    expect(back.state.players.map((p) => p.name)).toEqual(['GRÖSSE', 'BEN']);
  });
});
