import type { Vec2 } from '../math';
import { TileKind, parseLayout, type ShipLayout } from './parseLayout';
import { COMPARTMENT_NAMES, SHIP_MAP, SHIP_ORIGIN } from './shipMap';

/**
 * A ship as data: the ASCII map (same legend as `shipMap.ts`) and a name.
 * Ships from the editor travel as a short text code (run-length encoded,
 * base64url) in links and when a room is opened - no server storage.
 */
export interface ShipDesign {
  name: string;
  map: string[];
  /**
   * Tiles where the automatic background decoration is switched off (purely
   * visual): a mast, crow's nest or deck railing drawn there is left out.
   */
  decorOff?: { tx: number; ty: number }[];
}

export const DESIGN_LIMITS = { minWidth: 24, maxWidth: 96, minHeight: 12, maxHeight: 32, maxName: 24 } as const;

/** Every character the editor may place. */
export const DESIGN_CHARS = ' .#|=Hx@wpsckulbfnoertCL';

export interface DesignIssue {
  level: 'error' | 'warning';
  message: string;
  /** Tiles to highlight in the editor. */
  tiles?: { tx: number; ty: number }[];
}

export const DEFAULT_DESIGN: ShipDesign = { name: 'Leuchtturmwärter', map: [...SHIP_MAP] };

/** Same rows as the default ship? (Then the hand-made art is used.) */
export function isDefaultDesign(d: ShipDesign): boolean {
  return d.map.length === SHIP_MAP.length && d.map.every((r, i) => r === SHIP_MAP[i]);
}

