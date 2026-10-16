import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN, layoutFromDesign } from '@lw/shared';
import { decorOffSet, shipFeatures } from '../src/render/procedural/ship';

/** A small ship with a raised stern deck: the hatch in it leads into a room, it is no crow's nest. */
const RAISED = [
  '                                        ',
  '                                        ',
  '  #                                     ',
  '  #r  w    l                            ',
  '  ####=#######                          ',
  '  #.l.H...l..#                       #  ',
  '  #...H..t...#  @ @ @ @    u c  s    #  ',
  '  ######=############################## ',
  '  #......H..........l...............#   ',
  '   #.....H.......p..k.....b..f.o.e.#    ',
  '    ##############################x#    ',
  '      ##########################        ',
];

describe('background art of editor ships', () => {
  it('the standard ship keeps its one mast at the crow\'s nest ladder', () => {
    const f = shipFeatures(layoutFromDesign(DEFAULT_DESIGN));
    expect(f.deckRow).toBe(13);
    expect(f.masts.map((m) => m.col)).toEqual([34]);
    expect(f.masts[0]!.nest).toEqual({ row: 4, from: 31, to: 37 });
  });

  it('a hatch into a raised deck is no crow\'s nest', () => {
    const L = layoutFromDesign({ name: 'Achterdeck', map: RAISED });
    const f = shipFeatures(L);
    expect(f.masts.every((m) => m.nest === null)).toBe(true);
    expect(f.masts).toHaveLength(1);
  });

  it('switches turn masts and railing off', () => {
    const L = layoutFromDesign(DEFAULT_DESIGN);
    expect(shipFeatures(L, decorOffSet(L, [{ tx: 34, ty: 9 }])).masts).toHaveLength(0);
    const f = shipFeatures(L, decorOffSet(L, [{ tx: 10, ty: 13 }]));
    expect(f.railOff(10)).toBe(true);
    expect(f.railOff(11)).toBe(false);
  });
});
