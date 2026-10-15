import { Canvas, hash, hex, mix, shade, type RGBA } from './canvas';
import type { PropSprite } from './props';

/** Wet rock sticking out of the sea. Bottom rows are under water (cut by the sea in the game). */
function rock(name: string, w: number, h: number, seed: number): PropSprite {
  const c = new Canvas(w, h);
  const top = hex('#6c7480');
  const mid = hex('#454b56');
  const low = hex('#262a32');
  const moss = hex('#3e5a44');
  for (let x = 0; x < w; x++) {
    // jagged silhouette: a few peaks
    const u = x / (w - 1);
    const peak = Math.sin(u * Math.PI) * 0.75 + Math.sin(u * Math.PI * 3 + seed) * 0.12 + hash(seed, x >> 1) * 0.12;
    const ht = Math.max(2, Math.round(peak * h));
    for (let y = h - ht; y < h; y++) {
      const t = (y - (h - ht)) / Math.max(1, ht);
      let col = t < 0.25 ? mix(top, mid, t * 4) : mix(mid, low, (t - 0.25) / 0.75);
      const n = hash(seed, x, y);
      if (n > 0.86) col = shade(col, 1.18);
      else if (n < 0.1) col = shade(col, 0.8);
      if (t > 0.55 && t < 0.75 && hash(seed + 7, x >> 1, y >> 1) > 0.6) col = mix(col, moss, 0.6);
      c.set(x, y, col, 1 + (1 - t) * 3 + n);
    }
  }
  // cracks
  for (let k = 0; k < 3; k++) {
    let x = Math.floor(w * (0.25 + 0.25 * k + hash(seed, k) * 0.1));
    for (let y = Math.floor(h * 0.3); y < h - 2; y++) {
      if (c.alpha(x, y)) c.set(x, y, low, 0.5);
      if (hash(seed, k, y) > 0.6) x += hash(seed, y, k) > 0.5 ? 1 : -1;
    }
  }
  c.innerOutline(hex('#14161b'));
  return { name, canvas: c, pivot: { x: Math.floor(w / 2), y: h - 1 } };
}

/** The kraken: head with eyes (eyes also as an unlit glow layer), tentacles in two poses. */
function kraken(): PropSprite[] {
  const skin = hex('#6a2c48');
  const skinL = hex('#9a4866');
  const skinD = hex('#3a1428');
  const spot = hex('#c7849a');
  const head = new Canvas(36, 26);
  for (let y = 0; y < 26; y++) {
    for (let x = 0; x < 36; x++) {
      const dx = (x - 17.5) / 17.5;
      const dy = (y - 26) / 26;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      const light = 1 - (x + y * 0.6) / 50;
      let col = mix(skinD, skinL, Math.max(0, Math.min(1, light + 0.2)));
      if (hash(3, x >> 1, y >> 1) > 0.9) col = mix(col, spot, 0.5);
      head.set(x, y, col, 1 + (1 - d) * 4);
    }
  }
  // eye sockets
  for (const ex of [11, 24]) {
    head.disc(ex, 15, 3, skinD, 3);
    head.disc(ex, 15, 2, hex('#e8d050'), 3.5);
    head.rect(ex, 14, 1, 3, hex('#101010'), 3.6);
  }
  head.innerOutline(hex('#1a0812'));
  const eyes = new Canvas(36, 26);
  for (const ex of [11, 24]) {
    eyes.disc(ex, 15, 2, hex('#fff27a'));
    eyes.rect(ex, 14, 1, 3, hex('#2a1a00'));
  }
  const tentacle = (curl: number): Canvas => {
    const t = new Canvas(12, 40);
    for (let y = 0; y < 40; y++) {
      const u = y / 39; // 0 = tip, 1 = base
      const cx = 6 + Math.sin(u * 3.2 + curl) * 3 * (1 - u * 0.6);
      const r = 0.6 + u * 2.6;
      for (let x = 0; x < 12; x++) {
        const d = Math.abs(x - cx);
        if (d > r) continue;
        const side = (x - cx) / r;
        let col = mix(skin, skinL, 0.5 - side * 0.5);
        if (side > 0.3 && y % 4 === 0 && u > 0.2) col = spot; // suction cups
        t.set(x, y, col, 1 + (1 - Math.abs(side)) * 2.5);
      }
    }
    t.innerOutline(hex('#1a0812'));
    return t;
  };
  return [
    { name: 'kraken_head', canvas: head, pivot: { x: 18, y: 25 } },
    { name: 'kraken_eyes', canvas: eyes, pivot: { x: 18, y: 25 } },
    { name: 'kraken_tentacle_a', canvas: tentacle(0), pivot: { x: 6, y: 39 } },
    { name: 'kraken_tentacle_b', canvas: tentacle(1.6), pivot: { x: 6, y: 39 } },
  ];
}

function ball(): PropSprite {
  const c = new Canvas(5, 5);
  c.disc(2, 2, 2, hex('#2a2c32'), 2);
  c.set(1, 1, hex('#7d8590'), 3);
  return { name: 'ball', canvas: c, pivot: { x: 2, y: 2 } };
}

/** 7x7 icons for speech bubbles and pings. */
function icons(): PropSprite[] {
  const icon = (name: string, rows: string[], pal: Record<string, RGBA>): PropSprite => {
    const c = new Canvas(7, 7);
    c.pattern(0, 0, rows, pal);
    return { name, canvas: c, pivot: { x: 3, y: 3 } };
  };
  const brass = hex('#b8893a');
  const dark = hex('#3a3a44');
  const grey = hex('#7d8590');
  const red = hex('#c8352c');
  const purple = hex('#7a2e58');
  const yellow = hex('#e8c040');
  return [
    icon('icon_wheel', [' b b b ', '  bbb  ', 'bbb bbb', ' bb bb ', 'bbb bbb', '  bbb  ', ' b b b '], { b: brass }),
    icon('icon_rock', ['       ', '   g   ', '  ggd  ', ' gggdd ', ' ggddd ', 'gggdddd', '~~~~~~~'], { g: grey, d: dark, '~': hex('#3d86d6') }),
    icon('icon_monster', ['  ppp  ', ' ppppp ', ' pyppy ', ' ppppp ', 'p p p p', 'p p p p', ' p   p '], { p: purple, y: yellow }),
    icon('icon_land', ['   y   ', '  ryr  ', '   w   ', '   r   ', '   w   ', '  rrr  ', ' ~~~~~ '], { y: yellow, r: red, w: hex('#e6e2d8'), '~': hex('#3d86d6') }),
    icon('icon_here', ['  rrr  ', '  rrr  ', '  rrr  ', 'rrrrrrr', ' rrrrr ', '  rrr  ', '   r   '], { r: red }),
  ];
}

export function drawHazards(): PropSprite[] {
  return [rock('rock_a', 46, 30, 1), rock('rock_b', 30, 22, 2), rock('rock_c', 38, 36, 3), ...kraken(), ball(), ...icons()];
}
