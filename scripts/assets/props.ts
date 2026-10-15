import { Canvas, hash, hex, mix, shade, type RGBA } from './canvas';

export interface PropSprite {
  name: string;
  canvas: Canvas;
  pivot: { x: number; y: number };
}

const WOOD_L = hex('#9a6a3e');
const WOOD = hex('#7a5230');
const WOOD_D = hex('#5a3a20');
const WOOD_DD = hex('#2a1a10');
const IRON = hex('#2e3036');
const IRON_M = hex('#4a4e58');
const IRON_L = hex('#7d8590');
const BRASS = hex('#b8893a');
const BRASS_L = hex('#e0b860');
const NONE: RGBA = [0, 0, 0, 0];

function crate(): PropSprite {
  const c = new Canvas(12, 12);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      const plank = Math.floor(y / 3);
      let col = hash(plank, 3) > 0.5 ? WOOD : shade(WOOD, 0.9);
      if (y % 3 === 2) col = WOOD_D;
      c.set(x, y, col, y % 3 === 2 ? 1.5 : 2);
    }
  }
  // cross brace
  for (let i = 1; i < 11; i++) {
    c.set(i, i, WOOD_L, 2.6);
    c.set(i, 11 - i, WOOD_L, 2.6);
  }
  c.innerOutline(WOOD_DD);
  for (const [x, y] of [
    [0, 0],
    [10, 0],
    [0, 10],
    [10, 10],
  ] as const) {
    c.rect(x, y, 2, 2, IRON_M, 2.8);
  }
  return { name: 'crate', canvas: c, pivot: { x: 6, y: 6 } };
}

function barrel(): PropSprite {
  const c = new Canvas(10, 12);
  for (let y = 0; y < 12; y++) {
    const inset = y === 0 || y === 11 ? 1 : 0;
    for (let x = inset; x < 10 - inset; x++) {
      const stave = Math.floor(x / 2);
      let col = mix(WOOD, WOOD_L, (Math.sin((x / 9) * Math.PI) * 0.8 + hash(stave, 9) * 0.2));
      if (x % 2 === 0 && x > 0) col = shade(col, 0.85);
      c.set(x, y, col, 1 + Math.sin(((x + 0.5) / 10) * Math.PI) * 2);
    }
  }
  for (const y of [2, 9]) for (let x = 0; x < 10; x++) c.set(x, y, x === 4 ? IRON_L : IRON_M, 3.2);
  for (let x = 1; x < 9; x++) c.set(x, 0, WOOD_L);
  c.innerOutline(WOOD_DD);
  return { name: 'barrel', canvas: c, pivot: { x: 5, y: 6 } };
}

function plank(): PropSprite {
  const c = new Canvas(20, 3);
  for (let x = 0; x < 20; x++) {
    c.set(x, 0, hex('#c08a52'), 2);
    c.set(x, 1, hex('#9a6a3e'), 2);
    c.set(x, 2, hex('#6e4628'), 1.4);
  }
  c.set(2, 1, IRON_L, 2.6);
  c.set(17, 1, IRON_L, 2.6);
  return { name: 'plank', canvas: c, pivot: { x: 10, y: 1 } };
}

function lantern(): PropSprite[] {
  const c = new Canvas(7, 10);
  c.set(3, 0, IRON_L, 2);
  c.rect(1, 1, 5, 2, IRON_M, 2.5);
  c.set(2, 1, IRON_L, 2.8);
  for (let y = 3; y <= 7; y++) {
    c.set(1, y, IRON, 2.4);
    c.set(5, y, IRON, 2.4);
    for (let x = 2; x <= 4; x++) c.set(x, y, hex('#6a4a20'), 1.6);
  }
  c.rect(1, 8, 5, 2, IRON_M, 2.5);
  c.set(3, 9, IRON, 2);
  const g = new Canvas(7, 10);
  for (let y = 3; y <= 7; y++) for (let x = 2; x <= 4; x++) g.set(x, y, hex('#ffb84a'));
  g.set(3, 4, hex('#fff0b8'));
  g.set(3, 5, hex('#ffe08a'));
  g.set(3, 6, hex('#ffd070'));
  return [
    { name: 'lantern', canvas: c, pivot: { x: 3, y: 0 } },
    { name: 'lantern_flame', canvas: g, pivot: { x: 3, y: 0 } },
  ];
}

