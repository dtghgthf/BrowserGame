import { Canvas, hash, hex, mix, shade, type RGBA } from './canvas';
import type { PropSprite } from './props';

/**
 * Detailed art for the 2.5D station view, drawn at 32 px per meter (twice the
 * 2D art): floors, ceilings, the helm with its binnacle, pump gauges, the
 * searchlight housing, cannon, saw bench, chart table, crate parts and loot.
 */

const WOOD_L = hex('#a87444');
const WOOD = hex('#7e5432');
const WOOD_M = hex('#664226');
const WOOD_D = hex('#46301a');
const WOOD_DD = hex('#24180c');
const IRON = hex('#2e3036');
const IRON_M = hex('#4a4e58');
const IRON_L = hex('#8a929e');
const BRASS = hex('#c8963c');
const BRASS_L = hex('#f0cc72');
const BRASS_D = hex('#7a5520');
const GLASS = hex('#1a2a3a');

/** Wooden planks running left-right (floor / ceiling textures). */
function planks(name: string, w: number, h: number, base: RGBA, seed: number, nails = true): PropSprite {
  const c = new Canvas(w, h);
  const rows = 8;
  const rh = h / rows;
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / rh);
    const offset = Math.floor(hash(seed, row) * w);
    for (let x = 0; x < w; x++) {
      const seg = Math.floor((x + offset) / (w / 2));
      let col = shade(base, 0.85 + hash(seed, row, seg) * 0.3);
      // grain
      if (hash(seed, x >> 3, y) > 0.82) col = shade(col, 0.9);
      if (Math.floor(y % rh) === 0) col = WOOD_DD;
      if ((x + offset) % (w / 2) === 0) col = shade(col, 0.6);
      c.set(x, y, col, Math.floor(y % rh) === 0 ? 0.5 : 2);
    }
    if (nails) {
      for (let x = 0; x < w; x++) if ((x + Math.floor(hash(seed, row) * w)) % (w / 2) === 3 && Math.floor(y % rh) === 2) c.set(x, y, IRON_L, 2.6);
    }
  }
  return { name, canvas: c, pivot: { x: 0, y: 0 } };
}

/** The helm's binnacle: a brass-capped wooden pedestal with a compass bowl. */
function binnacle(): PropSprite[] {
  const c = new Canvas(28, 46);
  // pedestal
  for (let y = 14; y < 46; y++) {
    const w = y > 40 ? 12 : 8;
    for (let x = 14 - w; x < 14 + w; x++) c.set(x, y, mix(WOOD_D, WOOD_L, Math.sin(((x - 14 + w) / (2 * w)) * Math.PI) * 0.8), 1 + Math.sin(((x - 14 + w) / (2 * w)) * Math.PI) * 2.5);
  }
  for (const y of [18, 30, 40]) for (let x = 5; x < 23; x++) if (c.alpha(x, y)) c.set(x, y, BRASS_D, 2.8);
  // brass dome with a glass window
  for (let y = 2; y < 15; y++) {
    const r = Math.sqrt(Math.max(0, 1 - ((y - 14) / 12) ** 2)) * 12;
    for (let x = Math.round(14 - r); x < Math.round(14 + r); x++) c.set(x, y, mix(BRASS_D, BRASS_L, 1 - Math.abs(x - 14) / 13), 2 + (1 - Math.abs(x - 14) / 13) * 2);
  }
  c.rect(8, 8, 12, 5, GLASS, 1.5);
  c.rect(9, 8, 2, 1, hex('#6a8aa8'), 2);
  c.innerOutline(WOOD_DD);
  // compass needle (unlit-ish bright, drawn on top of the window, rotates)
  const needle = new Canvas(10, 3);
  needle.rect(0, 1, 5, 1, hex('#e8584a'));
  needle.rect(5, 1, 5, 1, hex('#e6e2d8'));
  needle.set(5, 0, BRASS_L);
  needle.set(5, 2, BRASS_L);
  return [
    { name: 'st_binnacle', canvas: c, pivot: { x: 14, y: 46 } },
    { name: 'st_needle', canvas: needle, pivot: { x: 5, y: 1 } },
  ];
}

