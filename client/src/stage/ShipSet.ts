import { Texture, type Graphics } from 'pixi.js';
import {
  TileKind,
  compartmentSurfaceY,
  seaSurfaceY,
  shipToWorld,
  stationBuilt,
  tileToLocal,
  worldToShip,
  type CompartmentGeometry,
  type GameState,
  type ShipLayout,
  type StationState,
} from '@lw/shared';
import type { Snapshot } from '../game/snapshot';
import { frameOf, type ImageLayer, type Sheet, type SheetFrame } from '../render/assets';
import type { Camera25 } from './Camera25';
import type { Card } from './Card';
import type { Stage } from './Stage';

/** Depth of the ship: the back wall and the open (cut) front. */
export const BACK_Z = -1.6;
export const FRONT_Z = 1.3;

/** Draw orders of the fixed parts of the set (the faces sort in between). */
const ORDER_BACK = -1e7;
const ORDER_FRONT = 1e6;
/** The extruded faces are split into pieces of at most this many tiles (sorting, near plane). */
const RUN = 6;

interface Face {
  card: Card;
  /** Horizontal face (floor / ceiling) or a side wall. */
  horizontal: boolean;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Hatch this floor piece covers (hidden while the hatch is open). */
  hatch: number;
}

interface StationCards {
  st: StationState;
  parts: Card[];
  moving: Card | null;
  glow: Card | null;
}

export interface SetLantern {
  card: Card;
  flame: Card;
  /** Pivot (ship-local m) the lantern hangs from. */
  x: number;
  y: number;
  optional: boolean;
  angle: number;
  vel: number;
}

/** Which tiles are (partly) opaque in an image layer, per cell of `cell` px. */
const occupancy = new WeakMap<object, Map<number, Uint8Array>>();
function opaqueCells(tex: Texture, cell: number): ((x0: number, y0: number) => boolean) | null {
  const src = tex.source;
  let byCell = occupancy.get(src);
  if (!byCell) occupancy.set(src, (byCell = new Map()));
  let grid = byCell.get(cell);
  const w = tex.frame.width;
  const h = tex.frame.height;
  const cols = Math.ceil(w / cell);
  if (!grid) {
    const res = src.resource as CanvasImageSource | undefined;
    if (!res || typeof document === 'undefined') return null;
    try {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(res, tex.frame.x, tex.frame.y, w, h, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      grid = new Uint8Array(cols * Math.ceil(h / cell));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3]! > 8) grid[Math.floor(y / cell) * cols + Math.floor(x / cell)] = 1;
      }
    } catch {
      return null;
    }
    byCell.set(cell, grid);
  }
  const g = grid;
  return (x0, y0) => g[Math.floor(y0 / cell) * cols + Math.floor(x0 / cell)] === 1;
}

const pivot0 = (f: SheetFrame): SheetFrame => ({ ...f, pivot: { x: 0, y: 0 } });

/**
 * The whole ship as a 2.5D set: the layout's solid tiles extruded from the
 * back wall to the open front (floors, ceilings and walls as planes, the hull
 * art as the cut front face, the 2D back wall at the back), the other
 * stations, lanterns, leaks, the water in the hold and the sea along the
 * hull. The faces are drawn back to front in an order that is recomputed from
 * the camera every frame (the grid of an extruded tile map can be sorted
 * exactly: by distance from the eye's row, then from its column).
 */