function wheel(): PropSprite[] {
  const c = new Canvas(15, 15);
  const cx = 7;
  const cy = 7;
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    for (let r = 1; r <= 7; r++) {
      const x = Math.round(cx + Math.cos(ang) * r);
      const y = Math.round(cy + Math.sin(ang) * r);
      c.set(x, y, r === 7 ? WOOD_L : WOOD, r === 7 ? 3 : 2);
    }
  }
  for (let i = 0; i < 64; i++) {
    const ang = (i / 64) * Math.PI * 2;
    c.set(Math.round(cx + Math.cos(ang) * 5), Math.round(cy + Math.sin(ang) * 5), WOOD_D, 2.4);
  }
  c.disc(cx, cy, 1, BRASS, 3);
  c.set(cx, cy, BRASS_L, 3.4);
  const post = new Canvas(6, 13);
  post.rect(2, 0, 2, 11, WOOD, 2);
  post.set(2, 0, WOOD_L);
  post.rect(0, 10, 6, 3, WOOD_D, 2);
  post.rect(0, 10, 6, 1, WOOD, 2.2);
  post.innerOutline(WOOD_DD);
  return [
    { name: 'wheel', canvas: c, pivot: { x: 7, y: 7 } },
    { name: 'helm', canvas: post, pivot: { x: 3, y: 12 } },
  ];
}

function pump(): PropSprite[] {
  const c = new Canvas(12, 16);
  c.rect(0, 12, 12, 4, WOOD_D, 2);
  c.rect(0, 12, 12, 1, WOOD, 2.4);
  for (let y = 2; y < 12; y++) {
    for (let x = 3; x <= 8; x++) {
      const t = Math.sin(((x - 3 + 0.5) / 6) * Math.PI);
      c.set(x, y, mix(IRON, IRON_L, t * 0.8), 1 + t * 2.4);
    }
  }
  c.rect(2, 1, 8, 2, IRON_M, 2.8);
  c.rect(9, 5, 3, 2, IRON_M, 2.5);
  c.set(11, 7, IRON, 2);
  c.rect(5, 0, 2, 1, IRON_L, 3);
  c.innerOutline(hex('#15161a'));
  const h = new Canvas(16, 3);
  for (let x = 0; x < 16; x++) {
    h.set(x, 1, IRON_L, 2.6);
    h.set(x, 0, IRON_M, 2.2);
  }
  h.rect(0, 0, 3, 3, WOOD, 2.4);
  h.rect(13, 0, 3, 3, WOOD, 2.4);
  h.set(7, 2, IRON, 2);
  h.set(8, 2, IRON, 2);
  return [
    { name: 'pump', canvas: c, pivot: { x: 6, y: 15 } },
    { name: 'pump_handle', canvas: h, pivot: { x: 8, y: 1 } },
  ];
}

function searchlight(): PropSprite[] {
  const base = new Canvas(10, 8);
  base.rect(4, 0, 2, 5, IRON_M, 2.5);
  base.line(4, 4, 1, 7, IRON, 2);
  base.line(5, 4, 8, 7, IRON, 2);
  base.rect(3, 0, 4, 2, IRON_L, 3);
  const head = new Canvas(12, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 10; x++) {
      const t = Math.sin(((y + 0.5) / 8) * Math.PI);
      if ((y === 0 || y === 7) && (x < 2 || x > 8)) continue;
      head.set(x, y, mix(IRON, IRON_L, t * 0.7), 1 + t * 2.5);
    }
  }
  head.rect(10, 1, 2, 6, hex('#9fb4c8'), 3);
  head.rect(4, 0, 3, 1, BRASS, 3.2);
  head.innerOutline(hex('#15161a'));
  const glow = new Canvas(12, 8);
  glow.rect(10, 1, 2, 6, hex('#fff6d8'));
  glow.rect(11, 2, 1, 4, hex('#ffffff'));
  return [
    { name: 'searchlight_base', canvas: base, pivot: { x: 5, y: 7 } },
    { name: 'searchlight_head', canvas: head, pivot: { x: 4, y: 4 } },
    { name: 'searchlight_glow', canvas: glow, pivot: { x: 4, y: 4 } },
  ];
}

function cannon(): PropSprite[] {
  const b = new Canvas(18, 7);
  for (let x = 0; x < 18; x++) {
    const r = x < 3 ? 3 : x > 15 ? 2.6 : 3 - (x - 3) * 0.04;
    for (let y = 0; y < 7; y++) {
      const dy = y - 3;
      if (Math.abs(dy) > r) continue;
      const t = 1 - Math.abs(dy) / 3.2;
      b.set(x, y, mix(IRON, IRON_L, t * 0.6), 1 + t * 2.5);
    }
  }
  b.rect(16, 1, 2, 5, IRON_M, 2.8);
  b.rect(5, 0, 1, 7, IRON_M, 3);
  b.set(0, 3, IRON_L, 3);
  b.innerOutline(hex('#141518'));
  const car = new Canvas(14, 8);
  car.rect(1, 1, 12, 3, WOOD, 2);
  car.rect(1, 1, 12, 1, WOOD_L, 2.4);
  car.disc(3, 5, 2, WOOD_D, 2.4);
  car.disc(10, 5, 2, WOOD_D, 2.4);
  car.set(3, 5, IRON_L, 3);
  car.set(10, 5, IRON_L, 3);
  car.innerOutline(WOOD_DD);
  return [
    { name: 'cannon', canvas: b, pivot: { x: 4, y: 3 } },
    { name: 'cannon_carriage', canvas: car, pivot: { x: 7, y: 7 } },
  ];
}

