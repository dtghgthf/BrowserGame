import { TileKind, type ShipLayout } from '@lw/shared';
import { Canvas, hash, hex, mix, shade, type RGBA } from './canvas';

const T = 8;

const WOOD = [hex('#3b2416'), hex('#45291a'), hex('#4f301d'), hex('#5a3822')];
const WOOD_HI = hex('#8a5c36');
const WOOD_SEAM = hex('#22140c');
const OUTLINE = hex('#140c08');
const PAINT_LOW = [hex('#5e211c'), hex('#6b2620')];
const PAINT_HIGH = [hex('#1d2129'), hex('#252a33')];
const BOOTTOP = hex('#c9b48a');

const BACK = [hex('#22160f'), hex('#271910'), hex('#2c1d13'), hex('#241810')];
const BACK_SEAM = hex('#120a06');
const BEAM = hex('#3a2416');
const BEAM_HI = hex('#53341f');
const RIB = hex('#2f1e12');
const RIB_HI = hex('#3f2818');
const LADDER = hex('#7a5232');
const LADDER_DARK = hex('#5a3a22');
const MAST = [hex('#3e2a19'), hex('#5a3e25'), hex('#6e4d2f'), hex('#5a3e25'), hex('#3e2a19')];
const METAL = hex('#3a3e46');
const ROPE = hex('#6e5b3e');
const SAIL = [hex('#9a8c6e'), hex('#b8aa8a'), hex('#d0c4a2')];
const PENNANT = hex('#a8322a');

function tileAt(layout: ShipLayout, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= layout.width || ty >= layout.height) return TileKind.Exterior;
  return layout.tiles[ty * layout.width + tx]!;
}

/**
 * Where the deck, mast, yard, crow's nest and rigging go, derived from the
 * layout (for the standard ship these are exactly its hand-placed positions).
 */
export function shipFeatures(layout: ShipLayout) {
  const solidish = (tx: number, ty: number) => {
    const k = tileAt(layout, tx, ty);
    return k === TileKind.Solid || k === TileKind.Hatch;
  };
  // the main deck: the row with the most solid tiles open to the sky
  let deckRow = 0;
  let best = -1;
  for (let ty = 1; ty < layout.height; ty++) {
    let n = 0;
    for (let tx = 0; tx < layout.width; tx++) if (solidish(tx, ty) && tileAt(layout, tx, ty - 1) === TileKind.Exterior) n++;
    if (n > best) {
      best = n;
      deckRow = ty;
    }
  }
  // deck extent (railing): columns of that row with open sky above
  let deckFrom = layout.width;
  let deckTo = -1;
  let bowCol = -1;
  for (let tx = 0; tx < layout.width; tx++) {
    if (!solidish(tx, deckRow)) continue;
    bowCol = tx;
    if (tileAt(layout, tx, deckRow - 1) !== TileKind.Exterior) continue;
    deckFrom = Math.min(deckFrom, tx);
    deckTo = Math.max(deckTo, tx);
  }
  if (deckTo < 0) {
    deckFrom = 1;
    deckTo = layout.width - 2;
  }
  // crow's nests: hatches above the deck, each platform is the run of tiles around its hatch; a mast stands under each
  // (at the ladder up to it), without any nest one mast in the middle of the deck
  const masts: { col: number; nest: { row: number; from: number; to: number } | null }[] = [];
  for (const h of layout.hatches.filter((hh) => hh.ty < deckRow).sort((a, b) => a.tx - b.tx)) {
    let a = h.tx;
    let b = h.tx + h.width - 1;
    while (solidish(a - 1, h.ty)) a--;
    while (solidish(b + 1, h.ty)) b++;
    const ladder = layout.ladders.find((l) => l.tx >= h.tx && l.tx < h.tx + h.width);
    masts.push({ col: ladder ? ladder.tx : h.tx, nest: { row: h.ty, from: a, to: b } });
  }
  if (masts.length === 0) masts.push({ col: Math.round((deckFrom + deckTo) / 2), nest: null });
  // the stern post the aft stay is tied to
  let sternTop = deckRow;
  for (let ty = 0; ty < deckRow; ty++) {
    if (solidish(deckFrom - 1, ty)) {
      sternTop = ty;
      break;
    }
  }
  const clampCol = (c: number) => Math.max(deckFrom, Math.min(deckTo, c));
  return { deckRow, deckFrom, deckTo, bowCol, masts, sternTop, clampCol };
}

