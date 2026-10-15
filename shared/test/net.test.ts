import { describe, expect, it } from 'vitest';
import {
  EMPTY_INPUT,
  Predictor,
  ShipHost,
  SIM_DT,
  Simulation,
  decodeInputs,
  encodeInputs,
  inputBits,
  inputFromBits,
  isRoomCode,
  makeRoomCode,
  normalizeRoomCode,
  parseCommand,
  sanitizeName,
  type GameState,
  type PlayerInput,
  type SnapshotMessage,
} from '../src';

const input = (over: Partial<PlayerInput> = {}): PlayerInput => ({ ...EMPTY_INPUT, ...over });
/** What travelling over the network does to a value (no shared references). */
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('protocol', () => {
  it('packs inputs into bits and back', () => {
    const i = input({ left: true, jump: true, pick: true, target: 0.5 });
    expect(inputFromBits(inputBits(i), 0.5)).toEqual(i);
    const msg = encodeInputs(41, [i, input({ right: true })]);
    const back = decodeInputs(wire(msg));
    expect(back.map((f) => f.seq)).toEqual([41, 42]);
    expect(back[0]!.input).toEqual(i);
    expect(back[1]!.input.right).toBe(true);
    expect(back[1]!.input.target).toBeNull();
  });

  it('rejects malformed input messages', () => {
    expect(decodeInputs('nope')).toEqual([]);
    expect(decodeInputs([-1, 0, null])).toEqual([]);
    expect(decodeInputs([0, 999, null])).toEqual([]);
    expect(decodeInputs([0, 1, 'x'])[0]!.input.target).toBeNull();
    expect(decodeInputs([0, 1, 1e9])[0]!.input.target).toBeNull();
  });

  it('cleans names and room codes', () => {
    expect(sanitizeName('  Erik <script>  ')).toBe('ERIK SCRIP');
    expect(sanitizeName('Größenwahn123')).toBe('GRÖSSENWAH');
    expect(sanitizeName(42)).toBe('');
    let n = 0;
    const code = makeRoomCode(() => ((n++ * 0.37) % 1));
    expect(isRoomCode(code)).toBe(true);
    expect(normalizeRoomCode(' ab-c d9 ')).toBe('ABCD');
    expect(isRoomCode('ABIO')).toBe(false);
  });

  it('validates commands', () => {
    expect(parseCommand({ type: 'debugLeak' })).toEqual({ type: 'debugLeak' });
    expect(parseCommand({ type: 'seaState', value: 'x' })).toBeNull();
    expect(parseCommand({ type: 'rm -rf' })).toBeNull();
    expect(parseCommand(null)).toBeNull();
    expect(parseCommand({ type: 'debugRoll', value: null })).toEqual({ type: 'debugRoll', value: null });
  });
});

describe('Simulation.loadState', () => {
  it('continues exactly like the original after loading its state', async () => {
    const a = await Simulation.create({ seaState: 0.8 });
    a.addPlayer('p1');
    a.addPlayer('p2');
    const script = (t: number) => ({
      p1: input({ right: t % 90 < 50, jump: t % 70 === 10 }),
      p2: input({ left: t % 80 < 30, pick: t === 40 }),
    });
    for (let t = 0; t < 240; t++) a.step(script(t));

    // a different simulation (other players, objects moved) takes over the state
    const b = await Simulation.create({ seaState: 0.2 });
    b.addPlayer('zz');
    for (let t = 0; t < 30; t++) b.step({ zz: input({ right: true }) });
    b.loadState(wire(a.state));
    expect(b.state.players.map((p) => p.id)).toEqual(['p1', 'p2']);

    for (let t = 240; t < 420; t++) {
      a.step(script(t));
      b.step(script(t));
    }
    for (const pa of a.state.players) {
      const pb = b.state.players.find((p) => p.id === pa.id)!;
      expect(Math.abs(pa.x - pb.x)).toBeLessThan(0.05);
      expect(Math.abs(pa.y - pb.y)).toBeLessThan(0.05);
      expect(pb.carrying).toBe(pa.carrying);
    }
    for (const oa of a.state.objects) {
      const ob = b.state.objects.find((o) => o.id === oa.id)!;
      expect(Math.hypot(oa.x - ob.x, oa.y - ob.y)).toBeLessThan(0.1);
    }
    expect(b.state.ship.roll).toBeCloseTo(a.state.ship.roll, 4);
    expect(b.state.tick).toBe(a.state.tick);
  });

  it('restores closed hatches and carried objects', async () => {
    const a = await Simulation.create({ seaState: 0 });
    a.addPlayer('p1');
    a.state.hatches[0]!.open = false;
    const b = await Simulation.create({ seaState: 0 });
    b.loadState(wire(a.state));
    expect(b.state.hatches[0]!.open).toBe(false);
    b.step({});
    expect(b.state.players).toHaveLength(1);
  });
});