function workbench(): PropSprite {
  const c = new Canvas(24, 14);
  c.rect(0, 5, 24, 2, WOOD_L, 2.6);
  c.rect(0, 7, 24, 1, WOOD_D, 2);
  c.rect(1, 8, 2, 6, WOOD_D, 2);
  c.rect(21, 8, 2, 6, WOOD_D, 2);
  c.rect(1, 11, 22, 1, WOOD, 1.8);
  // stack of planks
  for (let i = 0; i < 4; i++) {
    c.rect(1 + (i % 2), 4 - i, 11, 1, i % 2 ? hex('#c08a52') : hex('#9a6a3e'), 3 + i * 0.4);
  }
  // saw + hammer
  c.line(14, 4, 19, 1, IRON_L, 3);
  c.line(15, 4, 19, 2, IRON_M, 3);
  c.rect(19, 0, 2, 2, WOOD, 3);
  c.rect(15, 4, 5, 1, WOOD, 3);
  c.rect(21, 3, 2, 2, IRON_M, 3.2);
  c.innerOutline(WOOD_DD);
  return { name: 'workbench', canvas: c, pivot: { x: 12, y: 13 } };
}

function hatches(): PropSprite[] {
  const closed = new Canvas(8, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let col = x % 4 === 3 ? WOOD_D : hash(Math.floor(x / 4), 21) > 0.5 ? WOOD : shade(WOOD, 0.88);
      if (y === 0) col = WOOD_L;
      if (y === 7) col = WOOD_DD;
      closed.set(x, y, col, y === 0 ? 2.6 : 2);
    }
  }
  closed.rect(0, 2, 8, 1, IRON_M, 2.8);
  closed.rect(0, 5, 8, 1, IRON_M, 2.8);
  closed.set(3, 3, IRON_L, 3);
  closed.set(4, 3, IRON_L, 3);
  const open = new Canvas(8, 16);
  for (let y = 1; y < 9; y++) {
    open.set(0, y, WOOD_L, 2.6);
    open.set(1, y, WOOD, 2.2);
    open.set(2, y, WOOD_D, 1.8);
  }
  open.set(1, 3, IRON_M, 3);
  open.set(1, 6, IRON_M, 3);
  return [
    { name: 'hatch_closed', canvas: closed, pivot: { x: 0, y: 0 } },
    { name: 'hatch_open', canvas: open, pivot: { x: 0, y: 8 } },
  ];
}

function leak(): PropSprite[] {
  const c = new Canvas(8, 8);
  const shape = ['  #  #  ', ' ###### ', '##....##', ' #....# ', '##....##', ' #...## ', '  ####  ', '   #    '];
  shape.forEach((row, y) => {
    for (let x = 0; x < 8; x++) {
      if (row[x] === '#') c.set(x, y, hex('#a87a4a'), 2.5);
      if (row[x] === '.') c.set(x, y, hex('#07090c'), 0);
    }
  });
  const patch = new Canvas(8, 8);
  for (let x = 0; x < 8; x++) {
    patch.set(x, 2, hex('#c08a52'), 3);
    patch.set(x, 3, hex('#9a6a3e'), 3);
    patch.set(x, 5, hex('#c08a52'), 3);
    patch.set(x, 6, hex('#9a6a3e'), 3);
  }
  for (const [x, y] of [
    [1, 2],
    [6, 3],
    [1, 6],
    [6, 5],
  ] as const) {
    patch.set(x, y, IRON_L, 3.4);
  }
  return [
    { name: 'leak', canvas: c, pivot: { x: 0, y: 0 } },
    { name: 'patch', canvas: patch, pivot: { x: 0, y: 0 } },
  ];
}

