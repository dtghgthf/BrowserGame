import { TILE_SIZE } from '../constants';
import type { Vec2 } from '../math';

/** Classification of a single map tile. */
export const TileKind = {
  Exterior: 0,
  Interior: 1,
  Solid: 2,
  Hatch: 3,
} as const;
export type TileKind = (typeof TileKind)[keyof typeof TileKind];

/** Axis-aligned rectangle in tile units. */
export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Line segment in tile units (used as light occluder). */
export interface TileSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface LadderDef {
  id: number;
  /** Column of the ladder. */
  tx: number;
  /** First (highest) row that is climbable; equals the hatch row if the ladder goes through a hatch. */
  top: number;
  /** Last (lowest) row of the ladder, inclusive. */
  bottom: number;
  hatchId: number | null;
}

export interface HatchDef {
  id: number;
  tx: number;
  ty: number;
  width: number;
  hasLadder: boolean;
  /** Compartment above the hatch, or -1 if it opens to the exterior. */
  above: number;
  /** Compartment below the hatch, or -1. */
  below: number;
}

/** A vertical run of interior tiles of one compartment in one column (rows inclusive). */
export interface CompartmentSpan {
  tx: number;
  top: number;
  bottom: number;
}

export interface CompartmentDef {
  id: number;
  name: string;
  spans: CompartmentSpan[];
  minTx: number;
  maxTx: number;
  minTy: number;
  maxTy: number;
  /** Maximum water volume in m^2 (2D "volume" = area). */
  capacity: number;
}

export type MarkerType =
  | 'spawn'
  | 'wheel'
  | 'pump'
  | 'searchlight'
  | 'cannon'
  | 'workshop'
  | 'lantern'
  | 'crate'
  | 'barrel'
  | 'plank'
  | 'leak'
  | 'rack'
  | 'oilcan'
  | 'bucket';

export interface MarkerDef {
  type: MarkerType;
  tx: number;
  ty: number;
}

export interface LeakPointDef {
  id: number;
  /** The solid hull tile that can break. */
  tx: number;
  ty: number;
  /** Interior compartment the water flows into. */
  compartment: number;
  /** Unit direction pointing from the hull into the interior. */
  inward: Vec2;
}

export interface ShipLayout {
  width: number;
  height: number;
  tileSize: number;
  /** Ship pivot in tile coordinates. Ship-local meters are measured from here. */
  origin: Vec2;
  tiles: Uint8Array;
  ladderMask: Uint8Array;
  /** Solid tiles that are railings: they collide but do not occlude light. */
  railMask: Uint8Array;
  /** Compartment id per tile, -1 if none. */
  compartmentOf: Int16Array;
  /** Merged solid rectangles (hatches excluded). */
  solidRects: TileRect[];
  /** Static light occluder edges (hatches excluded, they are dynamic). */
  occluders: TileSegment[];
  ladders: LadderDef[];
  hatches: HatchDef[];
  compartments: CompartmentDef[];
  markers: MarkerDef[];
  leakPoints: LeakPointDef[];
}

const MARKERS: Record<string, MarkerType> = {
  '@': 'spawn',
  w: 'wheel',
  p: 'pump',
  s: 'searchlight',
  c: 'cannon',
  k: 'workshop',
  l: 'lantern',
  b: 'crate',
  f: 'barrel',
  n: 'plank',
  x: 'leak',
  u: 'rack',
  o: 'oilcan',
  e: 'bucket',
};

export interface ParseOptions {
  origin: Vec2;
  compartmentNames?: readonly { name: string; tx: number; ty: number }[];
  tileSize?: number;
}

