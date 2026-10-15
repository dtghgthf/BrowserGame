import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import type { Server } from '@colyseus/core';
import {
  EMPTY_INPUT,
  MSG,
  PROTOCOL_VERSION,
  ROOM_NAME,
  encodeInputs,
  type SnapshotMessage,
  type TuningPatch,
  type WelcomeMessage,
} from '@lw/shared';
import { startServer } from '../src/server';

const PORT = 25670 + Math.floor(Math.random() * 200);
let server: Server;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  server = await startServer(PORT, '127.0.0.1');
});
afterAll(async () => {
  await server.gracefullyShutdown(false);
});

interface Peer {
  room: Room;
  welcome: WelcomeMessage | null;
  last: SnapshotMessage | null;
  snapshots: number;
  tuning: TuningPatch[];
}

function watch(room: Room): Peer {
  const peer: Peer = { room, welcome: null, last: null, snapshots: 0, tuning: [] };
  room.onMessage(MSG.welcome, (m: WelcomeMessage) => (peer.welcome = m));
  room.onMessage(MSG.snapshot, (m: SnapshotMessage) => {
    peer.last = m;
    peer.snapshots++;
  });
  room.onMessage(MSG.tuning, (m: TuningPatch) => peer.tuning.push(m));
  return peer;
}

async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout');
    await sleep(20);
  }
}

describe('ShipRoom', () => {
  it('creates a room with a code, lets a second player join and syncs inputs', async () => {
    const client = new Client(`ws://127.0.0.1:${PORT}`);
    const a = watch(await client.create(ROOM_NAME, { name: 'Anna', color: 2, protocol: PROTOCOL_VERSION }));
    await until(() => !!a.welcome && !!a.last);
    const code = a.welcome!.code;
    expect(code).toMatch(/^[A-Z]{4}$/);
    expect(a.room.roomId).toBe(code);
    expect(a.last!.state.players[0]!.name).toBe('ANNA');
    expect(a.last!.state.players[0]!.color).toBe(2);

    const b = watch(await client.joinById(code, { name: 'Ben', color: 2, protocol: PROTOCOL_VERSION }));
    await until(() => (b.last?.state.players.length ?? 0) === 2);
    const ben = b.last!.state.players.find((p) => p.id === b.room.sessionId)!;
    expect(ben.name).toBe('BEN');
    expect(ben.color).not.toBe(2); // colour already taken

    // Anna walks right for half a second; Ben sees it
    await sleep(800); // land on deck
    const x0 = b.last!.state.players.find((p) => p.id === a.room.sessionId)!.x;
    for (let seq = 0; seq < 30; seq++) {
      a.room.send(MSG.input, encodeInputs(seq, [{ ...EMPTY_INPUT, right: true }]));
      await sleep(16);
    }
    await sleep(300);
    const anna = b.last!.state.players.find((p) => p.id === a.room.sessionId)!;
    expect(anna.x - x0).toBeGreaterThan(1);
    expect(b.last!.acks[a.room.sessionId]).toBe(29);
    expect(b.snapshots).toBeGreaterThan(10);

    // only the host may send debug / tuning commands; tuning reaches everybody
    b.room.send(MSG.command, { type: 'debugLeak' });
    await sleep(150);
    expect(b.last!.state.leaks).toHaveLength(0);
    a.room.send(MSG.command, { type: 'tune', patch: { player: { walkSpeed: 7 } } });
    a.room.send(MSG.command, { type: 'debugLeak' });
    await until(() => b.tuning.length === 1 && (b.last?.state.leaks.length ?? 0) === 1);
    expect(b.tuning[0]).toEqual({ player: { walkSpeed: 7 } });

    // leaving removes the player
    await b.room.leave(true);
    await until(() => a.last!.state.players.length === 1);
    await a.room.leave(true);
  });

  it('keeps a dropped player and lets them reconnect (automatically or with the token after a reload)', async () => {
    const client = new Client(`ws://127.0.0.1:${PORT}`);
    const a = watch(await client.create(ROOM_NAME, { name: 'A', color: 0, protocol: PROTOCOL_VERSION }));
    const b = watch(await client.joinById(a.room.roomId, { name: 'B', color: 1, protocol: PROTOCOL_VERSION }));
    await sleep(5300); // the SDK only auto-reconnects connections that were up for 5 s
    const kill = (r: Room) => (r.connection.transport as unknown as { ws: { close(code: number): void } }).ws.close(4010);

    // 1) network drop: the SDK reconnects on its own
    let reconnected = false;
    b.room.onReconnect(() => (reconnected = true));
    kill(b.room);
    await until(() => a.last!.state.players.find((p) => p.id === b.room.sessionId)?.away === true);
    await until(() => reconnected, 8000);
    await until(() => a.last!.state.players.find((p) => p.id === b.room.sessionId)?.away === false);

    // 2) page reload: a new client continues the same seat with the reconnection token
    const token = b.room.reconnectionToken;
    const id = b.room.sessionId;
    b.room.reconnection.enabled = false;
    kill(b.room);
    await until(() => a.last!.state.players.find((p) => p.id === id)?.away === true);
    const again = watch(await new Client(`ws://127.0.0.1:${PORT}`).reconnect(token));
    expect(again.room.sessionId).toBe(id);
    await until(() => !!again.welcome && a.last!.state.players.find((p) => p.id === id)?.away === false);
    expect(a.last!.state.players).toHaveLength(2);
    await again.room.leave(true);
    await a.room.leave(true);
  }, 30000);

  it('rejects clients with another protocol version and unknown codes', async () => {
    const client = new Client(`ws://127.0.0.1:${PORT}`);
    await expect(client.create(ROOM_NAME, { name: 'x', color: 0, protocol: 999 })).rejects.toThrow();
    await expect(client.joinById('ZZZZ', { name: 'x', color: 0, protocol: PROTOCOL_VERSION })).rejects.toThrow();
  });
});