function bubbles(): PropSprite[] {
  const b = new Canvas(15, 13);
  const W = hex('#f2eee2');
  const O = hex('#1c1a20');
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 15; x++) {
      const corner = (x === 0 || x === 14) && (y === 0 || y === 9);
      if (!corner) b.set(x, y, W);
    }
  }
  b.set(3, 10, W);
  b.set(4, 10, W);
  b.set(3, 11, W);
  b.set(2, 12, W);
  b.innerOutline(O);
  for (let x = 1; x < 14; x++) b.set(x, 1, W);
  const icon = (name: string, rows: string[], pal: Record<string, RGBA>): PropSprite => {
    const c = new Canvas(7, 7);
    c.pattern(0, 0, rows, pal);
    return { name, canvas: c, pivot: { x: 3, y: 3 } };
  };
  const blue = hex('#3d86d6');
  const lblue = hex('#9ccaf2');
  const red = hex('#c8352c');
  return [
    { name: 'bubble', canvas: b, pivot: { x: 2, y: 12 } },
    icon('icon_leak', ['   b   ', '  bbb  ', ' bbLbb ', ' bLbbb ', 'bbbbbbb', ' bbbbb ', '  bbb  '], { b: blue, L: lblue }),
    icon('icon_plank', ['     ww', '    wwd', '   wwd ', '  wwd  ', ' wwd   ', 'wwd    ', 'dd     '], { w: hex('#c08a52'), d: hex('#6e4628') }),
    icon('icon_help', ['  rrr  ', '  rrr  ', '  rrr  ', '  rrr  ', '   r   ', '       ', '  rrr  '], { r: red }),
    icon('icon_water', ['       ', ' b   b ', 'b b b b', '   b   ', ' b   b ', 'b b b b', '   b   '], { b: blue }),
  ];
}

function lighthouse(): PropSprite[] {
  const c = new Canvas(18, 60);
  for (let y = 12; y < 60; y++) {
    const t = (y - 12) / 48;
    const half = Math.round(4 + t * 4);
    const stripe = Math.floor((y - 12) / 8) % 2 === 0;
    for (let x = 9 - half; x < 9 + half; x++) {
      const edge = (x - (9 - half)) / (half * 2);
      const base = stripe ? hex('#8a3a34') : hex('#b8b0a4');
      c.set(x, y, shade(base, 0.6 + Math.sin(edge * Math.PI) * 0.4), 1 + Math.sin(edge * Math.PI) * 3);
    }
  }
  c.rect(3, 10, 12, 2, IRON_M, 2);
  c.rect(5, 4, 8, 6, hex('#2a3038'), 1);
  c.rect(6, 5, 6, 4, hex('#c8a860'), 1.5);
  c.rect(5, 2, 8, 2, IRON, 2);
  c.rect(8, 0, 2, 2, IRON, 2);
  const glow = new Canvas(18, 60);
  glow.rect(6, 5, 6, 4, hex('#fff0c0'));
  glow.rect(7, 6, 4, 2, hex('#ffffff'));
  return [
    { name: 'lighthouse', canvas: c, pivot: { x: 9, y: 59 } },
    { name: 'lighthouse_glow', canvas: glow, pivot: { x: 9, y: 59 } },
  ];
}

function moon(): PropSprite {
  const c = new Canvas(15, 15);
  c.disc(7, 7, 7, hex('#e6e2cf'));
  for (const [x, y, r] of [
    [5, 5, 1],
    [9, 9, 2],
    [10, 4, 1],
  ] as const) {
    c.disc(x, y, r, hex('#c8c3ab'));
  }
  for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) if (c.alpha(x, y) && (x - 4) * (x - 4) + (y - 4) * (y - 4) > 70) c.set(x, y, shade(c.get(x, y), 0.85));
  return { name: 'moon', canvas: c, pivot: { x: 7, y: 7 } };
}

export function drawProps(): PropSprite[] {
  return [
    crate(),
    barrel(),
    plank(),
    ...lantern(),
    ...wheel(),
    ...pump(),
    ...searchlight(),
    ...cannon(),
    workbench(),
    ...hatches(),
    ...leak(),
    ...bubbles(),
    ...lighthouse(),
    moon(),
  ];
}

/** Simple shelf packer with padding. Returns positions and the atlas size. */
export function packSprites(sprites: { canvas: Canvas }[], width: number, pad = 2): { x: number; y: number }[] & { height?: number } {
  const order = sprites.map((s, i) => i).sort((a, b) => sprites[b]!.canvas.h - sprites[a]!.canvas.h);
  const pos: { x: number; y: number }[] = new Array(sprites.length);
  let x = pad;
  let y = pad;
  let rowH = 0;
  for (const i of order) {
    const c = sprites[i]!.canvas;
    if (x + c.w + pad > width) {
      x = pad;
      y += rowH + pad;
      rowH = 0;
    }
    pos[i] = { x, y };
    x += c.w + pad;
    rowH = Math.max(rowH, c.h);
  }
  const result = pos as { x: number; y: number }[] & { height?: number };
  result.height = y + rowH + pad;
  return result;
}

export { NONE };
