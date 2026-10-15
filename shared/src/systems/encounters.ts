import { courseLateralAt, predictCourse } from '../navigation';
import { ROCK_LOOKAHEAD } from './constants';
import type { SimContext } from './context';
import { spawnMonster } from './monster';
import { spawnPirates } from './pirates';

export type EncounterKind = 'kraken' | 'pirates' | 'ice' | 'whirl' | 'flotsam';
export const ENCOUNTER_KINDS: readonly EncounterKind[] = ['kraken', 'pirates', 'ice', 'whirl', 'flotsam'];

/** Tuning key of each encounter's weight (biomes and modifiers change these). */
const WEIGHT_KEY = {
  kraken: 'weightKraken',
  pirates: 'weightPirates',
  ice: 'weightIce',
  whirl: 'weightWhirl',
  flotsam: 'weightFlotsam',
} as const;

/** Big encounters take the crew's attention; only one at a time. */
function busy(ctx: SimContext, kind: EncounterKind): boolean {
  const s = ctx.state;
  const big = s.monster !== null || s.pirate !== null || s.whirl !== null;
  if (kind === 'kraken' || kind === 'pirates' || kind === 'whirl') return big;
  if (kind === 'ice') return s.voyage.iceUntilX > s.ship.x;
  return s.flotsam.length > 0;
}

/** Every `encounterEvery` m something happens, drawn from the weighted table. */
export function updateEncounters(ctx: SimContext): void {
  const s = ctx.state;
  const v = s.voyage;
  const G = ctx.tuning.gameplay;
  if (s.ship.x < v.nextEncounterX) return;
  v.nextEncounterX = s.ship.x + G.encounterEvery * ctx.rand(0.75, 1.25);
  // nothing new right before the lighthouse
  if (s.ship.x > v.length - 150) return;
  const options = ENCOUNTER_KINDS.map((k) => ({ k, w: busy(ctx, k) ? 0 : Math.max(0, G[WEIGHT_KEY[k]]) }));
  const total = options.reduce((a, o) => a + o.w, 0);
  if (total <= 0) return;
  let r = ctx.rand(0, total);
  for (const o of options) {
    r -= o.w;
    if (r < 0 && o.w > 0) {
      startEncounter(ctx, o.k);
      return;
    }
  }
}

export function startEncounter(ctx: SimContext, kind: EncounterKind): void {
  const s = ctx.state;
  const G = ctx.tuning.gameplay;
  const ship = s.ship;
  const ahead = (d: number) => courseLateralAt(predictCourse(s, ctx.tuning, ROCK_LOOKAHEAD), d);
  switch (kind) {
    case 'kraken':
      spawnMonster(ctx);
      break;
    case 'pirates':
      spawnPirates(ctx);
      break;
    case 'ice':
      // the rocks beyond the current look-ahead are ice floes for a while
      s.voyage.iceUntilX = ship.x + ROCK_LOOKAHEAD + G.iceFieldLength;
      s.voyage.nextRockX = Math.min(s.voyage.nextRockX, ship.x + ROCK_LOOKAHEAD);
      break;
    case 'whirl': {
      const d = ROCK_LOOKAHEAD * 0.9;
      s.whirl = { x: ship.x + d, lateral: ahead(d) + ctx.rand(-3, 3), radius: G.whirlRadius, spotted: false, hit: false };
      ctx.emit({ type: 'whirlAppear' });
      break;
    }
    case 'flotsam': {
      const n = 2 + Math.floor(ctx.rand(0, 3));
      let d = 110;
      for (let i = 0; i < n; i++) {
        s.flotsam.push({ id: ctx.nextId(), x: ship.x + d, lateral: ahead(d) + ctx.rand(-6, 6), spotted: false });
        d += ctx.rand(14, 30);
      }
      break;
    }
  }
}