/** A board with a frame (the sea chart is pinned onto it in the scene). */
function board(): PropSprite {
  const c = new Canvas(44, 44);
  c.rect(0, 0, 44, 44, WOOD_D, 1.5);
  c.rect(2, 2, 40, 40, WOOD_M, 1.2);
  for (const [x, y] of [[3, 3], [40, 3], [3, 40], [40, 40]] as const) c.set(x, y, BRASS_L, 2.5);
  c.innerOutline(WOOD_DD);
  return { name: 'st_board', canvas: c, pivot: { x: 22, y: 44 } };
}

/** Pump details: pressure gauge with needle, a glass pipe and its water column. */
function pumpParts(): PropSprite[] {
  const g = new Canvas(18, 18);
  g.disc(9, 9, 8, BRASS, 2.5);
  g.disc(9, 9, 6, hex('#efe6cf'), 2);
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * 0.8 + (i / 6) * Math.PI * 1.4;
    g.set(Math.round(9 + Math.cos(a) * 5), Math.round(9 + Math.sin(a) * 5), i > 4 ? hex('#c8352c') : IRON, 2.2);
  }
  g.innerOutline(BRASS_D);
  const n = new Canvas(9, 2);
  n.rect(0, 0, 9, 1, hex('#c8352c'));
  n.rect(0, 1, 3, 1, IRON);
  const pipe = new Canvas(10, 40);
  pipe.rect(0, 0, 10, 3, BRASS, 2.6);
  pipe.rect(0, 37, 10, 3, BRASS, 2.6);
  pipe.rect(2, 3, 6, 34, hex('#2a3a4a'), 1);
  pipe.rect(2, 3, 1, 34, hex('#7a9ab8'), 1.4);
  pipe.innerOutline(BRASS_D);
  const water = new Canvas(4, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 4; x++) water.set(x, y, y === 0 ? hex('#9ccaf2') : x === 0 ? hex('#5aa8e6') : hex('#3d86d6'), 1.5);
  return [
    { name: 'st_gauge', canvas: g, pivot: { x: 9, y: 9 } },
    { name: 'st_gauge_needle', canvas: n, pivot: { x: 2, y: 0 } },
    { name: 'st_pipe', canvas: pipe, pivot: { x: 5, y: 40 } },
    { name: 'st_water', canvas: water, pivot: { x: 2, y: 32 } },
  ];
}