/** Parses an ASCII ship map into all derived gameplay geometry. Pure function, no side effects. */
export function parseLayout(map: readonly string[], options: ParseOptions): ShipLayout {
  const height = map.length;
  const width = Math.max(...map.map((r) => r.length));
  const tileSize = options.tileSize ?? TILE_SIZE;
  const tiles = new Uint8Array(width * height);
  const ladderMask = new Uint8Array(width * height);
  const railMask = new Uint8Array(width * height);
  const markers: MarkerDef[] = [];
  const idx = (x: number, y: number) => y * width + x;
  const charAt = (x: number, y: number) => map[y]?.[x] ?? ' ';

  // 1) raw classification: solid / hatch / air
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = charAt(x, y);
      const i = idx(x, y);
      if (c === '#' || c === 'x' || c === '|') tiles[i] = TileKind.Solid;
      else if (c === '=') tiles[i] = TileKind.Hatch;
      else tiles[i] = TileKind.Exterior; // refined by the flood fill below
      if (c === 'H') ladderMask[i] = 1;
      if (c === '|') railMask[i] = 1;
      const marker = MARKERS[c];
      if (marker) markers.push({ type: marker, tx: x, ty: y });
    }
  }

  // 2) flood fill exterior from the border; every unreached air tile is interior.
  const isAir = (x: number, y: number) => tiles[idx(x, y)] === TileKind.Exterior;
  const reached = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let x = 0; x < width; x++) {
    stack.push(x, 0, x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    stack.push(0, y, width - 1, y);
  }
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const i = idx(x, y);
    if (reached[i] || !isAir(x, y)) continue;
    reached[i] = 1;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === TileKind.Exterior && !reached[i]) tiles[i] = TileKind.Interior;
  }

  // 3) compartments = 4-connected interior regions
  const compartmentOf = new Int16Array(width * height).fill(-1);
  const compartments: CompartmentDef[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = idx(x, y);
      if (tiles[start] !== TileKind.Interior || compartmentOf[start] !== -1) continue;
      const id = compartments.length;
      const cells: number[] = [];
      const st = [start];
      compartmentOf[start] = id;
      while (st.length) {
        const i = st.pop()!;
        cells.push(i);
        const cx = i % width;
        const cy = (i - cx) / width;
        for (const [nx, ny] of [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ] as const) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = idx(nx, ny);
          if (tiles[ni] === TileKind.Interior && compartmentOf[ni] === -1) {
            compartmentOf[ni] = id;
            st.push(ni);
          }
        }
      }
      compartments.push(buildCompartment(id, cells, width, compartmentOf, tileSize));
    }
  }
  for (const n of options.compartmentNames ?? []) {
    const c = compartmentOf[idx(n.tx, n.ty)];
    if (c !== undefined && c >= 0) compartments[c]!.name = n.name;
  }

  // 4) hatches: horizontal runs of hatch tiles
  const hatches: HatchDef[] = [];
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      if (tiles[idx(x, y)] !== TileKind.Hatch) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < width && tiles[idx(x, y)] === TileKind.Hatch) x++;
      const w = x - x0;
      let hasLadder = false;
      for (let k = x0; k < x0 + w; k++) if (y + 1 < height && ladderMask[idx(k, y + 1)]) hasLadder = true;
      const above = y > 0 ? compartmentOf[idx(x0, y - 1)]! : -1;
      const below = y + 1 < height ? compartmentOf[idx(x0, y + 1)]! : -1;
      hatches.push({ id: hatches.length, tx: x0, ty: y, width: w, hasLadder, above, below });
    }
  }

  // 5) ladders: vertical runs of ladder tiles, extended up through a hatch directly above
  const ladders: LadderDef[] = [];
  for (let x = 0; x < width; x++) {
    let y = 0;
    while (y < height) {
      if (!ladderMask[idx(x, y)]) {
        y++;
        continue;
      }
      const y0 = y;
      while (y < height && ladderMask[idx(x, y)]) y++;
      let top = y0;
      let hatchId: number | null = null;
      if (y0 > 0 && tiles[idx(x, y0 - 1)] === TileKind.Hatch) {
        top = y0 - 1;
        const h = hatches.find((hh) => hh.ty === y0 - 1 && x >= hh.tx && x < hh.tx + hh.width);
        hatchId = h ? h.id : null;
      }
      ladders.push({ id: ladders.length, tx: x, top, bottom: y - 1, hatchId });
    }
  }

  // 6) leak points: solid tiles marked 'x', water flows into the adjacent interior tile
  const leakPoints: LeakPointDef[] = [];
  for (const m of markers) {
    if (m.type !== 'leak') continue;
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      const nx = m.tx + dx;
      const ny = m.ty + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const comp = compartmentOf[idx(nx, ny)]!;
      if (comp >= 0) {
        leakPoints.push({ id: leakPoints.length, tx: m.tx, ty: m.ty, compartment: comp, inward: { x: dx, y: dy } });
        break;
      }
    }
  }

  const isSolid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && tiles[idx(x, y)] === TileKind.Solid;
  const isOccluder = (x: number, y: number) => isSolid(x, y) && !railMask[idx(x, y)];

  return {
    width,
    height,
    tileSize,
    origin: { x: options.origin.x, y: options.origin.y },
    tiles,
    ladderMask,
    railMask,
    compartmentOf,
    solidRects: mergeSolidRects(width, height, isSolid),
    occluders: buildOccluders(width, height, isOccluder),
    ladders,
    hatches,
    compartments,
    markers,
    leakPoints,
  };
}

