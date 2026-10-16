import { Canvas, hex, mix } from './canvas';

/** The app icon (home screen): the lighthouse on its rock at night, its beam across the sky. 32x32 pixel art. */
export function drawIcon(): Canvas {
  const c = new Canvas(32, 32);
  const skyTop = hex('#070b18');
  const skyLow = hex('#1a2440');
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) c.set(x, y, mix(skyTop, skyLow, y / 22));
  for (const [x, y] of [
    [4, 3],
    [9, 7],
    [26, 16],
    [2, 13],
    [7, 18],
    [29, 20],
  ] as const)
    c.set(x, y, hex('#9aa6c8'));
  // the beam: a soft wedge to the right
  for (let x = 19; x < 32; x++) {
    const spread = (x - 19) * 0.42;
    for (let y = Math.floor(8 - spread); y <= Math.ceil(8 + spread * 0.7); y++) {
      if (y < 0 || y > 21) continue;
      const k = 1 - (x - 19) / 16;
      c.set(x, y, mix(c.get(x, y), hex('#f4e6a8'), 0.25 + 0.35 * k));
    }
  }
  // the sea with a few bright crests
  for (let y = 22; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      let col = mix(hex('#18406a'), hex('#0a1c34'), (y - 22) / 10);
      if ((x + y * 3) % 11 === 0 && y < 28) col = hex('#4a7aa8');
      c.set(x, y, col);
    }
  }
  // the rock
  c.rect(9, 23, 14, 3, hex('#3a3f4a'));
  c.rect(7, 25, 18, 2, hex('#2a2e36'));
  c.rect(11, 22, 10, 1, hex('#4a505c'));
  // the tower: red and white bands, narrowing to the top
  for (let y = 10; y < 23; y++) {
    const half = 2 + Math.floor((y - 10) / 6);
    const band = Math.floor((y - 10) / 3) % 2 === 0;
    for (let x = 16 - half; x < 16 + half; x++) {
      const edge = x === 16 - half ? 0.75 : x === 16 + half - 1 ? 0.9 : 1;
      const base = band ? hex('#c8382c') : hex('#e8e2d4');
      c.set(x, y, [Math.round(base[0] * edge), Math.round(base[1] * edge), Math.round(base[2] * edge), 255]);
    }
  }
  // gallery, lantern room (lit) and roof
  c.rect(12, 9, 8, 1, hex('#2a2e36'));
  c.rect(13, 6, 6, 3, hex('#ffe9a0'));
  c.rect(14, 6, 1, 3, hex('#d8b860'));
  c.rect(17, 6, 1, 3, hex('#d8b860'));
  c.rect(13, 5, 6, 1, hex('#7a2a22'));
  c.rect(14, 4, 4, 1, hex('#7a2a22'));
  c.set(15, 3, hex('#7a2a22'));
  c.set(16, 3, hex('#7a2a22'));
  // a faint glow around the lamp
  for (const [x, y] of [
    [12, 7],
    [19, 7],
    [12, 6],
    [19, 6],
  ] as const)
    c.set(x, y, mix(c.get(x, y), hex('#ffe9a0'), 0.45));
  return c;
}

/** Nearest-neighbour scale onto a square of `size` px, the art `fill` of the size, centred on `bg`. */
export function iconAt(art: Canvas, size: number, fill: number, bg: readonly [number, number, number, number]): Uint8Array {
  const scale = Math.max(1, Math.floor((size * fill) / art.w));
  const off = Math.floor((size - art.w * scale) / 2);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x - off) / scale);
      const sy = Math.floor((y - off) / scale);
      const p = sx >= 0 && sy >= 0 && sx < art.w && sy < art.h ? art.get(sx, sy) : bg;
      data.set(p[3] > 0 ? p : bg, (y * size + x) * 4);
    }
  }
  return data;
}
