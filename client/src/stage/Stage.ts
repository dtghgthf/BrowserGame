import { Container, Graphics, PerspectiveMesh } from 'pixi.js';
import type { SheetFrame } from '../render/assets';
import type { GameRenderer } from '../render/GameRenderer';
import type { LightDef, LightSystem } from '../render/lighting/LightSystem';
import { Camera25, type Vec3 } from './Camera25';
import { Card, ROOM_BAND, type CardKind, type CardSplit } from './Card';

/** How many point lights the 2.5D scene can use. */
const LIGHTS = 4;

interface Shadow {
  card: Card;
  mesh: PerspectiveMesh;
}

/** back: drawn first in order; ship: the ship set, sorted by its own draw order; cards: depth-sorted props and people. */
export type StageLayer = 'back' | 'ship' | 'cards';

/**
 * The 2.5D scene: screen-space containers in the albedo, normal, mask and
 * unlit passes (above the 2D world), the perspective camera, the cards,
 * planar shadows on the floor and a few unoccluded point lights. The regular
 * lighting / fog / dither of the composite apply to it unchanged.
 */
export class Stage {
  readonly camera = new Camera25();
  private readonly albedoRoot = new Container();
  private readonly normalRoot = new Container();
  private readonly unlitRoot = new Container();
  private readonly back = { a: new Container(), n: new Container() };
  private readonly ship = { a: new Container(), n: new Container() };
  private readonly mask = new Graphics();
  private readonly cards: Card[] = [];
  private readonly shadows: Shadow[] = [];
  readonly lights: LightDef[] = [];
  /** Light that casts the floor shadows (scene coordinates). */
  shadowLight: Vec3 | null = null;
  /** Floor height (scene y) the shadows fall on, and the back wall they stop at. */
  floorY = 0;
  backZ = -1.6;
  /** Whether the scene is lit like the inside of the hull (no fog, interior ambient). */
  interior = true;
  /** Screen rectangle the scene covers (for the mask pass). */
  readonly bounds = { x: 0, y: 0, w: 0, h: 0 };
  /** Draws the scene's own mask (ship / interior areas) instead of the bounds rectangle. */
  maskPainter: ((g: Graphics) => void) | null = null;
  private alpha = 0;

  constructor(
    private readonly r: GameRenderer,
    lights: LightSystem,
  ) {
    // the ship set and the cards share one sorted container: things in other rooms hide behind floors and walls
    this.albedoRoot.addChild(this.back.a, this.ship.a);
    this.normalRoot.addChild(this.back.n, this.ship.n);
    this.ship.a.sortableChildren = true;
    this.ship.n.sortableChildren = true;
    r.albedo.root.addChild(this.albedoRoot);
    r.normal.root.addChild(this.normalRoot);
    r.mask.root.addChild(this.mask);
    // unlit things go between the composite and the HUD
    r.final.root.addChildAt(this.unlitRoot, 1);
    for (let i = 0; i < LIGHTS; i++) {
      this.lights.push(
        lights.add({
          space: 'world',
          x: 0,
          y: 0,
          color: [1, 0.7, 0.4],
          intensity: 0,
          radius: 140,
          height: 20,
          cone: null,
          scatter: 0,
          occluded: false,
          enabled: false,
        }),
      );
    }
    this.setAlpha(0);
  }

  /** A new card on the back layer (walls, floors: drawn first, in order) or among the sorted cards. */
  add(frame: SheetFrame, layer: StageLayer = 'cards', ppm = 16, kind: CardKind = 'lit', split: CardSplit | null = null): Card {
    const c = layer === 'back' ? this.back : this.ship;
    const card = new Card(frame, { albedo: c.a, normal: c.n, unlit: this.unlitRoot }, ppm, kind, split);
    this.cards.push(card);
    return card;
  }

