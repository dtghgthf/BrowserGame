import { Room, ServerError, type Client } from '@colyseus/core';
import {
  DEFAULT_TUNING,
  FixedStepper,
  MAX_PLAYERS,
  MSG,
  PROTOCOL_VERSION,
  RECONNECT_SECONDS,
  SIM_DT,
  SNAPSHOT_EVERY,
  ShipHost,
  Simulation,
  decodeInputs,
  diffTuning,
  makeRoomCode,
  packSnapshot,
  parseCommand,
  sanitizeName,
  type JoinOptions,
  type WelcomeMessage,
} from '@lw/shared';

/** Room codes in use by this process (one server process holds all rooms). */
const activeCodes = new Set<string>();

function uniqueCode(): string {
  for (let i = 0; i < 1000; i++) {
    const code = makeRoomCode(Math.random);
    if (!activeCodes.has(code)) return code;
  }
  throw new Error('no free room code');
}

/**
 * One ship = one room. Runs the authoritative Simulation at 60 Hz and sends a
 * snapshot to everybody 20 times per second. No Colyseus schema state: the game
 * state is already plain data, so it travels as a regular (msgpack) message.
 */
export class ShipRoom extends Room {
  override maxClients = MAX_PLAYERS;
  private host!: ShipHost;
  private readonly stepper = new FixedStepper(SIM_DT);
  private hostId = '';
  private ticks = 0;
  private lastUpdate = performance.now();
  private readonly lastPing = new Map<string, number>();

  override async onCreate(options: Partial<JoinOptions> & { seaState?: number }): Promise<void> {
    const code = uniqueCode();
    activeCodes.add(code);
    this.roomId = code;
    this.setPatchRate(null);
    await this.setPrivate(true); // joined by code only, never by quick matchmaking
    const sim = await Simulation.create({
      seed: Math.floor(Math.random() * 2 ** 31),
      seaState: typeof options?.seaState === 'number' && Number.isFinite(options.seaState) ? options.seaState : undefined,
    });
    this.host = new ShipHost(sim);

    this.onMessage(MSG.input, (client, msg: unknown) => this.host.receiveInputs(client.sessionId, decodeInputs(msg)));
    this.onMessage(MSG.command, (client, raw: unknown) => {
      const c = parseCommand(raw);
      if (!c) return;
      if (c.type === 'ping') {
        // everybody may ping, a few times per second at most
        const now = Date.now();
        if (now - (this.lastPing.get(client.sessionId) ?? 0) < 250) return;
        this.lastPing.set(client.sessionId, now);
        this.host.command({ ...c, player: client.sessionId });
        return;
      }
      // debug keys and the tuning panel are reserved for the player who opened the room
      if (client.sessionId !== this.hostId) return;
      this.host.command(c);
      if (c.type === 'tune') {
        // apply right away, so the patch everybody receives is exactly the server's numbers
        this.broadcast(MSG.tuning, c.patch);
      }
    });
    // own wall-clock measurement: the delta Colyseus passes in is not reliable
    // (its room clock is also ticked elsewhere), the stepper needs real time
    this.lastUpdate = performance.now();
    this.setSimulationInterval(() => this.update(), 1000 / 60);
  }

  override onAuth(_client: Client, options: Partial<JoinOptions>): boolean {
    if (options?.protocol !== PROTOCOL_VERSION) throw new ServerError(4001, 'Version passt nicht - bitte Seite neu laden.');
    return true;
  }

  override onJoin(client: Client, options: Partial<JoinOptions>): void {
    const name = sanitizeName(options?.name) || `MATROSE ${this.clients.length}`;
    this.host.join(client.sessionId, { name, color: typeof options?.color === 'number' ? options.color : undefined });
    if (!this.hostId) this.hostId = client.sessionId;
    this.welcome(client);
  }

  override onDrop(client: Client): void {
    this.host.setAway(client.sessionId, true);
    // rejects when the room is shutting down - then the player simply leaves
    this.allowReconnection(client, RECONNECT_SECONDS).catch(() => undefined);
  }

  override onReconnect(client: Client): void {
    this.host.setAway(client.sessionId, false);
    this.welcome(client);
  }

  override onLeave(client: Client): void {
    this.host.leave(client.sessionId);
    if (this.hostId === client.sessionId) this.hostId = this.clients.find((c) => c.sessionId !== client.sessionId)?.sessionId ?? '';
  }

  override onDispose(): void {
    activeCodes.delete(this.roomId);
    this.host?.sim.dispose();
  }

  private welcome(client: Client): void {
    const msg: WelcomeMessage = { protocol: PROTOCOL_VERSION, code: this.roomId, tuning: diffTuning(DEFAULT_TUNING, this.host.sim.tuning) };
    client.send(MSG.welcome, msg);
    // a snapshot right away, so the client can start without waiting for the next broadcast
    client.send(MSG.snapshot, packSnapshot(this.host.snapshot(this.hostId, false)));
  }

  private update(): void {
    const now = performance.now();
    const seconds = (now - this.lastUpdate) / 1000;
    this.lastUpdate = now;
    this.stepper.advance(seconds, (dt) => {
      this.host.tick(dt);
      if (++this.ticks % SNAPSHOT_EVERY === 0) this.broadcast(MSG.snapshot, packSnapshot(this.host.snapshot(this.hostId)));
    });
  }
}
