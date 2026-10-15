export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Moves `current` towards `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

/** Wraps an angle to the range (-PI, PI]. */
export function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let r = a % twoPi;
  if (r <= -Math.PI) r += twoPi;
  else if (r > Math.PI) r -= twoPi;
  return r;
}

/** Interpolates between two angles along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/**
 * Rotates a vector by `angle` radians. In the y-down coordinate system used
 * everywhere in this project a positive angle is a clockwise rotation on screen.
 */
export function rotate(v: Vec2, angle: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = v.x * c - v.y * s;
  const y = v.x * s + v.y * c;
  out.x = x;
  out.y = y;
  return out;
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

/** Smoothstep in [0,1]. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