/** The big searchlight: housing (rotates), yoke, crank and oil glass. */
function lampParts(): PropSprite[] {
  const h = new Canvas(46, 30);
  for (let x = 0; x < 40; x++) {
    const r = 9 + x * 0.12;
    for (let y = 0; y < 30; y++) {
      const dy = y - 15;
      if (Math.abs(dy) > r) continue;
      const t = 1 - Math.abs(dy) / r;
      h.set(x, y, mix(IRON, IRON_L, t * 0.7), 1 + t * 3);
    }
  }
  for (const x of [8, 20, 32]) for (let y = 0; y < 30; y++) if (h.alpha(x, y)) h.set(x, y, BRASS_D, 3.2);
  for (let y = 0; y < 30; y++) {
    const dy = Math.abs(y - 15);
    if (dy <= 14) h.rect(40, y, 6, 1, dy > 12 ? BRASS_D : mix(hex('#fff8d8'), hex('#c8d8e8'), dy / 14), dy > 12 ? 3 : 2.5);
  }
  h.innerOutline(hex('#141518'));
  const glow = new Canvas(46, 30);
  for (let y = 2; y < 28; y++) glow.rect(41, y, 4, 1, hex('#fff6d0'));
  const yoke = new Canvas(40, 34);
  yoke.rect(4, 26, 32, 8, IRON_M, 2);
  yoke.rect(4, 26, 32, 2, IRON_L, 2.6);
  yoke.rect(6, 4, 4, 24, IRON_M, 2.4);
  yoke.rect(30, 4, 4, 24, IRON_M, 2.4);
  yoke.disc(8, 6, 3, BRASS, 3);
  yoke.disc(32, 6, 3, BRASS, 3);
  yoke.innerOutline(hex('#141518'));
  const crank = new Canvas(20, 20);
  crank.disc(10, 10, 9, IRON_M, 2);
  crank.disc(10, 10, 7, IRON, 1.5);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    crank.line(10, 10, Math.round(10 + Math.cos(a) * 7), Math.round(10 + Math.sin(a) * 7), IRON_L, 2.4);
  }
  crank.rect(16, 9, 4, 3, WOOD_L, 3);
  crank.disc(10, 10, 2, BRASS, 3);
  const oil = new Canvas(10, 26);
  oil.rect(0, 0, 10, 3, BRASS, 2.6);
  oil.rect(0, 23, 10, 3, BRASS, 2.6);
  oil.rect(2, 3, 6, 20, hex('#2a2418'), 1);
  oil.innerOutline(BRASS_D);
  const oilFill = new Canvas(4, 20);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 4; x++) oilFill.set(x, y, y === 0 ? hex('#f0d080') : hex('#c89030'), 1.5);
  return [
    { name: 'st_lamp', canvas: h, pivot: { x: 14, y: 15 } },
    { name: 'st_lamp_glow', canvas: glow, pivot: { x: 14, y: 15 } },
    { name: 'st_yoke', canvas: yoke, pivot: { x: 20, y: 34 } },
    { name: 'st_crank', canvas: crank, pivot: { x: 10, y: 10 } },
    { name: 'st_oilglass', canvas: oil, pivot: { x: 5, y: 26 } },
    { name: 'st_oil', canvas: oilFill, pivot: { x: 2, y: 20 } },
  ];
}

/** Cannon: long barrel, carriage with wheels, ramrod, a burning fuse spark. */
function cannonParts(): PropSprite[] {
  const b = new Canvas(64, 20);
  for (let x = 0; x < 64; x++) {
    const r = x < 8 ? 9 : x > 58 ? 8 : 9 - (x - 8) * 0.04;
    for (let y = 0; y < 20; y++) {
      const dy = y - 10;
      if (Math.abs(dy) > r) continue;
      const t = 1 - Math.abs(dy) / r;
      b.set(x, y, mix(IRON, IRON_L, t * t * 0.8), 1 + t * 3);
    }
  }
  for (const x of [8, 18, 56]) for (let y = 0; y < 20; y++) if (b.alpha(x, y)) b.set(x, y, IRON_M, 3.4);
  b.rect(0, 8, 3, 4, IRON_L, 3);
  b.innerOutline(hex('#101114'));
  const car = new Canvas(56, 30);
  car.rect(2, 4, 52, 12, WOOD, 2);
  car.rect(2, 4, 52, 3, WOOD_L, 2.4);
  for (let x = 2; x < 54; x += 9) car.rect(x, 4, 1, 12, WOOD_D, 1.5);
  for (const wx of [12, 44]) {
    car.disc(wx, 21, 8, WOOD_D, 2.4);
    car.disc(wx, 21, 6, WOOD_M, 2.2);
    car.disc(wx, 21, 2, IRON_L, 3);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      car.line(wx, 21, Math.round(wx + Math.cos(a) * 6), Math.round(21 + Math.sin(a) * 6), WOOD_DD, 2);
    }
  }
  car.innerOutline(WOOD_DD);
  const rod = new Canvas(60, 5);
  rod.rect(0, 2, 52, 1, WOOD_L, 2);
  rod.rect(0, 1, 52, 1, WOOD, 2);
  rod.rect(52, 0, 8, 5, hex('#5a4a3a'), 2.6);
  const spark = new Canvas(7, 7);
  spark.set(3, 3, hex('#fff6c0'));
  for (const [x, y] of [[3, 1], [1, 3], [5, 3], [3, 5], [1, 1], [5, 5]] as const) spark.set(x, y, hex('#ff9a30'));
  return [
    { name: 'st_cannon', canvas: b, pivot: { x: 14, y: 10 } },
    { name: 'st_carriage', canvas: car, pivot: { x: 28, y: 30 } },
    { name: 'st_ramrod', canvas: rod, pivot: { x: 0, y: 2 } },
    { name: 'st_spark', canvas: spark, pivot: { x: 3, y: 3 } },
  ];
}

