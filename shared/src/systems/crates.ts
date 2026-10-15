import { nextRandom } from '../rng';
import type { LootKind, ObjectKind, ObjectState, PlayerState } from '../state';
import type { SimContext } from './context';

/** Relative weights of what a crate holds. */
const LOOT_TABLE: readonly (readonly [LootKind, number])[] = [
  ['plank', 30],
  ['timber', 26],
  ['coins', 22],
  ['ball', 14],
  ['oilcan', 9],
  ['bucket', 6],
  ['rat', 6],
  ['hammer', 4],
  ['crowbar', 4],
];
const LOOT_TOTAL = LOOT_TABLE.reduce((a, [, w]) => a + w, 0);

/** Loot that pops out of the crate as a loose object. */
export const LOOT_OBJECTS: Partial<Record<LootKind, ObjectKind>> = {
  plank: 'plank',
  ball: 'ball',
  oilcan: 'oilcan',
  bucket: 'bucket',
};

/** German names for the loot (shown when a crate is opened). */
export const LOOT_NAMES: Record<LootKind, string> = {
  plank: 'Planke',
  timber: 'Holz',
  ball: 'Kanonenkugel',
  oilcan: 'Ölkanne',
  bucket: 'Eimer',
  coins: 'Münzen',
  hammer: 'Hammer',
  crowbar: 'Brecheisen',
  rat: 'Ratte!',
};

function pickLoot(state: { rng: number }): LootKind {
  let r = nextRandom(state) * LOOT_TOTAL;
  for (const [kind, w] of LOOT_TABLE) {
    r -= w;
    if (r < 0) return kind;
  }
  return 'plank';
}

/** 1-3 items, decided when the crate is created (so everybody finds the same). */
export function rollLoot(state: { rng: number }): LootKind[] {
  const n = 1 + Math.floor(nextRandom(state) * 3);
  const out: LootKind[] = [];
  for (let i = 0; i < n; i++) {
    let k = pickLoot(state);
    // a crate holds at most one tool, and a rat comes alone
    if ((k === 'hammer' || k === 'crowbar') && out.some((o) => o === 'hammer' || o === 'crowbar')) k = 'coins';
    if (k === 'rat') return ['rat'];
    out.push(k);
  }
  return out;
}

/**
 * Empties an opened crate: objects pop out above it, wood and coins go to the
 * stock, tools to the crew. `spawn` creates a loose object (ship-local meters).
 */
export function openCrate(
  ctx: SimContext,
  p: PlayerState,
  crate: ObjectState,
  spawn: (kind: ObjectKind, x: number, y: number, fill: number) => void,
): void {
  const v = ctx.state.voyage;
  const loot = crate.contents;
  let side = 1;
  for (const item of loot) {
    const obj = LOOT_OBJECTS[item];
    if (obj) {
      spawn(obj, crate.x + side * 0.15, crate.y - 0.8, obj === 'oilcan' ? 1 : 0);
      side = -side;
      continue;
    }
    switch (item) {
      case 'timber':
        v.timber += 1;
        break;
      case 'coins':
        v.coins += Math.round(ctx.rand(5, 16));
        break;
      case 'hammer':
        if (v.hammer) v.coins += 10;
        v.hammer = true;
        break;
      case 'crowbar':
        if (v.crowbar) v.coins += 10;
        v.crowbar = true;
        break;
      case 'rat':
        // it bolts and takes a bite of the wood stock
        if (v.timber > 0) v.timber -= 1;
        ctx.say(p, 'rat');
        break;
      default:
        break;
    }
  }
  crate.opened = true;
  crate.contents = [];
  v.cratesOpened++;
  ctx.emit({ type: 'crateOpen', player: p.id, object: crate.id, loot: [...loot] });
}
