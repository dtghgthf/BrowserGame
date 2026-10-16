/**
 * Perspective camera for the 2.5D station view ("2D sprites in 3D space").
 * Coordinates are ship-local meters with depth: x right, y down, z towards the
 * viewer (z = 0 is the plane of the normal 2D cross-section, the back wall is
 * at negative z). The camera orbits a target point: yaw turns it around the
 * vertical axis, pitch lifts it, `distance` is the dolly.
 *
 * With yaw = pitch = 0 the z = 0 plane is drawn at exactly `pxPerMeter` around
 * the principal point - the same picture as the 2D view, which is what makes
 * the switch between the two invisible.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Projected {
  x: number;
  y: number;
  /** Distance along the viewing direction (m); larger = farther. */
  depth: number;
}

export class Camera25 {
  target: Vec3 = { x: 0, y: 0, z: 0 };
  /** Radians; positive = the camera moves to the right of the target and looks a bit to the left. */
  yaw = 0;
  /** Radians; positive = the camera is above the target looking down. */
  pitch = 0;
  /** Meters from the camera to the target. */
  distance = 12;
  /** Screen px per meter on the target plane at distance `baseDistance` (16 px/m like the 2D view). */
  pxPerMeter = 16;
  /** The distance at which the target plane is drawn at pxPerMeter (the dolly zooms relative to it). */
  baseDistance = 12;
  /** Screen px of the principal point (where the target appears). */
  cx = 0;
  cy = 0;
  /** Roll of the scene around the view axis (the ship's roll), radians. */
  roll = 0;
  /** Point the scene rolls around (ship pivot, in scene coordinates). */
  rollPivot: Vec3 = { x: 0, y: 0, z: 0 };

  private eye: Vec3 = { x: 0, y: 0, z: 0 };
  private sy = 0;
  private cyaw = 1;
  private sp = 0;
  private cp = 1;
  private sr = 0;
  private cr = 1;
  private focal = 1;

  /** Call after changing the parameters, before projecting. */
  update(): void {
    this.sy = Math.sin(this.yaw);
    this.cyaw = Math.cos(this.yaw);
    this.sp = Math.sin(this.pitch);
    this.cp = Math.cos(this.pitch);
    this.sr = Math.sin(this.roll);
    this.cr = Math.cos(this.roll);
    this.focal = this.pxPerMeter * this.baseDistance;
    // eye = target + Ry(yaw) * Rx(pitch) * (0, 0, d)   (pitch up = towards negative y)
    const d = this.distance;
    const ox = 0;
    const oy = -d * this.sp;
    const oz = d * this.cp;
    this.eye = {
      x: this.target.x + ox * this.cyaw + oz * this.sy,
      y: this.target.y + oy,
      z: this.target.z - ox * this.sy + oz * this.cyaw,
    };
  }

  /** The camera position in scene coordinates (before the roll), after update(). */
  eyeScene(): Vec3 {
    const dx = this.eye.x - this.rollPivot.x;
    const dy = this.eye.y - this.rollPivot.y;
    return { x: this.rollPivot.x + dx * this.cr + dy * this.sr, y: this.rollPivot.y - dx * this.sr + dy * this.cr, z: this.eye.z };
  }

  /** Applies the roll (rotation about the z axis through the pivot) to a scene point. */
  rolled(p: Vec3): Vec3 {
    const dx = p.x - this.rollPivot.x;
    const dy = p.y - this.rollPivot.y;
    return { x: this.rollPivot.x + dx * this.cr - dy * this.sr, y: this.rollPivot.y + dx * this.sr + dy * this.cr, z: p.z };
  }

  /** Scene point -> camera space (x right, y down, z towards the camera). */
  private toCamera(p: Vec3): Vec3 {
    const q = this.rolled(p);
    const dx = q.x - this.eye.x;
    const dy = q.y - this.eye.y;
    const dz = q.z - this.eye.z;
    // undo yaw (rotation about y)
    const x1 = dx * this.cyaw - dz * this.sy;
    const z1 = dx * this.sy + dz * this.cyaw;
    // undo pitch (rotation about x): the target ends up straight ahead at (0, 0, -distance)
    const y2 = dy * this.cp + z1 * this.sp;
    const z2 = -dy * this.sp + z1 * this.cp;
    return { x: x1, y: y2, z: z2 };
  }

  /** Projects a scene point to screen px; null if it is behind (or too close to) the camera. */
  project(p: Vec3): Projected | null {
    const c = this.toCamera(p);
    const depth = -c.z;
    if (depth < 0.05) return null;
    return { x: this.cx + (this.focal * c.x) / depth, y: this.cy + (this.focal * c.y) / depth, depth };
  }

  /** The scene point on the plane z = `planeZ` (before roll) under a screen px; null if parallel / behind. */
  unproject(sx: number, sy: number, planeZ = 0): Vec3 | null {
    // ray in camera space
    const rx = (sx - this.cx) / this.focal;
    const ry = (sy - this.cy) / this.focal;
    const rz = -1;
    // camera -> world: redo pitch, then yaw
    const y1 = ry * this.cp - rz * this.sp;
    const z1 = ry * this.sp + rz * this.cp;
    const wx = rx * this.cyaw + z1 * this.sy;
    const wz = -rx * this.sy + z1 * this.cyaw;
    const wy = y1;
    if (Math.abs(wz) < 1e-6) return null;
    const t = (planeZ - this.eye.z) / wz;
    if (t <= 0) return null;
    const hit = { x: this.eye.x + wx * t, y: this.eye.y + wy * t, z: planeZ };
    // undo the roll
    const dx = hit.x - this.rollPivot.x;
    const dy = hit.y - this.rollPivot.y;
    return { x: this.rollPivot.x + dx * this.cr + dy * this.sr, y: this.rollPivot.y - dx * this.sr + dy * this.cr, z: planeZ };
  }
}

/** Smooth 0..1 ease (for the camera moves). */
export function easeInOut(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
}
