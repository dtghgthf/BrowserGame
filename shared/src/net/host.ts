import { SIM_DT } from '../constants';
import { copyInput, EMPTY_INPUT, type PlayerInput, type SimCommand } from '../input';
import type { AddPlayerOptions, Simulation } from '../simulation';
import type { GameEvent, PlayerState } from '../state';
import type { SnapshotMessage } from './protocol';

/** Inputs waiting longer than this many ticks are dropped (the client runs ahead / lag burst). */
const MAX_QUEUE = 8;
/** Without fresh input for this many ticks a player stops (tab in the background, connection stall). */
const IDLE_TICKS = 15;

interface InputQueue {
  queue: { seq: number; input: PlayerInput }[];
  /** Input applied in the last tick (repeated while the queue is empty). */
  last: PlayerInput;
  /** Sequence number of the last applied input (-1 = none yet). */
  lastSeq: number;
  /** Highest sequence number received (duplicates are ignored). */
  lastReceived: number;
  idle: number;
}

/**
 * The authoritative side of a networked game, independent of Colyseus so it can
 * be tested directly: buffers each player's inputs, steps the simulation at a
 * fixed rate (one input per player per tick), collects events and builds
 * snapshots for the clients.
 */
export class ShipHost {
  private readonly inputs = new Map<string, InputQueue>();
  private readonly commands: SimCommand[] = [];
  private events: GameEvent[] = [];

  constructor(readonly sim: Simulation) {}

  join(id: string, options: AddPlayerOptions = {}): PlayerState {
    if (!this.inputs.has(id)) this.inputs.set(id, { queue: [], last: { ...EMPTY_INPUT }, lastSeq: -1, lastReceived: -1, idle: 0 });
    const p = this.sim.addPlayer(id, options);
    p.away = false;
    return p;
  }

  leave(id: string): void {
    this.inputs.delete(id);
    this.sim.removePlayer(id);
  }

  /** Marks a dropped player (they stay on the ship until they reconnect or time out). */
  setAway(id: string, away: boolean): void {
    const p = this.sim.state.players.find((pp) => pp.id === id);
    if (p) p.away = away;
    const q = this.inputs.get(id);
    if (q && away) {
      q.queue.length = 0;
      q.last = { ...EMPTY_INPUT };
    }
  }

  receiveInputs(id: string, frames: readonly { seq: number; input: PlayerInput }[]): void {
    const q = this.inputs.get(id);
    if (!q) return;
    for (const f of frames) {
      if (f.seq <= q.lastReceived) continue;
      q.lastReceived = f.seq;
      q.queue.push(f);
    }
  }

  command(c: SimCommand): void {
    this.commands.push(c);
  }

  /** One fixed simulation step. */
  tick(dt: number = SIM_DT): void {
    const step: Record<string, PlayerInput> = {};
    for (const [id, q] of this.inputs) {
      if (q.queue.length > MAX_QUEUE) {
        // drop the oldest inputs but keep their button presses
        const dropped = q.queue.splice(0, q.queue.length - 2);
        const next = q.queue[0]!.input;
        for (const d of dropped) {
          next.jump ||= d.input.jump;
          next.interact ||= d.input.interact;
          next.pick ||= d.input.pick;
        }
      }
      const f = q.queue.shift();
      if (f) {
        copyInput(f.input, q.last);
        q.lastSeq = f.seq;
        q.idle = 0;
      } else if (++q.idle > IDLE_TICKS) {
        copyInput(EMPTY_INPUT, q.last);
      }
      step[id] = q.last;
    }
    this.sim.step(step, dt, this.commands.splice(0));
    for (const e of this.sim.state.events) this.events.push(e);
  }

  /** Builds the next snapshot and clears the collected events. */
  snapshot(host: string): SnapshotMessage {
    const acks: Record<string, number> = {};
    for (const [id, q] of this.inputs) acks[id] = q.lastSeq;
    const msg: SnapshotMessage = { state: { ...this.sim.state, events: [] }, acks, events: this.events, host };
    this.events = [];
    return msg;
  }

  /** Number of inputs waiting per player (debug / tests). */
  queued(id: string): number {
    return this.inputs.get(id)?.queue.length ?? 0;
  }
}