/** The saw bench: trestle, saw, the plank being cut and sawdust. */
function benchParts(): PropSprite[] {
  const bench = new Canvas(84, 40);
  bench.rect(0, 10, 84, 6, WOOD_L, 2.6);
  bench.rect(0, 16, 84, 2, WOOD_D, 1.6);
  for (const lx of [6, 74]) {
    bench.line(lx, 18, lx - 5, 39, WOOD_M, 2);
    bench.line(lx + 1, 18, lx - 4, 39, WOOD_M, 2);
    bench.line(lx, 18, lx + 5, 39, WOOD_M, 2);
    bench.line(lx + 1, 18, lx + 6, 39, WOOD_M, 2);
  }
  bench.rect(10, 30, 64, 2, WOOD_D, 1.6);
  // a vice and some tools on the bench
  bench.rect(68, 4, 10, 6, IRON_M, 2.8);
  bench.rect(70, 2, 2, 2, IRON_L, 3);
  bench.innerOutline(WOOD_DD);
  const saw = new Canvas(54, 18);
  for (let x = 0; x < 40; x++) {
    const h = 10 - x * 0.12;
    for (let y = Math.round(9 - h / 2); y < Math.round(9 + h / 2); y++) saw.set(x, y, mix(IRON_L, hex('#d8dde6'), (y - 4) / 10), 2.4);
    if (x % 3 === 0) saw.set(x, Math.round(9 + h / 2), IRON_M, 2);
  }
  saw.rect(40, 2, 14, 14, WOOD_D, 2.6);
  saw.rect(43, 6, 8, 6, hex('#1a1008'), 0.5);
  saw.innerOutline(hex('#2a2c30'));
  const plank = new Canvas(70, 8);
  for (let x = 0; x < 70; x++) {
    plank.set(x, 0, hex('#d09a60'), 2.4);
    for (let y = 1; y < 6; y++) plank.set(x, y, hash(x >> 2, y) > 0.85 ? hex('#a87444') : hex('#c08a52'), 2);
    plank.set(x, 6, hex('#8a5a32'), 1.6);
    plank.set(x, 7, hex('#6e4628'), 1.2);
  }
  const cut = new Canvas(2, 8);
  cut.rect(0, 0, 2, 8, hex('#2a1a10'));
  return [
    { name: 'st_bench', canvas: bench, pivot: { x: 42, y: 40 } },
    { name: 'st_saw', canvas: saw, pivot: { x: 20, y: 9 } },
    { name: 'st_plank', canvas: plank, pivot: { x: 35, y: 8 } },
    { name: 'st_cut', canvas: cut, pivot: { x: 1, y: 0 } },
  ];
}

