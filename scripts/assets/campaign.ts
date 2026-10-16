import { Canvas, hash, hex, mix, shade, type RGBA } from './canvas';
import type { PropSprite } from './props';

/**
 * Phase 6 art: the harbour scenery (pier, harbour office, crane), icons for
 * the upgrades sold there and for the sea areas on the route map.
 */

const WOOD = hex('#6a4428');
const WOOD_L = hex('#8a5c36');
const WOOD_D = hex('#3e2614');
const STONE = hex('#5a5e66');
const STONE_L = hex('#7e848e');
const STONE_D = hex('#3a3c44');
const OUT = hex('#120c08');

/** The harbour: a stone quay with a wooden pier, the harbour office with a lit window, a crane. */
function harbor(): PropSprite[] {
  const W = 150;
  const H = 74;
  const c = new Canvas(W, H);
  // stone quay (left part is the land, the pier reaches to the right... the ship lies on its left side)
  for (let x = 40; x < W; x++) {
    for (let y = 46; y < H; y++) {
      const n = hash(x >> 2, y >> 1);
      let col = (y - 46) % 5 === 4 || (x + ((y - 46) / 5 | 0) * 3) % 9 === 0 ? STONE_D : n > 0.6 ? STONE_L : STONE;
      if (y < 48) col = STONE_L;
      c.set(x, y, col, 2 + (y < 48 ? 1 : 0));
    }
  }
  // wooden pier towards the ship (left)
  for (let x = 0; x < 44; x++) {
    c.set(x, 46, WOOD_L, 2.4);
    c.set(x, 47, WOOD, 2.2);
    c.set(x, 48, WOOD_D, 1.8);
  }
  for (const px of [4, 18, 32]) {
    c.rect(px, 49, 3, 25, WOOD_D, 2);
    c.rect(px, 49, 1, 25, WOOD, 2.2);
  }
  // bollard + rope
  c.rect(8, 42, 3, 4, STONE_D, 3);
  c.rect(8, 41, 3, 1, STONE_L, 3);
  // harbour office
  const hx = 70;
  for (let y = 18; y < 46; y++) for (let x = hx; x < hx + 40; x++) c.set(x, y, mix(hex('#c8b898'), hex('#a89878'), hash(x, y >> 2) * 0.4), 2);
  for (let y = 6; y < 20; y++) {
    const w = Math.round(((y - 6) / 14) * 24);
    for (let x = hx + 20 - w; x < hx + 20 + w; x++) c.set(x, y, (y + x) % 3 === 0 ? hex('#6a2a20') : hex('#8a3a2a'), 3);
  }
  c.rect(hx + 6, 26, 8, 8, hex('#2a3040'), 1.5);
  c.rect(hx + 26, 26, 8, 8, hex('#2a3040'), 1.5);
  c.rect(hx + 16, 32, 8, 14, WOOD_D, 1.5);
  // sign "KONTOR"
  c.rect(hx + 8, 20, 24, 5, WOOD, 2.6);
  for (let i = 0; i < 6; i++) c.rect(hx + 10 + i * 3, 21, 2, 3, hex('#e0c890'), 2.8);
  // crane
  c.rect(124, 8, 3, 38, WOOD_D, 2.4);
  c.line(126, 9, 146, 14, WOOD, 2.6);
  c.line(126, 12, 146, 14, WOOD_D, 2.2);
  c.line(145, 14, 145, 30, hex('#a89070'), 1.5);
  c.rect(142, 30, 7, 6, WOOD, 2.2);
  c.innerOutline(OUT);
  // lit windows (unlit layer)
  // only the windows: a small sprite whose pivot lines it up with the harbour sprite
  const glow = new Canvas(28, 8);
  glow.rect(1, 1, 6, 6, hex('#ffcc66'));
  glow.rect(21, 1, 6, 6, hex('#ffcc66'));
  glow.set(4, 1, hex('#fff0b0'));
  return [
    { name: 'harbor', canvas: c, pivot: { x: 0, y: 46 } },
    { name: 'harbor_glow', canvas: glow, pivot: { x: -(hx + 6), y: 46 - 26 } },
  ];
}

