import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { DEFAULT_SERVER_PORT, ROOM_NAME } from '@lw/shared';
import { ShipRoom } from './ShipRoom';

/** Starts the game server. PORT and HOST come from the environment (hosting providers set PORT). */
export async function startServer(port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT), host = process.env.HOST ?? '0.0.0.0'): Promise<Server> {
  const server = new Server({
    transport: new WebSocketTransport({ pingInterval: 5000, pingMaxRetries: 3 }),
    greet: false,
  });
  server.define(ROOM_NAME, ShipRoom);
  await server.listen(port, host);
  console.log(`[leuchtturm] server listening on ${host}:${port}`);
  return server;
}
