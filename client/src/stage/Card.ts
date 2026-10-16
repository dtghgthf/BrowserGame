import { PerspectiveMesh, Rectangle, Texture, type Container } from 'pixi.js';
import type { SheetFrame } from '../render/assets';
import type { Camera25, Projected, Vec3 } from './Camera25';

/** Sub-division of the perspective meshes (more = more exact perspective of the texture). */
const VERTS = 5;
/** Vertices of the cells of a split card (a cell is small: little perspective inside). */
const CELL_VERTS = 3;
/**
 * Draw order band of the cards in the station's room: they sort by depth among
 * themselves, after the ship's floors and walls (negative orders) and before
 * the cut front of the hull.
 */
export const ROOM_BAND = 5e5;

export interface CardLayers {
  albedo: Container;
  normal: Container | null;
  /** Unlit layer (drawn after the composite): glowing things. */
  unlit: Container;
}

export type CardKind = 'lit' | 'unlit';

export interface CardSplit {
  /** Cell edge in texture px (`cellY` for the height, default the same). */
  cell: number;
  cellY?: number;
  /** Keeps only cells that hold something (texture px rectangle); default: all. */
  keep?: (x0: number, y0: number, x1: number, y1: number) => boolean;
}

/** One drawn piece of a card: the whole frame, or one cell of a split card. */
interface Part {
  albedo: PerspectiveMesh;
  normal: PerspectiveMesh | null;
  /** Rectangle of the part in frame px. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A flat sprite card standing (or lying) somewhere in the 2.5D scene. The
 * frame's pivot is at `pos`; `u` is the card's right axis, `v` its down axis
 * (both unit vectors in scene space). In-plane rotation and scale work like on
 * a regular sprite (wheel spokes, levers). The card is drawn as a perspective
 * mesh into the albedo and normal passes (so lights, normal maps, fog and
 * dither apply) or into the unlit pass.
 *
 * Big cards (the hull, long floors) are split into cells: a cell that reaches
 * behind the camera is dropped on its own instead of the whole card, and every
 * cell is depth-sorted by itself.
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
  /** Fixed draw order (zIndex) instead of the depth sort; null = by depth. */
  order: number | null = null;
  private frame: SheetFrame;
  private readonly parts: Part[] = [];
  /** Cell textures this card made (destroyed with it; the sources are shared). */
  private readonly owned: Texture[] = [];

  constructor(
    frame: SheetFrame,
    private readonly layers: CardLayers,
    /** Texture pixels per meter (16 = the normal 2D art, 32 = detailed station art). */
    private readonly ppm = 16,
    private readonly kind: CardKind = 'lit',
    split: CardSplit | null = null,
  ) {
    this.frame = frame;
    const cy = split?.cellY ?? split?.cell ?? 0;
    if (!split || (frame.width <= split.cell && frame.height <= cy)) {
      this.parts.push(this.makePart(frame.texture, frame.normal, 0, 0, frame.width, frame.height, VERTS));
      return;
    }
    const base = frame.texture.frame;
    const nbase = frame.normal?.frame ?? null;
    for (let y = 0; y < frame.height; y += cy) {
      for (let x = 0; x < frame.width; x += split.cell) {
        const x1 = Math.min(frame.width, x + split.cell);
        const y1 = Math.min(frame.height, y + cy);
        if (split.keep && !split.keep(x, y, x1, y1)) continue;
        const tex = new Texture({ source: frame.texture.source, frame: new Rectangle(base.x + x, base.y + y, x1 - x, y1 - y) });
        const ntex = frame.normal && nbase ? new Texture({ source: frame.normal.source, frame: new Rectangle(nbase.x + x, nbase.y + y, x1 - x, y1 - y) }) : null;
        this.owned.push(tex);
        if (ntex) this.owned.push(ntex);
        this.parts.push(this.makePart(tex, ntex, x, y, x1, y1, CELL_VERTS));
      }
    }
  }

  private makePart(tex: Texture, normal: Texture | null, x0: number, y0: number, x1: number, y1: number, verts: number): Part {
    const albedo = new PerspectiveMesh({ texture: tex, verticesX: verts, verticesY: verts });
    (this.kind === 'lit' ? this.layers.albedo : this.layers.unlit).addChild(albedo);
    let n: PerspectiveMesh | null = null;
    if (this.kind === 'lit' && this.layers.normal && normal) {
      n = new PerspectiveMesh({ texture: normal, verticesX: verts, verticesY: verts });
      this.layers.normal.addChild(n);
    }
    return { albedo, normal: n, x0, y0, x1, y1 };
  }

  setFrame(frame: SheetFrame): void {
    if (frame === this.frame) return;
    this.frame = frame;
    const p = this.parts[0]!;
    p.x1 = frame.width;
    p.y1 = frame.height;
    p.albedo.texture = frame.texture;
    if (p.normal && frame.normal) p.normal.texture = frame.normal;
  }

  /** Replaces the texture (e.g. a render texture drawn every frame). */
  setTexture(tex: Texture, width: number, height: number, pivotX = 0, pivotY = 0): void {
    this.frame = { ...this.frame, texture: tex, width, height, pivot: { x: pivotX, y: pivotY } };
    const p = this.parts[0]!;
    p.x1 = width;
    p.y1 = height;
    p.albedo.texture = tex;
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
    let sum = 0;
    let n = 0;
    for (const part of this.parts) {
      const meshes = part.normal ? [part.albedo, part.normal] : [part.albedo];
      if (!show) {
        for (const m of meshes) m.visible = false;
        continue;
      }
      const p: (Projected | null)[] = [
        cam.project(this.pointAt(part.x0, part.y0)),
        cam.project(this.pointAt(part.x1, part.y0)),
        cam.project(this.pointAt(part.x1, part.y1)),
        cam.project(this.pointAt(part.x0, part.y1)),
      ];
      if (p.some((q) => q === null)) {
        for (const m of meshes) m.visible = false;
        continue;
      }
      const q = p as Projected[];
      const depth = (q[0]!.depth + q[1]!.depth + q[2]!.depth + q[3]!.depth) / 4 - this.bias;
      sum += depth;
      n++;
      for (const m of meshes) {
        m.visible = true;
        m.setCorners(q[0]!.x, q[0]!.y, q[1]!.x, q[1]!.y, q[2]!.x, q[2]!.y, q[3]!.x, q[3]!.y);
        m.zIndex = this.order ?? ROOM_BAND - depth;
      }
      part.albedo.alpha = this.alpha;
      part.albedo.tint = this.tint;
      if (part.normal) part.normal.alpha = this.alpha;
    }
    if (n > 0) this.depth = sum / n;
  }

  destroy(): void {
    for (const p of this.parts) {
      p.albedo.destroy();
      p.normal?.destroy();
    }
    for (const t of this.owned) t.destroy(false);
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