/** Chart table and a candle (the flame is unlit). */
function tableParts(): PropSprite[] {
  const t = new Canvas(80, 36);
  t.rect(0, 0, 80, 5, WOOD_L, 2.8);
  t.rect(0, 5, 80, 3, WOOD_D, 1.8);
  for (const lx of [4, 72]) t.rect(lx, 8, 4, 28, WOOD_M, 2.2);
  t.rect(8, 26, 64, 2, WOOD_D, 1.6);
  t.rect(30, 9, 20, 7, WOOD, 2);
  t.rect(38, 11, 4, 2, BRASS_L, 3);
  t.innerOutline(WOOD_DD);
  const candle = new Canvas(8, 16);
  candle.rect(2, 4, 4, 10, hex('#efe6cf'), 2);
  candle.rect(1, 13, 6, 3, BRASS, 2.6);
  candle.set(4, 3, hex('#2a2a2a'));
  const flame = new Canvas(5, 7);
  flame.pattern(0, 0, ['  y  ', ' yyy ', ' ywy ', 'yywyy', 'ywwwy', ' yoy ', '  o  '], { y: hex('#ffd060'), w: hex('#fff6d0'), o: hex('#ff8a2a') });
  return [
    { name: 'st_table', canvas: t, pivot: { x: 40, y: 36 } },
    { name: 'st_candle', canvas: candle, pivot: { x: 4, y: 16 } },
    { name: 'st_candle_flame', canvas: flame, pivot: { x: 2, y: 7 } },
  ];
}

/** A crate for opening: box, lid, crowbar, straw, coins, a rat. */
function crateParts(): PropSprite[] {
  const box = new Canvas(48, 36);
  for (let y = 0; y < 36; y++) {
    for (let x = 0; x < 48; x++) {
      const row = Math.floor(y / 9);
      let col = hash(row, 5) > 0.5 ? WOOD : shade(WOOD, 0.9);
      if (y % 9 === 8) col = WOOD_D;
      if (hash(x >> 3, y, row) > 0.9) col = shade(col, 0.88);
      box.set(x, y, col, y % 9 === 8 ? 1.5 : 2);
    }
  }
  for (let i = 2; i < 34; i++) {
    box.set(Math.round(4 + i * 1.2), i, WOOD_L, 2.8);
    box.set(Math.round(44 - i * 1.2), i, WOOD_L, 2.8);
  }
  for (const [x, y] of [[0, 0], [44, 0], [0, 32], [44, 32]] as const) box.rect(x, y, 4, 4, IRON_M, 3);
  box.innerOutline(WOOD_DD);
  const lid = new Canvas(50, 7);
  lid.rect(0, 0, 50, 6, WOOD_L, 2.6);
  lid.rect(0, 6, 50, 1, WOOD_D, 1.6);
  for (const x of [3, 24, 46]) lid.set(x, 3, IRON_L, 3);
  lid.innerOutline(WOOD_DD);
  const dark = new Canvas(44, 6);
  dark.rect(0, 0, 44, 6, hex('#140c06'), 0.5);
  const bar = new Canvas(44, 6);
  bar.rect(0, 2, 38, 2, IRON_M, 2.6);
  bar.rect(0, 2, 38, 1, IRON_L, 3);
  bar.line(38, 3, 43, 0, IRON_M, 2.6);
  bar.rect(0, 1, 2, 4, IRON_M, 2.6);
  const straw = new Canvas(46, 10);
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(hash(i, 1) * 44);
    const y = Math.floor(hash(i, 2) * 8);
    straw.line(x, y + 2, x + 2, y, hash(i, 3) > 0.5 ? hex('#d8b860') : hex('#a88a40'), 2);
  }
  const coins = new Canvas(16, 10);
  for (const [x, y] of [[2, 6], [6, 7], [10, 6], [4, 3], [8, 3], [6, 0]] as const) {
    coins.rect(x, y + 1, 5, 2, BRASS_D, 2);
    coins.rect(x, y, 5, 2, BRASS_L, 2.6);
  }
  const rat = new Canvas(18, 9);
  rat.pattern(0, 0, ['                  ', '     gggg         ', '   gggggggg      w', ' wgggggggggg    w ', 'wggegggggggggggw  ', ' ggggggggggg      ', '   p  p  p  p     ', '                  ', '                  '], { g: hex('#6a6470'), e: hex('#101010'), w: hex('#e8a0a8'), p: hex('#4a4450') });
  return [
    { name: 'st_crate', canvas: box, pivot: { x: 24, y: 36 } },
    { name: 'st_lid', canvas: lid, pivot: { x: 0, y: 0 } },
    { name: 'st_crate_dark', canvas: dark, pivot: { x: 22, y: 0 } },
    { name: 'st_crowbar', canvas: bar, pivot: { x: 40, y: 3 } },
    { name: 'st_straw', canvas: straw, pivot: { x: 23, y: 10 } },
    { name: 'st_coins', canvas: coins, pivot: { x: 8, y: 10 } },
    { name: 'st_rat', canvas: rat, pivot: { x: 9, y: 7 } },
  ];
}