function buildCompartment(
  id: number,
  cells: number[],
  width: number,
  compartmentOf: Int16Array,
  tileSize: number,
): CompartmentDef {
  let minTx = Infinity;
  let maxTx = -Infinity;
  let minTy = Infinity;
  let maxTy = -Infinity;
  for (const i of cells) {
    const x = i % width;
    const y = (i - x) / width;
    minTx = Math.min(minTx, x);
    maxTx = Math.max(maxTx, x);
    minTy = Math.min(minTy, y);
    maxTy = Math.max(maxTy, y);
  }
  const spans: CompartmentSpan[] = [];
  for (let x = minTx; x <= maxTx; x++) {
    let y = minTy;
    while (y <= maxTy) {
      if (compartmentOf[y * width + x] !== id) {
        y++;
        continue;
      }
      const top = y;
      while (y <= maxTy && compartmentOf[y * width + x] === id) y++;
      spans.push({ tx: x, top, bottom: y - 1 });
    }
  }
  const capacity = cells.length * tileSize * tileSize;
  return { id, name: `Raum ${id + 1}`, spans, minTx, maxTx, minTy, maxTy, capacity };
}

/** Greedy merge: horizontal runs first, then stack identical runs vertically. */
function mergeSolidRects(
  width: number,
  height: number,
  isSolid: (x: number, y: number) => boolean,
): TileRect[] {
  const open = new Map<string, TileRect>();
  const done: TileRect[] = [];
  for (let y = 0; y < height; y++) {
    const runs: TileRect[] = [];
    let x = 0;
    while (x < width) {
      if (!isSolid(x, y)) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < width && isSolid(x, y)) x++;
      runs.push({ x: x0, y, w: x - x0, h: 1 });
    }
    const nextOpen = new Map<string, TileRect>();
    for (const r of runs) {
      const key = `${r.x}:${r.w}`;
      const prev = open.get(key);
      if (prev && prev.y + prev.h === y) {
        prev.h++;
        nextOpen.set(key, prev);
        open.delete(key);
      } else {
        nextOpen.set(key, r);
      }
    }
    for (const r of open.values()) done.push(r);
    open.clear();
    for (const [k, v] of nextOpen) open.set(k, v);
  }
  for (const r of open.values()) done.push(r);
  return done.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Boundary edges between solid and non-solid tiles, merged into maximal collinear segments. */
function buildOccluders(
  width: number,
  height: number,
  isSolid: (x: number, y: number) => boolean,
): TileSegment[] {
  const segs: TileSegment[] = [];
  // horizontal edges: top faces (air above) and bottom faces (air below)
  for (let y = 0; y <= height; y++) {
    for (const face of ['top', 'bottom'] as const) {
      let x = 0;
      while (x < width) {
        const solidRow = face === 'top' ? y : y - 1;
        const airRow = face === 'top' ? y - 1 : y;
        const edge = (xx: number) => isSolid(xx, solidRow) && !isSolid(xx, airRow);
        if (!edge(x)) {
          x++;
          continue;
        }
        const x0 = x;
        while (x < width && edge(x)) x++;
        segs.push({ ax: x0, ay: y, bx: x, by: y });
      }
    }
  }
  // vertical edges
  for (let x = 0; x <= width; x++) {
    for (const face of ['left', 'right'] as const) {
      let y = 0;
      while (y < height) {
        const solidCol = face === 'left' ? x : x - 1;
        const airCol = face === 'left' ? x - 1 : x;
        const edge = (yy: number) => isSolid(solidCol, yy) && !isSolid(airCol, yy);
        if (!edge(y)) {
          y++;
          continue;
        }
        const y0 = y;
        while (y < height && edge(y)) y++;
        segs.push({ ax: x, ay: y0, bx: x, by: y });
      }
    }
  }
  return segs;
}

/** Converts tile coordinates (may be fractional) to ship-local meters. */
export function tileToLocal(layout: ShipLayout, tx: number, ty: number): Vec2 {
  return { x: (tx - layout.origin.x) * layout.tileSize, y: (ty - layout.origin.y) * layout.tileSize };
}

/** Converts ship-local meters to (fractional) tile coordinates. */
export function localToTile(layout: ShipLayout, x: number, y: number): Vec2 {
  return { x: x / layout.tileSize + layout.origin.x, y: y / layout.tileSize + layout.origin.y };
}

/** Tile kind at fractional tile coordinates (exterior outside the map). */
export function tileKindAt(layout: ShipLayout, tx: number, ty: number): TileKind {
  const x = Math.floor(tx);
  const y = Math.floor(ty);
  if (x < 0 || y < 0 || x >= layout.width || y >= layout.height) return TileKind.Exterior;
  return layout.tiles[y * layout.width + x] as TileKind;
}

/** Compartment id at ship-local position, -1 if none. */
export function compartmentAtLocal(layout: ShipLayout, x: number, y: number): number {
  const t = localToTile(layout, x, y);
  const tx = Math.floor(t.x);
  const ty = Math.floor(t.y);
  if (tx < 0 || ty < 0 || tx >= layout.width || ty >= layout.height) return -1;
  return layout.compartmentOf[ty * layout.width + tx]!;
}
