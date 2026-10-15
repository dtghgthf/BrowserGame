import { lerp, lerpAngle, type GameState } from '@lw/shared';

/**
 * The parts of the state that move continuously, captured before and after
 * each fixed simulation step so rendering can interpolate between them.
 */
export interface Snapshot {
  time: number;
  ship: { x: number; y: number; roll: number };
  players: Map<string, { x: number; y: number }>;
  objects: Map<number, { x: number; y: number; angle: number }>;
  stations: { value: number }[];
}

export function emptySnapshot(): Snapshot {
  return { time: 0, ship: { x: 0, y: 0, roll: 0 }, players: new Map(), objects: new Map(), stations: [] };
}

export function takeSnapshot(s: GameState, out: Snapshot = emptySnapshot()): Snapshot {
  out.time = s.time;
  out.ship.x = s.ship.x;
  out.ship.y = s.ship.y;
  out.ship.roll = s.ship.roll;
  out.players.clear();
  for (const p of s.players) out.players.set(p.id, { x: p.x, y: p.y });
  out.objects.clear();
  for (const o of s.objects) out.objects.set(o.id, { x: o.x, y: o.y, angle: o.angle });
  out.stations.length = s.stations.length;
  s.stations.forEach((st, i) => (out.stations[i] = { value: st.value }));
  return out;
}

/** Interpolates a -> b by t (0..1). Entities missing in `a` use `b`. */
export function interpolate(a: Snapshot, b: Snapshot, t: number, angular: ReadonlySet<number>, out: Snapshot = emptySnapshot()): Snapshot {
  out.time = lerp(a.time, b.time, t);
  out.ship.x = lerp(a.ship.x, b.ship.x, t);
  out.ship.y = lerp(a.ship.y, b.ship.y, t);
  out.ship.roll = lerp(a.ship.roll, b.ship.roll, t);
  out.players.clear();
  for (const [id, pb] of b.players) {
    const pa = a.players.get(id) ?? pb;
    // a big jump (teleport / respawn) is not interpolated
    const far = Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y) > 2;
    out.players.set(id, far ? { ...pb } : { x: lerp(pa.x, pb.x, t), y: lerp(pa.y, pb.y, t) });
  }
  out.objects.clear();
  for (const [id, ob] of b.objects) {
    const oa = a.objects.get(id) ?? ob;
    const far = Math.abs(oa.x - ob.x) + Math.abs(oa.y - ob.y) > 2;
    out.objects.set(id, far ? { ...ob } : { x: lerp(oa.x, ob.x, t), y: lerp(oa.y, ob.y, t), angle: lerpAngle(oa.angle, ob.angle, t) });
  }
  out.stations.length = b.stations.length;
  b.stations.forEach((sb, i) => {
    const sa = a.stations[i] ?? sb;
    out.stations[i] = { value: angular.has(i) ? lerpAngle(sa.value, sb.value, t) : lerp(sa.value, sb.value, t) };
  });
  return out;
}

/**
 * Visual offsets that hide network corrections: when a server snapshot moves an
 * entity, it is drawn at its old place plus an offset that fades out quickly,
 * instead of jumping.
 */
export interface Corrections {
  players: Map<string, { x: number; y: number }>;
  objects: Map<number, { x: number; y: number; angle: number }>;
  ship: { x: number; y: number; roll: number };
}

export function emptyCorrections(): Corrections {
  return { players: new Map(), objects: new Map(), ship: { x: 0, y: 0, roll: 0 } };
}

/** Corrections larger than this (m) are real jumps (respawn, reset) and are not smoothed. */
const MAX_SMOOTH = 2;

/**
 * Records the change from `before` to `after` (the state right before / after a
 * reconciliation) as offsets and shifts `prev` by the same amount, so the
 * interpolated view does not move at the moment of the correction.
 * Returns the largest position correction in meters (for the debug overlay).
 */
export function recordCorrection(before: Snapshot, after: Snapshot, prev: Snapshot, c: Corrections): number {
  let largest = 0;
  for (const [id, b] of before.players) {
    const a = after.players.get(id);
    if (!a) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.abs(dx) + Math.abs(dy);
    if (d > MAX_SMOOTH) {
      c.players.delete(id);
      continue;
    }
    largest = Math.max(largest, Math.hypot(dx, dy));
    const o = c.players.get(id) ?? { x: 0, y: 0 };
    o.x += dx;
    o.y += dy;
    c.players.set(id, o);
    const p = prev.players.get(id);
    if (p) {
      p.x -= dx;
      p.y -= dy;
    }
  }
  for (const [id, b] of before.objects) {
    const a = after.objects.get(id);
    if (!a) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) + Math.abs(dy) > MAX_SMOOTH) {
      c.objects.delete(id);
      continue;
    }
    const da = Math.atan2(Math.sin(b.angle - a.angle), Math.cos(b.angle - a.angle));
    const o = c.objects.get(id) ?? { x: 0, y: 0, angle: 0 };
    o.x += dx;
    o.y += dy;
    o.angle += da;
    c.objects.set(id, o);
    const p = prev.objects.get(id);
    if (p) {
      p.x -= dx;
      p.y -= dy;
      p.angle -= da;
    }
  }
  const sx = before.ship.x - after.ship.x;
  const sy = before.ship.y - after.ship.y;
  const sr = before.ship.roll - after.ship.roll;
  if (Math.abs(sx) < MAX_SMOOTH * 4) {
    c.ship.x += sx;
    c.ship.y += sy;
    c.ship.roll += sr;
    prev.ship.x -= sx;
    prev.ship.y -= sy;
    prev.ship.roll -= sr;
  }
  return largest;
}

/** Adds the offsets to the interpolated view and lets them fade (time constant `tau` s). */
export function applyCorrections(view: Snapshot, c: Corrections, dt: number, tau = 0.12): void {
  const k = Math.exp(-dt / tau);
  for (const [id, o] of c.players) {
    const v = view.players.get(id);
    if (v) {
      v.x += o.x;
      v.y += o.y;
    }
    o.x *= k;
    o.y *= k;
    if (Math.abs(o.x) + Math.abs(o.y) < 1e-4) c.players.delete(id);
  }
  for (const [id, o] of c.objects) {
    const v = view.objects.get(id);
    if (v) {
      v.x += o.x;
      v.y += o.y;
      v.angle += o.angle;
    }
    o.x *= k;
    o.y *= k;
    o.angle *= k;
    if (Math.abs(o.x) + Math.abs(o.y) + Math.abs(o.angle) < 1e-4) c.objects.delete(id);
  }
  view.ship.x += c.ship.x;
  view.ship.y += c.ship.y;
  view.ship.roll += c.ship.roll;
  c.ship.x *= k;
  c.ship.y *= k;
  c.ship.roll *= k;
}

export function clearCorrections(c: Corrections): void {
  c.players.clear();
  c.objects.clear();
  c.ship.x = c.ship.y = c.ship.roll = 0;
}