/** 12x12 upgrade icons, drawn on a brass coin-like tag. */
function upgradeIcons(): PropSprite[] {
  const pal: Record<string, RGBA> = {
    g: hex('#9aa2ae'),
    d: hex('#5a5e68'),
    y: hex('#f0cc72'),
    b: hex('#c8963c'),
    w: hex('#8a5a32'),
    l: hex('#c08a52'),
    u: hex('#5aa8e6'),
    r: hex('#d8402c'),
    o: hex('#e8a040'),
    k: hex('#2a2c32'),
    c: hex('#d88a50'),
    s: hex('#e8e2d8'),
  };
  const icon = (name: string, rows: string[]): PropSprite => {
    const c = new Canvas(12, 12);
    c.pattern(0, 0, rows, pal);
    return { name, canvas: c, pivot: { x: 6, y: 6 } };
  };
  return [
    icon('up_brassPump', ['            ', '  yyyyyyyb  ', '     y  b   ', '    yyy     ', '    yby     ', '    ybyuu   ', '    yby u   ', '    yby     ', '   bbbbb    ', '   bbbbb  u ', '         uuu', '            ']),
    icon('up_bilge', ['            ', ' u    u   u ', '  u  u u u  ', '   uu   u   ', '            ', ' gggggggggg ', ' g dddddd g ', ' g d  u d g ', ' g dddddd g ', ' gggggggggg ', '            ', '            ']),
    icon('up_doublePlanks', ['            ', ' llllllllll ', ' wwwwwwwwww ', ' l g    g l ', '            ', ' llllllllll ', ' wwwwwwwwww ', ' l g    g l ', '            ', '            ', '            ', '            ']),
    icon('up_quickLoader', ['            ', '      ddd   ', '   ddddddk  ', ' ddddddddk  ', '   ddddddk  ', '      ddd   ', '  kk        ', ' kggk  y y  ', ' kggk yyyyy ', '  kk   y y  ', '            ', '            ']),
    icon('up_lens', ['            ', '    bbbb    ', '   buuuub   ', '  buusuuub  ', '  busuuuub  ', '  buuuuuub  ', '  buuuuuub  ', '   buuuub   ', '    bbbb    ', '            ', '            ', '            ']),
    icon('up_oilTank', ['            ', '   gggggg   ', '  gooooog   ', '  goyyyog   ', '  goyyyog   ', '  goooooog  ', '  goooooog  ', '  goooooog  ', '  gggggggg  ', '            ', '            ', '            ']),
    icon('up_copper', ['            ', ' cccccccccc ', ' c ccc ccc  ', ' cccccccccc ', ' cc ccc ccc ', ' cccccccccc ', ' c ccc ccc  ', ' cccccccccc ', '            ', ' uuuuuuuuuu ', '            ', '            ']),
    icon('up_swiftHull', ['     d      ', '     dsss   ', '     dssss  ', '     dsssss ', '     dssss  ', '     dsss   ', '     d      ', ' wwwwwwwwww ', '  wwwwwwww  ', ' uuuuuuuuuuu', '            ', '            ']),
    icon('up_timber', ['            ', '            ', ' llllllllll ', ' wllllllllw ', ' llllllllll ', ' wllllllllw ', ' llllllllll ', '    rr      ', '    rr      ', '            ', '            ', '            ']),
    icon('up_tools', ['            ', '  gggg      ', '  gggg   g  ', '   ll   g   ', '   ll  g    ', '   ll g     ', '   llg      ', '   gl       ', '  g ll      ', ' g  ll      ', '            ', '            ']),
    icon('up_cannon2', ['            ', '        gg  ', '      gggg  ', '    gggggg  ', '  ggggggg   ', ' gggggg   y ', '  dgg d  yyy', ' ddddddd  y ', '  w   w     ', '            ', '            ', '            ']),
    icon('up_lantern', ['     dd     ', '    d  d    ', '   dddddd   ', '   doyyod   ', '   dyyyyd   ', '   doyyod   ', '   dddddd   ', '    dddd    ', '  y      y  ', ' y   yy   y ', '            ', '            ']),
    icon('up_crate', ['            ', '  wwwwwwww  ', '  wlwwwwlw  ', '  wwlwwlww  ', '  wwwllwww  ', '  wwwllwww  ', '  wwlwwlww  ', '  wlwwwwlw  ', '  wwwwwwww  ', '    yyyy    ', '            ', '            ']),
    icon('ui_i_buy', ['            ', '    yyyy    ', '   yybbyy   ', '  yybyybby  ', '  yybyyyyy  ', '  yyybbyyy  ', '  yyyyybyy  ', '  yybbyyyy  ', '   yyyyyy   ', '    yyyy    ', '            ', '            ']),
    icon('ui_i_table', ['            ', ' ssssssssss ', ' s u  u   s ', ' s  uu  r s ', ' s u  u rrs ', ' s  u    rs ', ' s u  y   s ', ' ssssssssss ', '  w      w  ', '  w      w  ', '  w      w  ', '            ']),
  ];
}

