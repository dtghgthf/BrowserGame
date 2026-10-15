import { WORLD_GRAVITY } from '../constants';
import type { Vec2 } from '../math';
import { seaSurfaceY } from '../sea';
import { shipToWorld } from '../ship';
import type { StationState } from '../state';
import type { SimContext } from './context';

/** Ship-local point the life ring hangs from / its line runs over (relative to the station). */
export const RING_ANCHOR = { x: 0, y: -1.1 } as const;

export function ringAnchorWorld(ctx: SimContext, st: StationState): Vec2 {
  return shipToWorld(ctx.state.ship, { x: st.x + RING_ANCHOR.x, y: st.y + RING_ANCHOR.y });
}

/** F at the ring station: throw the ring, or reel it in when it floats without anybody on it. */
export function ringButton(ctx: SimContext, st: StationState): void {
  const s = ctx.state;
  const G = ctx.tuning.gameplay;
  if (!s.ring) {
    const a = ringAnchorWorld(ctx, st);
    const angle = st.value + s.ship.roll;
    s.ring = {
      x: a.x,
      y: a.y,
      vx: Math.cos(angle) * G.ringSpeed + s.ship.speed,
      vy: Math.sin(angle) * G.ringSpeed + s.ship.vy,
      phase: 'flying',
      holder: null,
    };
    if (st.occupant) ctx.emit({ type: 'ringThrow', player: st.occupant });
  } else if (s.ring.phase === 'floating') {
    s.ring = null;
  }
}

/** A full pull on the line (stroke left/right like the pump) brings the ring closer. */
export function ringPull(ctx: SimContext, st: StationState): void {
  const ring = ctx.state.ring;
  if (!ring || ring.phase === 'flying') return;
  const a = ringAnchorWorld(ctx, st);
  const step = ctx.tuning.gameplay.ringPullStroke;
  const dx = a.x - ring.x;
  ring.x += Math.sign(dx) * Math.min(Math.abs(dx), step);
}

export function updateRing(ctx: SimContext, dt: number): void {
  const s = ctx.state;
  const ring = s.ring;
  if (!ring) return;
  const st = s.stations.find((x) => x.kind === 'ring');
  // nobody holds the line any more: it is reeled in
  if (!st || st.occupant === null) {
    s.ring = null;
    return;
  }
  const G = ctx.tuning.gameplay;
  const a = ringAnchorWorld(ctx, st);
  const surface = seaSurfaceY(ring.x, s.time, s.ship.seaState);
  if (ring.phase === 'flying') {
    ring.vy += WORLD_GRAVITY * dt;
    ring.x += ring.vx * dt;
    ring.y += ring.vy * dt;
    if (ring.y >= surface) {
      ring.phase = 'floating';
      ring.vx = 0;
      ring.vy = 0;
    }
  } else {
    ring.y = surface;
  }
  // the line is only so long: the ship drags the ring along
  const dx = ring.x - a.x;
  const dy = ring.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len > G.ringRope) {
    const k = G.ringRope / len;
    ring.x = a.x + dx * k;
    if (ring.phase === 'flying') ring.y = a.y + dy * k;
  }
  if (ring.phase === 'floating') {
    for (const p of s.players) {
      if (p.overboard <= 0 || p.away) continue;
      if (Math.abs(p.seaX - ring.x) < 1.6) {
        ring.phase = 'pulling';
        ring.holder = p.id;
        ctx.emit({ type: 'ringCatch', player: p.id });
        break;
      }
    }
  }
  if (ring.phase === 'pulling') {
    const holder = s.players.find((p) => p.id === ring.holder);
    if (!holder || holder.overboard <= 0) {
      ring.phase = 'floating';
      ring.holder = null;
      return;
    }
    holder.seaX = ring.x;
    // close enough to climb aboard over the railing
    if (Math.abs(ring.x - a.x) < 2.2) {
      ctx.rescue(holder, st.x, st.y);
      s.voyage.rescues++;
      ctx.emit({ type: 'rescued', player: holder.id });
      s.ring = null;
    }
  }
}