/** Pads every row to the same width with exterior air. */
export function normalizeDesign(d: ShipDesign): ShipDesign {
  const width = Math.max(0, ...d.map.map((r) => r.length));
  const out: ShipDesign = { name: d.name.slice(0, DESIGN_LIMITS.maxName), map: d.map.map((r) => r.padEnd(width, ' ')) };
  // decoration switches: inside the map, each tile once, in reading order (stable link codes)
  const seen = new Set<number>();
  const off = (d.decorOff ?? []).filter((t) => {
    const k = t.ty * width + t.tx;
    if (!Number.isInteger(t.tx) || !Number.isInteger(t.ty) || t.tx < 0 || t.ty < 0 || t.tx >= width || t.ty >= d.map.length || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (off.length) out.decorOff = off.sort((a, b) => a.ty * width + a.tx - (b.ty * width + b.tx)).slice(0, 255).map((t) => ({ tx: t.tx, ty: t.ty }));
  return out;
}

/**
 * Pivot (rest waterline) of a design: the row where about 40 % of the hull
 * body lies below, horizontally the middle of the hull. Masts and things on
 * deck count little because only rows with a wide hull are the body.
 */
export function designOrigin(map: readonly string[]): Vec2 {
  const h = map.length;
  const rowCount = map.map((r) => [...r].filter((c) => c !== ' ').length);
  const widest = Math.max(1, ...rowCount);
  // body rows: at least 40 % of the widest row
  const body = rowCount.map((n) => (n >= widest * 0.4 ? n : 0));
  const total = body.reduce((a, b) => a + b, 0);
  let below = 0;
  let y = h;
  for (let row = h - 1; row >= 0; row--) {
    if (below + body[row]! >= total * 0.4) {
      const need = total * 0.4 - below;
      y = row + 1 - need / Math.max(1, body[row]!);
      break;
    }
    below += body[row]!;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  for (const r of map) {
    for (let x = 0; x < r.length; x++) {
      if (r[x] === ' ') continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }
  const cx = Number.isFinite(minX) ? (minX + maxX + 1) / 2 : map[0]?.length ?? 0 / 2;
  return { x: Math.round(cx * 2) / 2, y: Math.round(y * 2) / 2 };
}

/** The simulation layout of a design (the default ship keeps its hand-tuned pivot and room names). */
export function layoutFromDesign(d: ShipDesign): ShipLayout {
  if (isDefaultDesign(d)) return parseLayout(SHIP_MAP, { origin: SHIP_ORIGIN, compartmentNames: COMPARTMENT_NAMES });
  const n = normalizeDesign(d);
  const layout = parseLayout(n.map, { origin: designOrigin(n.map) });
  // rooms are named from the top down
  const order = [...layout.compartments].sort((a, b) => a.minTy - b.minTy);
  order.forEach((c, i) => (c.name = `Deck ${i + 1}`));
  return layout;
}

function markers(map: readonly string[], ch: string): { tx: number; ty: number }[] {
  const out: { tx: number; ty: number }[] = [];
  map.forEach((r, ty) => {
    for (let tx = 0; tx < r.length; tx++) if (r[tx] === ch) out.push({ tx, ty });
  });
  return out;
}

/** Everything that would make the ship unplayable (errors) or odd (warnings), in German for the editor. */
export function validateShipDesign(design: ShipDesign): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const d = normalizeDesign(design);
  const map = d.map;
  const h = map.length;
  const w = map[0]?.length ?? 0;
  if (w < DESIGN_LIMITS.minWidth || h < DESIGN_LIMITS.minHeight) issues.push({ level: 'error', message: `Zu klein: mindestens ${DESIGN_LIMITS.minWidth} × ${DESIGN_LIMITS.minHeight} Felder.` });
  if (w > DESIGN_LIMITS.maxWidth || h > DESIGN_LIMITS.maxHeight) issues.push({ level: 'error', message: `Zu groß: höchstens ${DESIGN_LIMITS.maxWidth} × ${DESIGN_LIMITS.maxHeight} Felder.` });
  const bad: { tx: number; ty: number }[] = [];
  map.forEach((r, ty) => {
    for (let tx = 0; tx < r.length; tx++) if (!DESIGN_CHARS.includes(r[tx]!)) bad.push({ tx, ty });
  });
  if (bad.length) issues.push({ level: 'error', message: 'Unbekannte Zeichen in der Karte.', tiles: bad });
  if (issues.some((i) => i.level === 'error')) return issues;

  const layout = parseLayout(map, { origin: designOrigin(map) });
  const need = (ch: string, name: string, level: 'error' | 'warning' = 'error') => {
    if (markers(map, ch).length === 0) issues.push({ level, message: `${name} fehlt.` });
  };
  need('@', 'Startplatz (@)');
  need('w', 'Steuerrad (w)');
  need('p', 'Pumpe (p)');
  need('k', 'Werkbank (k)');
  need('s', 'Scheinwerfer (s)', 'warning');
  need('c', 'Kanone (c)', 'warning');
  need('x', 'Leckstelle (x)', 'warning');
  if (layout.compartments.length === 0) issues.push({ level: 'error', message: 'Kein Innenraum: der Rumpf muss geschlossen sein.' });

  // markers must stand on something (one tile above a floor) and in air
  const floorBelow = (tx: number, ty: number) => {
    const k = ty + 1 < h ? layout.tiles[(ty + 1) * w + tx] : TileKind.Exterior;
    return k === TileKind.Solid || k === TileKind.Hatch;
  };
  const floating: { tx: number; ty: number }[] = [];
  for (const ch of '@wpsckuobfnert') {
    for (const m of markers(map, ch)) if (!floorBelow(m.tx, m.ty)) floating.push(m);
  }
  if (floating.length) issues.push({ level: 'warning', message: 'Manches schwebt in der Luft (braucht Boden darunter).', tiles: floating });

  // leak points must sit in the hull next to a room
  const lone = markers(map, 'x').filter((m) => !layout.leakPoints.some((l) => l.tx === m.tx && l.ty === m.ty));
  if (lone.length) issues.push({ level: 'warning', message: 'Leckstelle (x) ohne Raum dahinter.', tiles: lone });

  // stations that can only be reached by flying: walkable reachability from the spawn
  const spawn = markers(map, '@')[0];
  if (spawn) {
    const unreachable = reachability(layout, spawn, map);
    if (unreachable.length) issues.push({ level: 'warning', message: 'Nicht erreichbar (Leitern fehlen?).', tiles: unreachable });
  }
  // the hull should float: some room below the waterline
  if (layout.compartments.every((c) => (c.maxTy + 1 - layout.origin.y) <= 0)) issues.push({ level: 'warning', message: 'Kein Raum unter der Wasserlinie – das Schiff kann nicht volllaufen.' });
  return issues;
}

/**
 * Tiles with a station / object marker a player cannot walk or climb to from
 * the spawn: walking along floors, ladders up and down, jumps of 2 tiles.
 */
function reachability(layout: ShipLayout, spawn: { tx: number; ty: number }, map: readonly string[]): { tx: number; ty: number }[] {
  const w = layout.width;
  const h = layout.height;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && (layout.tiles[y * w + x] === TileKind.Solid || layout.tiles[y * w + x] === TileKind.Hatch);
  const air = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && !solid(x, y);
  const ladder = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && layout.ladderMask[y * w + x] === 1;
  const hatch = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && layout.tiles[y * w + x] === TileKind.Hatch;
  const standable = (x: number, y: number) => air(x, y) && (solid(x, y + 1) || ladder(x, y));
  const seen = new Uint8Array(w * h);
  const stack: [number, number][] = [[spawn.tx, spawn.ty]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    if (x < 0 || y < 0 || x >= w || y >= h || seen[y * w + x]) continue;
    if (!air(x, y) && !hatch(x, y)) continue;
    seen[y * w + x] = 1;
    // walk left / right on the same row, step up one tile
    for (const dx of [-1, 1]) {
      if (standable(x + dx, y)) stack.push([x + dx, y]);
      else if (standable(x + dx, y - 1) && air(x, y - 1)) stack.push([x + dx, y - 1]);
      // fall off an edge
      for (let fy = y + 1; fy < h; fy++) {
        if (!air(x + dx, fy) && !hatch(x + dx, fy)) break;
        if (standable(x + dx, fy)) {
          stack.push([x + dx, fy]);
          break;
        }
      }
    }
    // jump up to two tiles onto a ledge
    for (const dy of [1, 2]) if (standable(x, y - dy) && air(x, y - dy + 1)) stack.push([x, y - dy]);
    // ladders (and open hatches with a ladder below)
    if (ladder(x, y) || ladder(x, y + 1) || hatch(x, y + 1)) {
      stack.push([x, y - 1], [x, y + 1]);
    }
  }
  const out: { tx: number; ty: number }[] = [];
  for (const ch of 'wpsckutr') {
    for (const m of markers(map, ch)) if (!seen[m.ty * w + m.tx]) out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------- sharing code

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toB64(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = i + 1 >= bytes.length ? 2 : i + 2 >= bytes.length ? 3 : 4;
    for (let k = 0; k < chars; k++) out += B64[(n >> (18 - k * 6)) & 63];
  }
  return out;
}

function fromB64(s: string): number[] | null {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const chunk = s.slice(i, i + 4);
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const c = chunk[k];
      const v = c === undefined ? 0 : B64.indexOf(c);
      if (v < 0) return null;
      n |= v << (18 - k * 6);
    }
    out.push((n >> 16) & 255);
    if (chunk.length > 2) out.push((n >> 8) & 255);
    if (chunk.length > 3) out.push(n & 255);
  }
  return out;
}

/**
 * Text code of a design: version byte, width, height, name (UTF-16 code units
 * < 256 only, the rest as '?'), then runs of (char index, length) over the
 * rows. The default ship is ~600 characters.
 */
export function encodeDesign(design: ShipDesign): string {
  const d = normalizeDesign(design);
  const w = d.map[0]?.length ?? 0;
  // version 2 carries the decoration switches after the name (version 1 when there are none: old codes stay the same)
  const off = d.decorOff ?? [];
  const bytes: number[] = [off.length ? 2 : 1, w, d.map.length];
  const name = [...d.name].map((c) => (c.charCodeAt(0) < 256 ? c.charCodeAt(0) : 63));
  bytes.push(name.length, ...name);
  if (off.length) {
    bytes.push(off.length);
    for (const t of off) bytes.push(t.tx, t.ty);
  }
  const flat = d.map.join('');
  for (let i = 0; i < flat.length; ) {
    const ch = flat[i]!;
    let run = 1;
    while (i + run < flat.length && flat[i + run] === ch && run < 255) run++;
    bytes.push(Math.max(0, DESIGN_CHARS.indexOf(ch)), run);
    i += run;
  }
  return toB64(bytes);
}

export function decodeDesign(code: string): ShipDesign | null {
  const b = fromB64(code.trim());
  if (!b || (b[0] !== 1 && b[0] !== 2) || b.length < 4) return null;
  const w = b[1]!;
  const h = b[2]!;
  if (w < 1 || h < 1 || w > DESIGN_LIMITS.maxWidth || h > DESIGN_LIMITS.maxHeight) return null;
  const nameLen = b[3]!;
  const name = String.fromCharCode(...b.slice(4, 4 + nameLen));
  let at = 4 + nameLen;
  const decorOff: { tx: number; ty: number }[] = [];
  if (b[0] === 2) {
    const n = b[at] ?? 0;
    for (let k = 0; k < n; k++) decorOff.push({ tx: b[at + 1 + k * 2] ?? 0, ty: b[at + 2 + k * 2] ?? 0 });
    at += 1 + n * 2;
  }
  let flat = '';
  for (let i = at; i + 1 < b.length; i += 2) {
    const ch = DESIGN_CHARS[b[i]!];
    if (ch === undefined) return null;
    flat += ch.repeat(b[i + 1]!);
  }
  if (flat.length < w * h) return null;
  const map: string[] = [];
  for (let y = 0; y < h; y++) map.push(flat.slice(y * w, y * w + w));
  return decorOff.length ? normalizeDesign({ name, map, decorOff }) : { name, map };
}
