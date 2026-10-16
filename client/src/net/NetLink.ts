import { Client, type Room } from '@colyseus/sdk';
import {
  MSG,
  PROTOCOL_VERSION,
  ROOM_NAME,
  type InputMessage,
  type JoinOptions,
  type SimCommand,
  unpackSnapshot,
  type SnapshotMessage,
  type SnapshotWire,
  type TuningPatch,
  type WelcomeMessage, type GameMode, type Role } from '@lw/shared';

export type NetStatus = 'connected' | 'reconnecting' | 'closed';

/** What is needed to continue the same seat after a page reload. */
interface SavedSession {
  url: string;
  code: string;
  token: string;
  time: number;
}

const SESSION_KEY = 'lw.session.v1';

/**
 * The connection to one ship room: thin wrapper around the Colyseus SDK with
 * typed messages, ping measurement, automatic reconnection (by the SDK) and
 * reconnection after a page reload (token in sessionStorage). `lagMs` adds an
 * artificial round-trip delay for testing (`?lag=150`).
 */
export class NetLink {
  onSnapshot: (m: SnapshotMessage) => void = () => {};
  onTuning: (p: TuningPatch) => void = () => {};
  onWelcome: (m: WelcomeMessage) => void = () => {};
  onStatus: (s: NetStatus, reason?: string) => void = () => {};
  status: NetStatus = 'connected';
  /** Round-trip time in ms (measured every 2 s, includes the simulated lag). */
  rtt = 0;
  snapshotsReceived = 0;
  /** Bytes of encoded game state received (debug overlay shows the rate). */
  snapshotBytes = 0;
  private readonly pingTimer: number;
  private readonly early: { type: string; msg: unknown }[] = [];
  private ready = false;

  private constructor(
    readonly room: Room,
    readonly url: string,
    private readonly lagMs: number,
  ) {
    const half = () => Math.max(0, lagMs / 2);
    const deliver = (type: string, msg: unknown) => {
      if (!this.ready) {
        this.early.push({ type, msg });
        return;
      }
      if (type === MSG.snapshot) {
        this.snapshotsReceived++;
        this.snapshotBytes += (msg as SnapshotWire).s.byteLength;
        this.onSnapshot(unpackSnapshot(msg as SnapshotWire));
      } else if (type === MSG.tuning) this.onTuning(msg as TuningPatch);
      else if (type === MSG.welcome) {
        this.save((msg as WelcomeMessage).code);
        this.onWelcome(msg as WelcomeMessage);
      }
    };
    for (const type of [MSG.snapshot, MSG.tuning, MSG.welcome]) {
      room.onMessage(type, (msg: unknown) => (lagMs > 0 ? window.setTimeout(() => deliver(type, msg), half()) : deliver(type, msg)));
    }
    room.onDrop(() => this.setStatus('reconnecting'));
    room.onReconnect(() => this.setStatus('connected'));
    room.onLeave((code, reason) => {
      // 4000 = left on purpose; anything else = gave up reconnecting / room closed
      if (code !== 4000) NetLink.forget();
      this.setStatus('closed', reason);
    });
    this.pingTimer = window.setInterval(() => {
      if (this.status === 'connected') room.ping((ms) => (this.rtt = ms + lagMs));
    }, 2000);
    room.ping((ms) => (this.rtt = ms + lagMs));
  }

  /** Call once the handlers are set; messages that arrived in between are delivered now. */
  start(): void {
    this.ready = true;
    for (const e of this.early.splice(0)) {
      if (e.type === MSG.snapshot) this.onSnapshot(unpackSnapshot(e.msg as SnapshotWire));
      else if (e.type === MSG.tuning) this.onTuning(e.msg as TuningPatch);
      else if (e.type === MSG.welcome) {
        this.save((e.msg as WelcomeMessage).code);
        this.onWelcome(e.msg as WelcomeMessage);
      }
    }
  }

  static async create(url: string, name: string, color: number, role: Role, mode: GameMode, design: string | null, lagMs = 0): Promise<NetLink> {
    const opts: JoinOptions = { name, color, protocol: PROTOCOL_VERSION, role, mode, ...(design ? { design } : {}) };
    return new NetLink(await new Client(url).create(ROOM_NAME, opts), url, lagMs);
  }

  static async join(url: string, code: string, name: string, color: number, role: Role, lagMs = 0): Promise<NetLink> {
    const opts: JoinOptions = { name, color, protocol: PROTOCOL_VERSION, role };
    return new NetLink(await new Client(url).joinById(code, opts), url, lagMs);
  }

  /** Continues the seat of a previous page load in this tab, if there is one. */
  static async resume(url: string, lagMs = 0): Promise<NetLink | null> {
    const saved = NetLink.saved();
    if (!saved || saved.url !== url || Date.now() - saved.time > 10 * 60 * 1000) return null;
    try {
      return new NetLink(await new Client(url).reconnect(saved.token), url, lagMs);
    } catch {
      NetLink.forget();
      return null;
    }
  }

  static saved(): SavedSession | null {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as SavedSession) : null;
    } catch {
      return null;
    }
  }

  static forget(): void {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  private save(code: string): void {
    try {
      const s: SavedSession = { url: this.url, code, token: this.room.reconnectionToken, time: Date.now() };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable */
    }
  }

  get code(): string {
    return this.room.roomId;
  }

  get sessionId(): string {
    return this.room.sessionId;
  }

  sendInputs(msg: InputMessage): void {
    this.send(MSG.input, msg);
  }

  sendCommand(c: SimCommand): void {
    this.send(MSG.command, c);
  }

  private send(type: string, payload: unknown): void {
    if (this.status === 'closed') return;
    if (this.lagMs > 0) window.setTimeout(() => this.room.send(type, payload), this.lagMs / 2);
    else this.room.send(type, payload);
  }

  async leave(): Promise<void> {
    NetLink.forget();
    window.clearInterval(this.pingTimer);
    try {
      await this.room.leave(true);
    } catch {
      /* already gone */
    }
  }

  private setStatus(s: NetStatus, reason?: string): void {
    this.status = s;
    if (s === 'closed') window.clearInterval(this.pingTimer);
    this.onStatus(s, reason);
  }
}