/** Hull layer: every solid tile, planked, with paint on the outside of the shell. */
export function drawHull(layout: ShipLayout): Canvas {
  const W = layout.width * T;
  const H = layout.height * T;
  const c = new Canvas(W, H);
  const solidPx = (x: number, y: number) => tileAt(layout, Math.floor(x / T), Math.floor(y / T)) === TileKind.Solid;
  const exteriorPx = (x: number, y: number) => tileAt(layout, Math.floor(x / T), Math.floor(y / T)) === TileKind.Exterior;
  const waterline = Math.round(layout.origin.y * T);

  const distTo = (x: number, y: number, pred: (x: number, y: number) => boolean, max: number) => {
    for (let r = 1; r <= max; r++) {
      for (let k = -r; k <= r; k++) {
        if (pred(x + k, y - r) || pred(x + k, y + r) || pred(x - r, y + k) || pred(x + r, y + k)) return r;
      }
    }
    return max + 1;
  };

  const railPx = (x: number, y: number) => {
    const tx = Math.floor(x / T);
    const ty = Math.floor(y / T);
    return tx >= 0 && ty >= 0 && tx < layout.width && ty < layout.height && layout.railMask[ty * layout.width + tx] === 1;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!solidPx(x, y)) continue;
      if (railPx(x, y)) {
        // railing post: 2 px wide post + 1 px top rail
        const lx = x % T;
        const ly = y % T;
        if (ly === 0) c.set(x, y, WOOD_HI, 2.4);
        else if (lx === 3 || lx === 4) c.set(x, y, lx === 3 ? WOOD_HI : WOOD[1]!, 2.2);
        else if (ly === 4) c.set(x, y, WOOD[0]!, 1.6);
        continue;
      }
      const strake = Math.floor(y / 4);
      const off = Math.floor(hash(strake, 7) * 32);
      const plank = Math.floor((x + off) / 32);
      let col: RGBA = WOOD[Math.floor(hash(strake, plank) * WOOD.length)]!;
      let height = 2;
      if (y % 4 === 3) {
        col = WOOD_SEAM;
        height = 1.2;
      } else if ((x + off) % 32 === 0) {
        col = shade(WOOD_SEAM, 1.2);
        height = 1.4;
      } else if (hash(x, y, 3) < 0.04) {
        col = shade(col, 0.85); // grain
      }
      const ext = distTo(x, y, exteriorPx, 2);
      if (ext <= 2) {
        if (Math.abs(y - waterline) <= 0) col = BOOTTOP;
        else if (y > waterline) col = PAINT_LOW[(strake + plank) % 2]!;
        else col = PAINT_HIGH[(strake + plank) % 2]!;
        if (y % 4 === 3) col = shade(col, 0.7);
      }
      const air = distTo(x, y, (xx, yy) => !solidPx(xx, yy), 1);
      if (air === 1) {
        const airAbove = !solidPx(x, y - 1);
        col = airAbove ? mix(col, WOOD_HI, ext <= 2 ? 0.35 : 0.7) : OUTLINE;
        height = airAbove ? 2.2 : 1.6;
      }
      c.set(x, y, col, height);
    }
  }

  // bowsprit (decoration beyond the bow)
  const f = shipFeatures(layout);
  const bx = f.bowCol * T + 6;
  const by = (f.deckRow - 1) * T + 3;
  for (let i = 0; i < 2; i++) c.line(bx, by + i, W - 1, by - 13 + i, i === 0 ? WOOD_HI : WOOD[2]!, 2);
  return c;
}