/** 9x9 sea-area icons for the route map. */
function biomeIcons(): PropSprite[] {
  const icon = (name: string, rows: string[], pal: Record<string, RGBA>): PropSprite => {
    const c = new Canvas(9, 9);
    c.pattern(0, 0, rows, pal);
    return { name, canvas: c, pivot: { x: 4, y: 4 } };
  };
  const B = hex('#3d86d6');
  const L = hex('#9ccaf2');
  const W = hex('#e6f2fa');
  const G = hex('#7d8590');
  const D = hex('#3a3a44');
  return [
    icon('biome_calm', ['         ', '         ', '  bb  bb ', ' b  bb  b', '         ', '  bb  bb ', ' b  bb  b', '         ', '         '], { b: L }),
    icon('biome_fog', ['         ', ' wwww    ', 'wwwwww   ', '   wwwww ', '  wwwwwww', '         ', ' wwwww   ', 'wwwwwwww ', '         '], { w: hex('#b8c0cc') }),
    icon('biome_reef', ['         ', '  g      ', ' ggd  g  ', 'gggdd gd ', 'ggdddggdd', 'bbbbbbbbb', '         ', '         ', '         '], { g: G, d: D, b: B }),
    icon('biome_kraken', ['  ppp    ', ' ppppp   ', ' pyppy   ', ' ppppp   ', 'p p p p  ', 'p p p p  ', 'bbbbbbbbb', '         ', '         '], { p: hex('#9a4866'), y: hex('#e8c040'), b: B }),
    icon('biome_pirates', ['    r    ', '    k    ', '  kkkk   ', '  kwkk   ', '  kkkk   ', '    k    ', ' ddddddd ', '  ddddd  ', 'bbbbbbbbb'], { k: hex('#1c1a20'), w: W, d: hex('#5a3a22'), r: hex('#c8352c'), b: B }),
    icon('biome_ice', ['         ', '   ww    ', '  wwlw   ', ' wwllll  ', 'wwlllllll', 'bbbbbbbbb', '         ', '         ', '         '], { w: W, l: L, b: B }),
    icon('biome_storm', [' gggg    ', 'gggggg   ', 'ggggggg  ', '   y     ', '  yy     ', '   yy    ', '    y    ', ' b  b  b ', 'b  b  b  '], { g: hex('#5a6070'), y: hex('#f0e060'), b: B }),
    icon('biome_lighthouse', ['    y    ', '   ryr   ', '    w    ', '    r    ', '    w    ', '    r    ', '   www   ', '  ggggg  ', 'bbbbbbbbb'], { y: hex('#fff0a0'), r: hex('#c8352c'), w: W, g: G, b: B }),
  ];
}

export function drawCampaign(): PropSprite[] {
  return [...harbor(), ...upgradeIcons(), ...biomeIcons()];
}
