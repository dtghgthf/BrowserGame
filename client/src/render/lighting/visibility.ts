/**
 * 2D visibility polygon by angular ray casting against line segment occluders
 * (Red Blob Games style). Pure function - unit tested.
 */
export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface VisibilityOptions {
  /** Cone centre angle (radians, y-down). Omit for an omni light. */
  direction?: number;
  /** Cone half angle. */
  halfAngle?: number;
  /** Rays are extended this far into the occluders so wall surfaces get lit. */
  penetration?: number;
}

const EPS = 0.00025;

function wrap(a: number): number {
  while (a <= -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
}

/**
 * Returns the polygon (flat x,y list, ordered by angle) visible from (ox, oy)
 * within a square of half size `radius`. For cones the list starts and ends at
 * the cone edges; the caller adds the origin to build a triangle fan.
 */
export function visibilityPolygon(ox: number, oy: number, radius: number, segments: readonly Segment[], opts: VisibilityOptions = {}): number[] {
  const r = radius;
  const segs: Segment[] = [];
  for (const s of segments) {
    if (Math.max(s.ax, s.bx) < ox - r || Math.min(s.ax, s.bx) > ox + r) continue;
    if (Math.max(s.ay, s.by) < oy - r || Math.min(s.ay, s.by) > oy + r) continue;
    segs.push(s);
  }
  const bound: Segment[] = [
    { ax: ox - r, ay: oy - r, bx: ox + r, by: oy - r },
    { ax: ox + r, ay: oy - r, bx: ox + r, by: oy + r },
    { ax: ox + r, ay: oy + r, bx: ox - r, by: oy + r },
    { ax: ox - r, ay: oy + r, bx: ox - r, by: oy - r },
  ];
  const all = segs.concat(bound);
  const cone = opts.direction !== undefined && opts.halfAngle !== undefined && opts.halfAngle < Math.PI;
  const center = opts.direction ?? 0;
  const half = opts.halfAngle ?? Math.PI;

  // angles relative to the cone centre (or absolute for omni lights)
  const rel: number[] = [];
  const addAngle = (a: number) => {
    const ra = cone ? wrap(a - center) : wrap(a);
    if (cone && Math.abs(ra) > half) return;
    rel.push(ra);
  };
  for (const s of all) {
    for (const [px, py] of [
      [s.ax, s.ay],
      [s.bx, s.by],
    ] as const) {
      const a = Math.atan2(py - oy, px - ox);
      addAngle(a - EPS);
      addAngle(a);
      addAngle(a + EPS);
    }
  }
  if (cone) {
    rel.push(-half, half);
    // a few extra rays so long cone arcs stay round
    for (let i = 1; i < 8; i++) rel.push(-half + (2 * half * i) / 8);
  }
  rel.sort((a, b) => a - b);

  const pen = opts.penetration ?? 0;
  const out: number[] = [];
  let lastA = -Infinity;
  for (const ra of rel) {
    if (ra - lastA < EPS * 0.25) continue;
    lastA = ra;
    const a = cone ? center + ra : ra;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let best = Infinity;
    let boundaryHit = false;
    for (let i = 0; i < all.length; i++) {
      const s = all[i]!;
      const ex = s.bx - s.ax;
      const ey = s.by - s.ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const qx = s.ax - ox;
      const qy = s.ay - oy;
      const t = (qx * ey - qy * ex) / den;
      const u = (qx * dy - qy * dx) / den;
      if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) {
        best = t;
        boundaryHit = i >= segs.length;
      }
    }
    if (!Number.isFinite(best)) continue;
    const d = boundaryHit ? best : best + pen;
    out.push(ox + dx * d, oy + dy * d);
  }
  return out;
}
