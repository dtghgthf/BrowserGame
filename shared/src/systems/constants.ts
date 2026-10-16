import { TileKind, type ShipLayout } from '../layout/parseLayout';

/** Rocks closer than this (m ahead of the ship pivot) are created; the sea chart looks this far. */
export const ROCK_LOOKAHEAD = 160;
/** World x offset of the bow tip from the ship pivot (m) - of the default ship; others: `bowOffsetOf`. */
export const BOW_OFFSET = 15.6;
/** The lighthouse island stands this far past the end of the voyage (m, world x). */
export const LIGHTHOUSE_ISLAND = 26;
/** Where the kraken grabs the bow (m ahead of the pivot). */
export const MONSTER_ATTACK_OFFSET = 19;
/** Ship-local position of the searchlight lens pivot and the cannon barrel pivot relative to their station (m). */
export const SEARCHLIGHT_PIVOT = { x: -5 / 16, y: -12 / 16 } as const;
export const CANNON_PIVOT = { x: 6 / 16, y: -6 / 16 } as const;
export const CANNON_LENGTH = 14 / 16;

/** Where the hull ends at the waterline, ahead of (bow) and behind (stern) the pivot (m). */
export function hullEnds(layout: ShipLayout): { bow: number; stern: number } {
  const ty = Math.min(layout.height - 1, Math.max(0, Math.floor(layout.origin.y)));
  let first = -1;
  let last = -1;
  for (let tx = 0; tx < layout.width; tx++) {
    const k = layout.tiles[ty * layout.width + tx];
    if (k === TileKind.Exterior) continue;
    if (first < 0) first = tx;
    last = tx;
  }
  if (first < 0) return { bow: BOW_OFFSET, stern: BOW_OFFSET };
  return { bow: (last + 1 - layout.origin.x) * layout.tileSize, stern: (layout.origin.x - first) * layout.tileSize };
}