  /** The card throws a planar shadow on the floor (from `shadowLight`). */
  shadow(card: Card, frame: SheetFrame): void {
    const mesh = new PerspectiveMesh({ texture: frame.texture, verticesX: 4, verticesY: 4 });
    mesh.tint = 0x000000;
    mesh.alpha = 0.42;
    // on the floor of the room: after the ship, before the room's cards
    mesh.zIndex = ROOM_BAND - 1000;
    this.ship.a.addChild(mesh);
    this.shadows.push({ card, mesh });
  }

  /** Removes every card, shadow and light use (a new scene is built). */
  clear(): void {
    for (const c of this.cards) c.destroy();
    this.cards.length = 0;
    for (const s of this.shadows) s.mesh.destroy();
    this.shadows.length = 0;
    for (const l of this.lights) l.enabled = false;
    this.shadowLight = null;
    this.maskPainter = null;
  }

  get active(): boolean {
    return this.alpha > 0.001;
  }

  /** Cross-fade between the 2D ship (0) and the scene (1). */
  setAlpha(a: number): void {
    this.alpha = a;
    const show = a > 0.001;
    for (const c of [this.albedoRoot, this.normalRoot, this.unlitRoot, this.mask]) {
      c.visible = show;
      c.alpha = a;
    }
    const ship = 1 - a;
    for (const p of [this.r.albedo, this.r.normal, this.r.mask, this.r.final]) {
      p.ship.alpha = ship;
      p.ship.visible = ship > 0.001;
    }
    // the 2D ship's lights go out with it (the scene has its own)
    this.r.light.ship.alpha = ship;
    this.r.light.ship.visible = ship > 0.001;
    if (!show) for (const l of this.lights) l.enabled = false;
  }

  update(): void {
    if (!this.active) return;
    const cam = this.camera;
    cam.update();
    for (const c of this.cards) c.update(cam);
    // planar shadows: every corner projected along the ray from the light onto the floor
    const L = this.shadowLight;
    for (const s of this.shadows) {
      const c = s.card;
      // only the room's cards (sorted by depth) throw shadows on its floor
      if (!L || !c.visible || c.alpha < 0.5 || c.order !== null) {
        s.mesh.visible = false;
        continue;
      }
      const pts = c.corners().map((p) => {
        if (p.y >= this.floorY - 0.001 || p.y <= L.y + 0.05) return p.y >= this.floorY - 0.001 ? { ...p, y: this.floorY } : null;
        const t = (this.floorY - L.y) / (p.y - L.y);
        const q = { x: L.x + (p.x - L.x) * t, y: this.floorY, z: L.z + (p.z - L.z) * t };
        // the shadow stops at the back wall
        if (q.z < this.backZ) q.z = this.backZ;
        return q;
      });
      const proj = pts.map((p) => (p ? cam.project(p) : null));
      if (proj.some((p) => !p)) {
        s.mesh.visible = false;
        continue;
      }
      const q = proj as { x: number; y: number }[];
      s.mesh.visible = true;
      s.mesh.setCorners(q[0]!.x, q[0]!.y, q[1]!.x, q[1]!.y, q[2]!.x, q[2]!.y, q[3]!.x, q[3]!.y);
    }
    // mask: the scene area counts as ship (interior: no fog, interior ambient)
    const b = this.bounds;
    this.mask.clear();
    if (this.maskPainter) this.maskPainter(this.mask);
    else if (b.w > 0) this.mask.rect(b.x, b.y, b.w, b.h).fill(this.interior ? 0xffff00 : 0xff0000);
  }

  /** Puts a stage light at a scene point (converted to world px for the light system). */
  placeLight(i: number, p: Vec3, color: [number, number, number], intensity: number, radius: number): void {
    const l = this.lights[i];
    if (!l) return;
    const s = this.camera.project(p);
    l.enabled = !!s && this.active;
    if (!s) return;
    l.x = s.x + this.r.viewLeft;
    l.y = s.y + this.r.viewTop;
    l.color = color;
    l.intensity = intensity * this.alpha;
    l.radius = radius;
  }

  /** Projects a scene point to screen px (null if behind the camera). */
  toScreen(p: Vec3): { x: number; y: number } | null {
    return this.camera.project(p);
  }
}