/** The oil barrel close up: staves, iron hoops, a brass tap; the oil stream. */
function barrelParts(): PropSprite[] {
  const W = 36;
  const H = 44;
  const b = new Canvas(W, H);
  for (let y = 0; y < H; y++) {
    // a barrel bulges in the middle
    const bulge = Math.round(3 * Math.sin((y / (H - 1)) * Math.PI));
    const inset = 3 - bulge;
    for (let x = inset; x < W - inset; x++) {
      const stave = Math.floor((x - inset) / 5);
      const across = (x - inset) / (W - 2 * inset - 1);
      let col = mix(WOOD_M, WOOD_L, Math.sin(across * Math.PI) * 0.85 + hash(stave, 41) * 0.15);
      if ((x - inset) % 5 === 0 && x > inset) col = shade(col, 0.78);
      if (hash(x, y >> 2, 7) > 0.93) col = shade(col, 0.9);
      b.set(x, y, col, 1 + Math.sin(across * Math.PI) * 3);
    }
  }
  for (const hy of [4, 13, 30, 39]) {
    const bulge = Math.round(3 * Math.sin((hy / (H - 1)) * Math.PI));
    for (let x = 3 - bulge; x < W - 3 + bulge; x++) {
      b.set(x, hy, IRON_M, 3.4);
      b.set(x, hy + 1, IRON, 3.2);
    }
  }
  b.innerOutline(WOOD_DD);
  // stencil: OEL
  const ink = hex('#2a1a0e');
  b.pattern(12, 19, ['xxx x   x  ', 'x x xxx x  ', 'x x x   x  ', 'xxx xxx xxx'].map((r) => r.replace(/ /g, '.')), { x: ink }, { x: 1.2 });
  const tap = new Canvas(12, 8);
  tap.rect(0, 2, 8, 3, BRASS, 3);
  tap.rect(0, 2, 8, 1, BRASS_L, 3.4);
  tap.rect(6, 4, 3, 4, BRASS_D, 2.6);
  tap.rect(3, 0, 3, 2, BRASS_L, 3.6);
  tap.innerOutline(BRASS_D);
  const stream = new Canvas(3, 20);
  for (let y = 0; y < 20; y++) {
    stream.set(0, y, hex('#8a5a18', 200), 2);
    stream.set(1, y, hex('#e0b860', 230), 2.6);
    stream.set(2, y, hex('#8a5a18', 200), 2);
  }
  return [
    { name: 'st_barrel', canvas: b, pivot: { x: W / 2, y: H } },
    { name: 'st_tap', canvas: tap, pivot: { x: 4, y: 3 } },
    { name: 'st_stream', canvas: stream, pivot: { x: 1, y: 0 } },
  ];
}

export function drawStations(): PropSprite[] {
  return [
    planks('st_floor', 96, 64, WOOD_M, 1),
    planks('st_ceiling', 96, 64, WOOD_D, 2, false),
    planks('st_deck', 96, 64, hex('#8a6440'), 3),
    ...binnacle(),
    board(),
    ...pumpParts(),
    ...lampParts(),
    ...cannonParts(),
    ...benchParts(),
    ...tableParts(),
    ...crateParts(),
    ...barrelParts(),
  ];
}