/** Back layer: interior walls, ladders, mast, yard, rigging and railing (drawn behind players). */
export function drawBack(layout: ShipLayout): Canvas {
  const W = layout.width * T;
  const H = layout.height * T;
  const c = new Canvas(W, H);
  const kindPx = (x: number, y: number) => tileAt(layout, Math.floor(x / T), Math.floor(y / T));
  const isInteriorish = (x: number, y: number) => {
    const k = kindPx(x, y);
    return k === TileKind.Interior || k === TileKind.Hatch;
  };

  // interior back walls
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isInteriorish(x, y)) continue;
      const board = Math.floor(x / 6);
      let col: RGBA = BACK[Math.floor(hash(board, 11) * BACK.length)]!;
      let height = 1;
      if (x % 6 === 0) {
        col = BACK_SEAM;
        height = 0.4;
      } else if (hash(x >> 1, y, 5) < 0.05) col = shade(col, 0.8);
      // ribs every 10 tiles
      const tx = Math.floor(x / T);
      if (tx % 10 === 5) {
        const lx = x % T;
        if (lx >= 1 && lx <= 6) {
          col = lx === 1 ? RIB_HI : RIB;
          height = 2.2;
        }
      }
      // ceiling beam: 3 px below a solid tile
      for (let d = 1; d <= 3; d++) {
        if (kindPx(x, y - d) === TileKind.Solid) {
          col = d === 3 ? BEAM_HI : BEAM;
          height = 2.6;
          break;
        }
      }
      // ambient occlusion near the floor
      if (kindPx(x, y + 1) === TileKind.Solid || kindPx(x, y + 2) === TileKind.Solid) col = shade(col, 0.75);
      c.set(x, y, col, height);
    }
  }

  // far-side railing along the top deck
  const f = shipFeatures(layout);
  const deckY = f.deckRow * T;
  for (let x = f.deckFrom * T; x < (f.deckTo + 1) * T; x++) {
    if (x % 16 === 0) c.line(x, deckY - 7, x, deckY - 1, LADDER_DARK, 1.5);
    c.set(x, deckY - 7, LADDER, 1.5);
  }

  // masts with metal bands, yards with furled sails, pennants, crow's nest panels, shrouds and braces
  const yardY = (f.deckRow - 6) * T + 2;
  f.masts.forEach((m, i) => {
    const mx = m.col * T + 4;
    for (let y = 0; y < deckY; y++) {
      for (let k = -2; k <= 2; k++) c.set(mx + k, y, y % 22 === 5 ? METAL : MAST[k + 2]!, 3 - Math.abs(k) * 0.8);
    }
    const yardFrom = f.clampCol(m.col - 7);
    const yardTo = f.clampCol(m.col + 8);
    for (let x = yardFrom * T; x <= yardTo * T; x++) {
      c.set(x, yardY, LADDER, 2.5);
      c.set(x, yardY + 1, LADDER_DARK, 2);
      const bump = Math.floor(x / 4) % 2;
      for (let k = 1; k <= 3 + bump; k++) c.set(x, yardY - k, SAIL[Math.min(k - 1, 2)]!, 2 + k * 0.3);
    }
    for (let p = 0; p < 9; p++) for (let k = 0; k < Math.max(1, 3 - Math.floor(p / 3)); k++) c.set(mx + 3 + p, 1 + k + Math.floor(p / 4), PENNANT, 1);
    // crow's nest back panel (lattice between the railing posts)
    if (m.nest) {
      const ny = (m.nest.row - 1) * T;
      for (let x = (m.nest.from + 1) * T; x < m.nest.to * T; x++) {
        for (let y = ny; y < ny + T; y++) {
          if ((y - ny) % 3 === 0 || x % 5 === 0) c.set(x, y, (y - ny) % 3 === 0 ? LADDER : LADDER_DARK, 1.5);
        }
      }
    }
    // stays: the last mast to the bow, the first to the stern post, between masts mast top to mast top
    const last = i === f.masts.length - 1;
    if (last) c.line(mx, 4, W - 2, (f.deckRow - 1) * T - 10, ROPE, 1);
    else c.line(mx, 4, f.masts[i + 1]!.col * T + 4, 4, ROPE, 1);
    if (i === 0) c.line(mx, 4, (f.deckFrom - 1) * T + 4, f.sternTop * T, ROPE, 1);
    c.line(mx, yardY + 2, f.clampCol(m.col - 12) * T, deckY - 1, ROPE, 1);
    c.line(mx, yardY + 2, f.clampCol(m.col + 13) * T, deckY - 1, ROPE, 1);
    c.line(yardFrom * T, yardY, f.clampCol(yardFrom - 3) * T, deckY - 1, ROPE, 1);
    c.line(yardTo * T, yardY, f.clampCol(yardTo + 3) * T, deckY - 1, ROPE, 1);
  });

  // ladders (including the rows of the hatches they pass through)
  for (const l of layout.ladders) {
    const x0 = l.tx * T;
    for (let y = l.top * T; y < (l.bottom + 1) * T; y++) {
      c.set(x0 + 1, y, LADDER_DARK, 2);
      c.set(x0 + 6, y, LADDER_DARK, 2);
      if (y % 4 === 2) for (let x = x0 + 1; x <= x0 + 6; x++) c.set(x, y, LADDER, 2.5);
    }
  }
  return c;
}
