import { SIM_DT } from '../constants';
import { copyInput, type PlayerInput } from '../input';
import type { Simulation } from '../simulation';
import type { GameEvent } from '../state';
import { encodeInputs, MAX_INPUTS_PER_MESSAGE, type InputMessage, type SnapshotMessage } from './protocol';

/** At most this many unacknowledged inputs are kept (and re-simulated). 1 s at 60 Hz. */
const MAX_PENDING = 60;

/** True if the local player caused the event (those are predicted, everything else comes from the server). */
export function isEventBy(e: GameEvent, playerId: string): boolean {
  return 'player' in e && e.player === playerId;
}

export interface PredictorStats {
  /** Inputs sent but not yet applied by the server. */
  pending: number;
  /** Ticks re-simulated at the last reconciliation. */
  replayed: number;
  snapshots: number;
  /** Server tick of the last snapshot. */
  serverTick: number;
}

/**
 * Client-side prediction with server reconciliation.
 *
 * The client runs the same Simulation as the server. Every tick it applies its
 * own input immediately (and remembers it with a sequence number); other players
 * keep doing what the server last saw them do. When an authoritative snapshot
 * arrives, the simulation is reset to it and all inputs the server has not
 * applied yet are simulated again - so the own player reacts instantly but
 * always ends up where the server says.
 */
export class Predictor {
  private seq = 0;
  private pending: { seq: number; input: PlayerInput }[] = [];
  private outbox: PlayerInput[] = [];
  private outboxFirst = 0;
  private latest: SnapshotMessage | null = null;
  private serverEvents: GameEvent[] = [];
  /** Session id of the room host. */
  host = '';
  readonly stats: PredictorStats = { pending: 0, replayed: 0, snapshots: 0, serverTick: 0 };

  constructor(
    readonly sim: Simulation,
    readonly myId: string,
  ) {}

  /** True once the first snapshot has been applied. */
  get synced(): boolean {
    return this.stats.snapshots > 0;
  }

  /** Stores a snapshot from the server; it is applied at the next `reconcile()`. */
  receive(msg: SnapshotMessage): void {
    for (const e of msg.events) this.serverEvents.push(e);
    if (!this.latest || msg.state.tick >= this.latest.state.tick) this.latest = msg;
  }

  /**
   * Applies the newest snapshot and re-simulates the unacknowledged inputs.
   * Returns the server's events not caused by the local player, or null if no
   * snapshot arrived since the last call.
   */
  reconcile(dt: number = SIM_DT): GameEvent[] | null {
    const msg = this.latest;
    if (!msg) return null;
    this.latest = null;
    this.host = msg.host;
    const ack = msg.acks[this.myId] ?? -1;
    let drop = 0;
    while (drop < this.pending.length && this.pending[drop]!.seq <= ack) drop++;
    if (drop) this.pending.splice(0, drop);

    this.sim.loadState(msg.state);
    for (const f of this.pending) this.sim.step(this.inputsFor(f.input), dt);

    this.stats.snapshots++;
    this.stats.replayed = this.pending.length;
    this.stats.pending = this.pending.length;
    this.stats.serverTick = msg.state.tick;
    const events = this.serverEvents.filter((e) => !isEventBy(e, this.myId));
    this.serverEvents = [];
    return events;
  }

  /** Predicts one tick with the local input. Returns the events the local player caused. */
  predict(input: Readonly<PlayerInput>, dt: number = SIM_DT): GameEvent[] {
    const f = { seq: this.seq++, input: copyInput(input) };
    this.pending.push(f);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    if (this.outbox.length === 0) this.outboxFirst = f.seq;
    this.outbox.push(f.input);
    this.stats.pending = this.pending.length;
    this.sim.step(this.inputsFor(f.input), dt);
    return this.sim.state.events.filter((e) => isEventBy(e, this.myId));
  }

  /** Inputs to send since the last call (null if none). */
  takeOutgoing(): InputMessage | null {
    if (this.outbox.length === 0) return null;
    const inputs = this.outbox.splice(0, MAX_INPUTS_PER_MESSAGE);
    const msg = encodeInputs(this.outboxFirst, inputs);
    this.outboxFirst += inputs.length;
    return msg;
  }

  /** Own input + "keep doing what you did" for everybody else. */
  private inputsFor(mine: PlayerInput): Record<string, Readonly<PlayerInput>> {
    const inputs: Record<string, Readonly<PlayerInput>> = {};
    // passing a player's own prevInput repeats it without producing new button presses
    for (const p of this.sim.state.players) inputs[p.id] = p.prevInput;
    inputs[this.myId] = mine;
    return inputs;
  }
}