export class ShipSet {
  private readonly faces: Face[] = [];
  private readonly stations: StationCards[] = [];
  readonly lanterns: SetLantern[] = [];
  private readonly leaks = new Map<number, Card>();
  private readonly sea: { side: Card; x: number }[] = [];
  private readonly water: { geom: CompartmentGeometry; chunks: { x: number; w: number; bottom: number; top: number; front: Card; surf: Card }[] }[] = [];
  private readonly white: SheetFrame;
  /** The station's room (ship-local m): cards inside it sort by depth, the rest like the ship's faces. */
  room = { x0: 0, x1: 0, top: 0, bottom: 0 };
  private eye = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly stage: Stage,
    private readonly L: ShipLayout,
    private readonly assets: { hull: ImageLayer; back: ImageLayer; props: Sheet },
    state: GameState,
    focusStation: number | null,
    waterGeometry: readonly CompartmentGeometry[],
  ) {
    this.white = { name: 'white', texture: Texture.WHITE, normal: null, layers: {}, width: 1, height: 1, pivot: { x: 0, y: 0 }, duration: 100 };
    const origin = tileToLocal(L, 0, 0);
    // the back wall: the 2D background art (rooms, ladders, the far railing, the mast)
    this.image(assets.back, BACK_Z, ORDER_BACK, 32, origin);
    // the cut front: the hull art
    this.image(assets.hull, FRONT_Z, ORDER_FRONT, 16, origin);
    this.extrude();
    for (const st of state.stations) if (st.id !== focusStation && st.kind !== 'table') this.stations.push(this.station(st));
    this.buildLanterns();
    this.buildWater(waterGeometry);
    this.buildSea();
  }

  private frame(name: string): SheetFrame {
    return frameOf(this.assets.props, name);
  }

  private image(layer: ImageLayer, z: number, order: number, cell: number, origin: { x: number; y: number }): void {
    const f: SheetFrame = { name: 'layer', texture: layer.texture, normal: layer.normal, layers: {}, width: layer.texture.frame.width, height: layer.texture.frame.height, pivot: { x: 0, y: 0 }, duration: 100 };
    const has = opaqueCells(layer.texture, cell);
    const c = this.stage.add(f, 'ship', 16, 'lit', { cell, keep: has ? (x0, y0) => has(x0, y0) : undefined });
    c.pos = { x: origin.x, y: origin.y, z };
    c.order = order;
  }

  // ---------------------------------------------------------------- extrusion

  private solid(tx: number, ty: number): boolean {
    const L = this.L;
    if (tx < 0 || ty < 0 || tx >= L.width || ty >= L.height) return false;
    const i = ty * L.width + tx;
    const k = L.tiles[i];
    if (k === TileKind.Hatch) return true;
    if (k !== TileKind.Solid) return false;
    if (L.railMask[i] !== 1) return true;
    // a railing is only a floor (the crow's nest): posts and rails stay flat in the art
    const below = ty + 1 < L.height ? L.tiles[i + L.width] : TileKind.Exterior;
    return below !== TileKind.Solid && below !== TileKind.Hatch;
  }

  private kindAt(tx: number, ty: number): number {
    const L = this.L;
    if (tx < 0 || ty < 0 || tx >= L.width || ty >= L.height) return TileKind.Exterior;
    return L.tiles[ty * L.width + tx]!;
  }

  private hatchAt(tx: number, ty: number): number {
    return this.L.hatches.findIndex((h) => ty === h.ty && tx >= h.tx && tx < h.tx + h.width);
  }

  private extrude(): void {
    const L = this.L;
    const ts = L.tileSize;
    const depth = FRONT_Z - BACK_Z;
    // floors (top faces) and ceilings (bottom faces): horizontal runs of exposed solid tiles
    for (const top of [true, false]) {
      for (let ty = 0; ty < L.height; ty++) {
        let tx = 0;
        while (tx < L.width) {
          const exposed = (x: number) => this.solid(x, ty) && !this.solid(x, top ? ty - 1 : ty + 1) && (top || this.kindAt(x, ty + 1) === TileKind.Interior);
          if (!exposed(tx)) {
            tx++;
            continue;
          }
          const hatch = this.hatchAt(tx, ty);
          const outside = top && this.kindAt(tx, ty - 1) === TileKind.Exterior;
          let end = tx + 1;
          while (end < L.width && end - tx < RUN && exposed(end) && this.hatchAt(end, ty) === hatch && (top && this.kindAt(end, ty - 1) === TileKind.Exterior) === outside) end++;
          const f = pivot0(this.frame(top ? (outside ? 'st_deck' : 'st_floor') : 'st_ceiling'));
          const c = this.stage.add(f, 'ship', 32, 'lit', { cell: 32 });
          const a = tileToLocal(L, tx, top ? ty : ty + 1);
          c.pos = { x: a.x, y: a.y, z: BACK_Z };
          c.u = { x: 1, y: 0, z: 0 };
          c.v = { x: 0, y: 0, z: 1 };
          c.scaleX = ((end - tx) * ts) / (f.width / 32);
          c.scaleY = depth / (f.height / 32);
          if (!top) c.tint = 0x8a8a8a;
          this.faces.push({ card: c, horizontal: true, x0: a.x, x1: a.x + (end - tx) * ts, y0: a.y, y1: a.y, hatch });
          tx = end;
        }
      }
    }
    // walls: vertical runs of solid tiles with air on one side
    for (const dir of [-1, 1]) {
      for (let tx = 0; tx < L.width; tx++) {
        let ty = 0;
        while (ty < L.height) {
          const visible = (y: number) => this.solid(tx, y) && !this.solid(tx + dir, y);
          if (!visible(ty)) {
            ty++;
            continue;
          }
          let end = ty + 1;
          while (end < L.height && end - ty < 4 && visible(end)) end++;
          const f = pivot0(this.frame('st_ceiling'));
          const c = this.stage.add(f, 'ship', 32, 'lit', { cell: 32, cellY: f.height });
          const a = tileToLocal(L, dir < 0 ? tx : tx + 1, ty);
          c.pos = { x: a.x, y: a.y, z: FRONT_Z };
          c.u = { x: 0, y: 0, z: -1 };
          c.v = { x: 0, y: 1, z: 0 };
          c.scaleX = depth / (f.width / 32);
          c.scaleY = ((end - ty) * ts) / (f.height / 32);
          c.tint = 0x707070;
          this.faces.push({ card: c, horizontal: false, x0: a.x, x1: a.x, y0: a.y, y1: a.y + (end - ty) * ts, hatch: -1 });
          ty = end;
        }
      }
    }
  }

  // ---------------------------------------------------------------- furniture

  /** The other stations, as their 2D sprites standing in the middle of the ship. */
  private station(st: StationState): StationCards {
    const parts: Card[] = [];
    const add = (name: string, dx: number, dy: number) => {
      const c = this.stage.add(this.frame(name), 'cards', 16);
      c.pos = { x: st.x + dx / 16, y: st.y + dy / 16, z: 0 };
      parts.push(c);
      return c;
    };
    let moving: Card | null = null;
    let glow: Card | null = null;
    switch (st.kind) {
      case 'wheel':
        add('helm', 8, 0);
        moving = add('wheel', 8, -10);
        break;
      case 'pump':
        add('pump', 7, 0);
        moving = add('pump_handle', 7, -15);
        break;
      case 'searchlight':
        add('searchlight_base', -5, 0);
        moving = add('searchlight_head', -5, -12);
        glow = this.stage.add(this.frame('searchlight_glow'), 'cards', 16, 'unlit');
        glow.pos = { ...moving.pos };
        break;
      case 'cannon':
        add('cannon_carriage', 8, 0);
        moving = add('cannon', 6, -6);
        break;
      case 'workshop':
        add('workbench', 0, 0);
        break;
      case 'rack':
        add('ball_rack', 0, 0);
        break;
      case 'ring':
        add('ring_post', 0, 0);
        break;
      default:
        break;
    }
    if (moving) moving.bias = 0.01;
    return { st, parts, moving, glow };
  }

  private buildLanterns(): void {
    for (const m of this.L.markers) {
      if (m.type !== 'lantern' && m.type !== 'lantern2') continue;
      const p = tileToLocal(this.L, m.tx + 0.5, m.ty);
      const card = this.stage.add(this.frame('lantern'), 'cards', 16);
      card.pos = { x: p.x, y: p.y, z: 0.4 };
      const flame = this.stage.add(this.frame('lantern_flame'), 'cards', 16, 'unlit');
      flame.pos = { x: p.x, y: p.y, z: 0.41 };
      this.lanterns.push({ card, flame, x: p.x, y: p.y, optional: m.type === 'lantern2', angle: 0, vel: 0 });
    }
  }

  /** Water in the compartments: a front face and the surface, in ~1 m chunks of the compartment's columns. */
  private buildWater(geoms: readonly CompartmentGeometry[]): void {
    for (const geom of geoms) {
      const chunks: (typeof this.water)[number]['chunks'] = [];
      let i = 0;
      while (i < geom.columns.length) {
        const first = geom.columns[i]!;
        let j = i;
        let bottom = -Infinity;
        let top = Infinity;
        while (j < geom.columns.length && geom.columns[j]!.x - first.x < 1) {
          for (const s of geom.columns[j]!.spans) {
            bottom = Math.max(bottom, s.bottom);
            top = Math.min(top, s.top);
          }
          j++;
        }
        const x = first.x - geom.colWidth / 2;
        const w = geom.columns[j - 1]!.x + geom.colWidth / 2 - x;
        const front = this.stage.add(this.white, 'cards', 1, 'unlit');
        front.tint = 0x2a6aa0;
        front.bias = -0.3;
        const surf = this.stage.add(this.white, 'cards', 1, 'unlit');
        surf.tint = 0x5a9ac8;
        surf.u = { x: 1, y: 0, z: 0 };
        surf.v = { x: 0, y: 0, z: 1 };
        surf.bias = -0.3;
        chunks.push({ x, w, bottom, top, front, surf });
        i = j;
      }
      this.water.push({ geom, chunks });
    }
  }

  /**
   * The sea behind the ship: a curtain hanging from the waves just behind the
   * back wall, so the hull's waterline meets the sea. The front stays open
   * like the 2D cross-section.
   */
  private buildSea(): void {
    const L = this.L;
    const x0 = tileToLocal(L, -40, 0).x;
    const x1 = tileToLocal(L, L.width + 40, 0).x;
    for (let x = x0; x < x1; x += 1) {
      const side = this.stage.add(this.white, 'back', 1);
      side.tint = 0x10263c;
      this.sea.push({ side, x });
    }
  }

  // ---------------------------------------------------------------- per frame

  /** Draw order of something spanning x0..x1, y0..y1 (ship-local m): far from the eye's height first, then far from its column. */
  private key(x0: number, x1: number, y0: number, y1: number): number {
    const e = this.eye;
    const ry = Math.abs(Math.max(y0, Math.min(y1, e.y)) - e.y);
    const rx = Math.abs(Math.max(x0, Math.min(x1, e.x)) - e.x);
    return -(ry * 1000 + rx * 10);
  }

  /** Draw order of a card standing at (x, feet y) with this size: null = in the room (sorted by depth). */
  orderFor(x: number, y: number, w: number, h: number): number | null {
    const r = this.room;
    if (x > r.x0 - 0.3 && x < r.x1 + 0.3 && y > r.top && y < r.bottom + 0.3) return null;
    // a little in front of the faces of its own row (it stands on the floor, in front of the wall behind)
    return this.key(x - w / 2, x + w / 2, y - h, y) + 5;
  }

  update(state: GameState, view: Snapshot, cam: Camera25, time: number, dt: number): void {
    this.eye = cam.eyeScene();
    const hatches = state.hatches;
    for (const f of this.faces) {
      f.card.order = this.key(f.x0, f.x1, f.y0, f.y1);
      f.card.visible = f.hatch < 0 || !hatches[f.hatch]?.open;
    }
    // the other stations move like in 2D
    for (const sc of this.stations) {
      const built = stationBuilt(sc.st, state.campaign);
      for (const p of sc.parts) p.visible = built;
      const st = state.stations[sc.st.id]!;
      const v = view.stations[st.id]?.value ?? st.value;
      if (sc.moving) {
        sc.moving.rotation = st.kind === 'wheel' ? v * Math.PI * 1.5 : st.kind === 'pump' ? v * 0.45 : v;
      }
      if (sc.glow && sc.moving) {
        sc.glow.rotation = v;
        sc.glow.alpha = st.charge <= 0 ? 0 : st.charge < 0.15 ? (Math.sin(time * 23) > -0.2 ? 0.75 : 0.15) : 1;
      }
      if (st.kind === 'ring') sc.parts[0]!.setFrame(this.frame(state.ring ? 'ring_post_empty' : 'ring_post'));
      const o = this.orderFor(st.x, st.y, 1.5, 2);
      for (const p of sc.parts) p.order = o;
      if (sc.glow) sc.glow.order = o;
    }
    // lanterns swing with the apparent gravity
    const g = state.ship.gravity;
    const eq = Math.atan2(g.x, g.y);
    const step = Math.min(dt, 1 / 30);
    const extra = state.campaign.upgrades.includes('lantern');
    for (const l of this.lanterns) {
      const on = !l.optional || extra;
      l.card.visible = on;
      l.flame.visible = on;
      const acc = -(9.81 / 0.55) * Math.sin(l.angle - eq) - 0.7 * l.vel;
      l.vel += acc * step;
      l.angle += l.vel * step;
      l.card.rotation = -l.angle;
      l.flame.rotation = -l.angle;
      l.flame.alpha = 0.8 + 0.2 * Math.sin(time * 9 + l.x);
      // the lantern hangs below the ceiling: it belongs to the room under it
      l.card.order = this.orderFor(l.x, l.y + 0.8, 0.5, 0.8);
    }
    this.updateLeaks(state);
    this.updateWater(state);
    this.updateSea(state, view);
  }

  private updateLeaks(state: GameState): void {
    const seen = new Set<number>();
    for (const leak of state.leaks) {
      seen.add(leak.point);
      const lp = this.L.leakPoints[leak.point];
      if (!lp) continue;
      let c = this.leaks.get(leak.point);
      const f = pivot0(this.frame(leak.active ? 'leak' : 'patch'));
      if (!c) {
        c = this.stage.add(f, 'ship', 16);
        const p = tileToLocal(this.L, lp.tx, lp.ty);
        c.pos = { x: p.x, y: p.y, z: FRONT_Z + 0.01 };
        c.order = ORDER_FRONT + 1;
        this.leaks.set(leak.point, c);
      }
      c.setFrame(f);
    }
    for (const [point, c] of this.leaks) c.visible = seen.has(point);
  }

  private updateWater(state: GameState): void {
    this.water.forEach((w, i) => {
      const comp = state.compartments[i];
      const wet = !!comp && comp.volume > 0.02;
      for (const ch of w.chunks) {
        const surface = wet ? Math.max(ch.top, compartmentSurfaceY(w.geom, comp!, ch.x + ch.w / 2)) : ch.bottom;
        const h = ch.bottom - surface;
        const show = wet && h > 0.02;
        ch.front.visible = ch.surf.visible = show;
        if (!show) continue;
        ch.front.pos = { x: ch.x, y: surface, z: FRONT_Z - 0.04 };
        ch.front.scaleX = ch.w;
        ch.front.scaleY = h;
        ch.front.alpha = 0.55;
        ch.surf.pos = { x: ch.x, y: surface, z: BACK_Z };
        ch.surf.scaleX = ch.w;
        ch.surf.scaleY = FRONT_Z - 0.04 - BACK_Z;
        ch.surf.alpha = 0.4;
      }
    });
  }

  /** The sea is level in the world: its points are placed in ship coordinates through the roll and heave. */
  private updateSea(state: GameState, view: Snapshot): void {
    const ship = view.ship;
    const roll = ship.roll;
    // world axes in ship-local coordinates
    const ux = { x: Math.cos(roll), y: -Math.sin(roll) };
    const vx = { x: Math.sin(roll), y: Math.cos(roll) };
    for (const s of this.sea) {
      const w = shipToWorld(ship, { x: s.x, y: 0 });
      const surf = seaSurfaceY(w.x, view.time, state.ship.seaState);
      const p = worldToShip(ship, { x: w.x, y: surf });
      s.side.pos = { x: p.x, y: p.y, z: BACK_Z - 0.4 };
      s.side.u = { x: ux.x, y: ux.y, z: 0 };
      s.side.v = { x: vx.x, y: vx.y, z: 0 };
      s.side.scaleX = 1.04;
      s.side.scaleY = 30;
    }
  }

  /** The ship's areas in the mask pass (r = ship, g = interior), projected like the set. */
  paintMask(g: Graphics, cam: Camera25): void {
    const L = this.L;
    for (let ty = 0; ty < L.height; ty++) {
      let tx = 0;
      while (tx < L.width) {
        const k = this.kindAt(tx, ty);
        if (k === TileKind.Exterior) {
          tx++;
          continue;
        }
        const inside = k === TileKind.Interior;
        let end = tx + 1;
        while (end < L.width && this.kindAt(end, ty) !== TileKind.Exterior && (this.kindAt(end, ty) === TileKind.Interior) === inside) end++;
        const a = tileToLocal(L, tx, ty);
        const b = tileToLocal(L, end, ty + 1);
        const color = inside ? 0xffff00 : 0xff0000;
        for (const z of [BACK_Z, FRONT_Z]) {
          const q = [cam.project({ x: a.x, y: a.y, z }), cam.project({ x: b.x, y: a.y, z }), cam.project({ x: b.x, y: b.y, z }), cam.project({ x: a.x, y: b.y, z })];
          if (q.some((p) => !p)) continue;
          g.poly(q.flatMap((p) => [p!.x, p!.y])).fill(color);
        }
        // the top of the run between the two (visible from above)
        const t = [cam.project({ x: a.x, y: a.y, z: BACK_Z }), cam.project({ x: b.x, y: a.y, z: BACK_Z }), cam.project({ x: b.x, y: a.y, z: FRONT_Z }), cam.project({ x: a.x, y: a.y, z: FRONT_Z })];
        if (!t.some((p) => !p)) g.poly(t.flatMap((p) => [p!.x, p!.y])).fill(color);
        tx = end;
      }
    }
  }
}
