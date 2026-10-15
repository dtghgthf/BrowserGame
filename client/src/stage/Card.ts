import { PerspectiveMesh, type Container, type Texture } from 'pixi.js';
import type { SheetFrame } from '../render/assets';
import type { Camera25, Projected, Vec3 } from './Camera25';

/** Sub-division of the perspective meshes (more = more exact perspective of the texture). */
const VERTS = 5;

export interface CardLayers {
  albedo: Container;
  normal: Container | null;
  /** Unlit layer (drawn after the composite): glowing things. */
  unlit: Container;
}

export type CardKind = 'lit' | 'unlit';

/**
 * A flat sprite card standing (or lying) somewhere in the 2.5D scene. The
 * frame's pivot is at `pos`; `u` is the card's right axis, `v` its down axis
 * (both unit vectors in scene space). In-plane rotation and scale work like on
 * a regular sprite (wheel spokes, levers). The card is drawn as a perspective
 * mesh into the albedo and normal passes (so lights, normal maps, fog and
 * dither apply) or into the unlit pass.
 */
export class Card {
  pos: Vec3 = { x: 0, y: 0, z: 0 };
  u: Vec3 = { x: 1, y: 0, z: 0 };
  v: Vec3 = { x: 0, y: 1, z: 0 };
  rotation = 0;
  scaleX = 1;
  scaleY = 1;
  visible = true;
  alpha = 1;
  tint = 0xffffff;
  /** Camera depth of the card centre (after update); used for sorting. */
  depth = 0;
  /** Sort bias: positive = drawn in front of cards at the same depth. */
  bias = 0;
  /** Projected screen corners of the last update (tl, tr, br, bl). */
  readonly screen: { x: number; y: number }[] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  private frame: SheetFrame;
  private readonly albedo: PerspectiveMesh;
  private readonly normal: PerspectiveMesh | null;

  constructor(
    frame: SheetFrame,
    layers: CardLayers,
    /** Texture pixels per meter (16 = the normal 2D art, 32 = detailed station art). */
    private readonly ppm = 16,
    kind: CardKind = 'lit',
  ) {
    this.frame = frame;
    this.albedo = new PerspectiveMesh({ texture: frame.texture, verticesX: VERTS, verticesY: VERTS });
    (kind === 'lit' ? layers.albedo : layers.unlit).addChild(this.albedo);
    if (kind === 'lit' && layers.normal && frame.normal) {
      this.normal = new PerspectiveMesh({ texture: frame.normal, verticesX: VERTS, verticesY: VERTS });
      layers.normal.addChild(this.normal);
    } else this.normal = null;
  }

  setFrame(frame: SheetFrame): void {
    if (frame === this.frame) return;
    this.frame = frame;
    this.albedo.texture = frame.texture;
    if (this.normal && frame.normal) this.normal.texture = frame.normal;
  }

  /** Replaces the texture (e.g. a render texture drawn every frame). */
  setTexture(tex: Texture, width: number, height: number, pivotX = 0, pivotY = 0): void {
    this.frame = { ...this.frame, texture: tex, width, height, pivot: { x: pivotX, y: pivotY } };
    this.albedo.texture = tex;
  }

  get widthM(): number {
    return (this.frame.width / this.ppm) * Math.abs(this.scaleX);
  }

  get heightM(): number {
    return (this.frame.height / this.ppm) * Math.abs(this.scaleY);
  }

  /** Scene position of a frame pixel (texture px, before rotation / scale). */
  pointAt(px: number, py: number): Vec3 {
    const k = 1 / this.ppm;
    let a = (px - this.frame.pivot.x) * k * this.scaleX;
    let b = (py - this.frame.pivot.y) * k * this.scaleY;
    if (this.rotation !== 0) {
      const c = Math.cos(this.rotation);
      const s = Math.sin(this.rotation);
      const ra = a * c - b * s;
      const rb = a * s + b * c;
      a = ra;
      b = rb;
    }
    return { x: this.pos.x + this.u.x * a + this.v.x * b, y: this.pos.y + this.u.y * a + this.v.y * b, z: this.pos.z + this.u.z * a + this.v.z * b };
  }

  /** The four scene corners (tl, tr, br, bl). */
  corners(): Vec3[] {
    const w = this.frame.width;
    const h = this.frame.height;
    return [this.pointAt(0, 0), this.pointAt(w, 0), this.pointAt(w, h), this.pointAt(0, h)];
  }

  update(cam: Camera25): void {
    const show = this.visible && this.alpha > 0.01;
    if (!show) {
      this.albedo.visible = false;
      if (this.normal) this.normal.visible = false;
      return;
    }
    const cs = this.corners();
    const p: (Projected | null)[] = cs.map((c) => cam.project(c));
    if (p.some((q) => q === null)) {
      this.albedo.visible = false;
      if (this.normal) this.normal.visible = false;
      return;
    }
    const q = p as Projected[];
    this.depth = (q[0]!.depth + q[1]!.depth + q[2]!.depth + q[3]!.depth) / 4 - this.bias;
    for (let i = 0; i < 4; i++) {
      this.screen[i]!.x = q[i]!.x;
      this.screen[i]!.y = q[i]!.y;
    }
    for (const m of [this.albedo, this.normal]) {
      if (!m) continue;
      m.visible = true;
      m.setCorners(q[0]!.x, q[0]!.y, q[1]!.x, q[1]!.y, q[2]!.x, q[2]!.y, q[3]!.x, q[3]!.y);
      m.zIndex = -this.depth;
    }
    this.albedo.alpha = this.alpha;
    this.albedo.tint = this.tint;
    if (this.normal) this.normal.alpha = this.alpha;
  }

  destroy(): void {
    this.albedo.destroy();
    this.normal?.destroy();
  }
}

/** Unit vectors for the common card orientations. */
export const UP_CARD = { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 } };
/** Lying on the floor: the texture's top edge points to the back. */
export const FLOOR_CARD = { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: 1 } };

/** A standing card turned to face a camera with this yaw (billboard). */
export function facing(yaw: number): { u: Vec3; v: Vec3 } {
  return { u: { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) }, v: { x: 0, y: 1, z: 0 } };
}