/** A client and the server, connected through queues with a fixed delay in ticks. */
async function network(delayTicks: number, sendEvery = 1) {
  const server = new ShipHost(await Simulation.create({ seaState: 0.6 }));
  server.join('me', { name: 'ICH' });
  server.join('other', { name: 'DU' });
  const client = new Predictor(await Simulation.create({ seaState: 0.6 }), 'me');
  const up: { at: number; msg: unknown }[] = [];
  const down: { at: number; msg: SnapshotMessage }[] = [];
  let tick = 0;
  let otherInput = input();
  // own player's x per simulation tick, as the server and the client saw it
  const serverX = new Map<number, number>();
  const clientX = new Map<number, number>();
  const step = (mine: PlayerInput) => {
    tick++;
    // server side
    while (up.length && up[0]!.at <= tick) server.receiveInputs('me', decodeInputs(up.shift()!.msg));
    server.receiveInputs('other', [{ seq: tick, input: otherInput }]);
    server.tick(SIM_DT);
    serverX.set(server.sim.state.tick, server.sim.state.players.find((p) => p.id === 'me')!.x);
    if (tick % 3 === 0) down.push({ at: tick + delayTicks, msg: wire(server.snapshot('me')) });
    // client side
    while (down.length && down[0]!.at <= tick) client.receive(down.shift()!.msg);
    client.reconcile();
    if (client.synced) {
      client.predict(mine);
      clientX.set(client.sim.state.tick, client.sim.state.players.find((p) => p.id === 'me')!.x);
      // a slow or bursty client sends several inputs at once
      const out = tick % sendEvery === 0 ? client.takeOutgoing() : null;
      if (out) up.push({ at: tick + delayTicks, msg: out });
    }
  };
  return {
    server,
    client,
    step,
    serverX,
    clientX,
    setOther: (i: PlayerInput) => (otherInput = i),
    me: (s: GameState) => s.players.find((p) => p.id === 'me')!,
  };
}

describe('prediction and reconciliation', () => {
  it('moves the own player immediately and converges with the server', async () => {
    const net = await network(6); // ~100 ms each way
    for (let i = 0; i < 90; i++) net.step(input()); // settle on deck, first snapshots
    expect(net.client.synced).toBe(true);
    const x0 = net.me(net.client.sim.state).x;
    // pressing right moves the predicted player within a few ticks, long before the server knows
    for (let i = 0; i < 6; i++) net.step(input({ right: true }));
    const predicted = net.me(net.client.sim.state).x;
    expect(predicted - x0).toBeGreaterThan(0.1);
    expect(Math.abs(net.me(net.server.sim.state).x - x0)).toBeLessThan(0.02);
    for (let i = 0; i < 40; i++) net.step(input({ right: i < 30 }));
    for (let i = 0; i < 60; i++) net.step(input());
    // the prediction for a tick matches what the server computed for that tick
    const t = net.server.sim.state.tick - 1;
    expect(net.clientX.has(t)).toBe(true);
    expect(Math.abs(net.clientX.get(t)! - net.serverX.get(t)!)).toBeLessThan(0.02);
    // the client runs ahead of the server by about the round trip
    expect(net.client.stats.pending).toBeGreaterThanOrEqual(10);
    expect(net.client.stats.pending).toBeLessThanOrEqual(16);
  });

  it('stays in sync with a bursty client (inputs arrive three at a time)', async () => {
    const net = await network(3, 3);
    for (let i = 0; i < 90; i++) net.step(input());
    let mismatches = 0;
    let compared = 0;
    for (let i = 0; i < 240; i++) {
      net.step(input({ right: Math.floor(i / 50) % 2 === 0, left: Math.floor(i / 50) % 2 === 1 }));
      const t = net.server.sim.state.tick;
      if (net.clientX.has(t)) {
        compared++;
        if (Math.abs(net.clientX.get(t)! - net.serverX.get(t)!) > 0.01) mismatches++;
      }
    }
    expect(compared).toBeGreaterThan(200);
    // the jitter buffer absorbs the bursts: prediction and server agree almost always
    expect(mismatches / compared).toBeLessThan(0.05);
  });

  it('reports only the local player events from prediction', async () => {
    const net = await network(4);
    for (let i = 0; i < 90; i++) net.step(input());
    const events = net.client.predict(input({ jump: true }));
    expect(events.some((e) => e.type === 'jump' && e.player === 'me')).toBe(true);
    // the other player's jump arrives through the server's events
    net.setOther(input({ jump: true }));
    let seen = false;
    for (let i = 0; i < 30 && !seen; i++) {
      net.step(input());
      net.setOther(input());
    }
    const snap = net.server.snapshot('me');
    net.client.receive(wire(snap));
    seen = (net.client.reconcile() ?? []).every((e) => !('player' in e) || e.player !== 'me');
    expect(seen).toBe(true);
  });

  it('the server keeps one input per tick and stops idle players', async () => {
    const host = new ShipHost(await Simulation.create({ seaState: 0 }));
    host.join('a');
    host.receiveInputs('a', decodeInputs(encodeInputs(0, [input({ right: true }), input({ right: true })])));
    // a duplicate resend is ignored
    host.receiveInputs('a', decodeInputs(encodeInputs(1, [input({ right: true })])));
    expect(host.queued('a')).toBe(2);
    host.tick();
    host.tick();
    expect(host.snapshot('a').acks.a).toBe(1);
    // after running dry, a single late input waits for the jitter buffer (2) before it is used
    host.tick();
    host.receiveInputs('a', decodeInputs(encodeInputs(2, [input({ right: true })])));
    host.tick();
    expect(host.snapshot('a').acks.a).toBe(1);
    host.receiveInputs('a', decodeInputs(encodeInputs(3, [input({ right: true })])));
    host.tick();
    expect(host.snapshot('a').acks.a).toBe(2);
    // the last input is repeated for a moment, then the player stops
    for (let i = 0; i < 40; i++) host.tick();
    const p = host.sim.state.players[0]!;
    expect(p.prevInput.right).toBe(false);
  });
});
