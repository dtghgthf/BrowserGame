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
