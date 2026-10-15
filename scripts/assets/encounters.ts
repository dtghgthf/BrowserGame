import { Canvas, hash, hex, mix, shade, type RGBA } from './canvas';
import type { PropSprite } from './props';

/**
 * Phase 5 encounter art: fire, the pirates' sloop and its grappling hook, ice
 * floes, drifting crates, swimmers, the empty life ring post.
 */

const WOOD = hex('#5a3a22');
const WOOD_L = hex('#7a5232');
const WOOD_D = hex('#3a2414');
const OUT = hex('#140c06');

/** Four frames of a flame tile (unlit: drawn into the final pass, it is its own light). */
function flames(): PropSprite[] {
  const out: PropSprite[] = [];
  const cols: RGBA[] = [hex('#fff4b0'), hex('#ffd060'), hex('#ff8a2a'), hex('#d8401c'), hex('#7a1a10')];
  for (let f = 0; f < 4; f++) {
    const c = new Canvas(10, 14);
    for (let y = 0; y < 14; y++) {
      for (let x = 0; x < 10; x++) {
        const u = (13 - y) / 13; // 0 = bottom, 1 = top
        const sway = Math.sin(u * 4 + f * 1.6) * 1.4 * u;
        const w = (1 - u) * 4.6 + 0.4 + hash(f, y) * 0.8;
        const d = Math.abs(x + 0.5 - 5 - sway);
        if (d > w) continue;
        if (u > 0.55 && hash(f, x, y) > 0.75) continue;
        const heat = (1 - d / w) * (1 - u * 0.7);
        const i = Math.max(0, Math.min(4, Math.floor((1 - heat) * 5)));
        c.set(x, y, cols[i]!);
      }
    }
    out.push({ name: `flame_${f}`, canvas: c, pivot: { x: 5, y: 13 } });
  }
  return out;
}

/** The pirates' sloop: dark hull, black sail with a skull, a little cannon port. */
function sloop(): PropSprite[] {
  const W = 64;
  const H = 52;
  const c = new Canvas(W, H);
  // hull (bow on the left: it faces our ship coming from behind... it sails ahead, facing us)
  for (let x = 0; x < W; x++) {
    const u = x / (W - 1);
    const top = 36 - Math.round(Math.sin(u * Math.PI) * 2) - (u < 0.12 ? Math.round((0.12 - u) * 30) : 0);
    const bottom = 46 + Math.round(Math.sin(u * Math.PI) * 5);
    for (let y = top; y <= bottom; y++) {
      let col = y - top < 2 ? WOOD_L : mix(WOOD, WOOD_D, (y - top) / (bottom - top));
      if ((y - top) % 4 === 3) col = shade(col, 0.8);
      c.set(x, y, col, 1.5 + Math.sin(((y - top) / (bottom - top)) * Math.PI) * 2);
    }
  }
  // red stripe + gun ports
  for (let x = 4; x < W - 4; x++) c.set(x, 40, hex('#8a2a20'), 2.4);
  for (const gx of [16, 30, 44]) c.rect(gx, 39, 3, 3, hex('#100808'), 1);
  // mast + sail + flag
  c.rect(31, 4, 2, 33, WOOD_D, 2.6);
  for (let y = 7; y < 32; y++) {
    const w = 10 + Math.round(Math.sin(((y - 7) / 25) * Math.PI) * 4);
    for (let x = 33; x < 33 + w; x++) c.set(x, y, mix(hex('#1c1a20'), hex('#34303a'), (x - 33) / w), 1.5 + (x - 33) / w);
    for (let x = 31 - Math.round(w * 0.7); x < 31; x++) c.set(x, y, hex('#24222a'), 1.3);
  }
  // skull on the sail
  const skull = ['  www  ', ' wwwww ', ' wdwdw ', ' wwwww ', '  w w  ', ' w   w ', 'w     w'];
  c.pattern(36, 14, skull, { w: hex('#e6e2d8'), d: hex('#1c1a20') }, { w: 2.5, d: 1.5 });
  c.rect(33, 2, 6, 3, hex('#c8352c'), 2);
  c.innerOutline(OUT);
  // lantern glow at the stern (unlit layer)
  const glow = new Canvas(W, H);
  glow.disc(58, 33, 1, hex('#ffcc66'));
  return [
    { name: 'sloop', canvas: c, pivot: { x: 32, y: 44 } },
    { name: 'sloop_glow', canvas: glow, pivot: { x: 32, y: 44 } },
  ];
}

function hook(): PropSprite {
  const c = new Canvas(7, 8);
  const I = hex('#5a5e68');
  const L = hex('#9aa2ae');
  c.rect(3, 0, 1, 5, I, 2);
  c.set(3, 0, L, 3);
  c.pattern(0, 4, ['L  I  L', 'I  I  I', ' I I I ', '  III  '], { I, L }, { I: 2.5, L: 3 });
  return { name: 'hook', canvas: c, pivot: { x: 3, y: 0 } };
}

/** Ice floe: pale blue, flat on top, mostly under water. */
function ice(name: string, w: number, h: number, seed: number): PropSprite {
  const c = new Canvas(w, h);
  const top = hex('#e8f6ff');
  const mid = hex('#a8d4ec');
  const low = hex('#5a8cb0');
  for (let x = 0; x < w; x++) {
    const u = x / (w - 1);
    const shape = Math.min(1, Math.sin(u * Math.PI) * 1.6) * 0.85 + hash(seed, x >> 2) * 0.15;
    const ht = Math.max(2, Math.round(shape * h));
    for (let y = h - ht; y < h; y++) {
      const t = (y - (h - ht)) / Math.max(1, ht);
      let col = t < 0.15 ? top : t < 0.5 ? mix(top, mid, (t - 0.15) / 0.35) : mix(mid, low, (t - 0.5) / 0.5);
      if (hash(seed, x, y) > 0.9) col = shade(col, 1.1);
      c.set(x, y, col, 1 + (1 - t) * 3);
    }
  }
  c.innerOutline(hex('#2a4a66'));
  return { name, canvas: c, pivot: { x: Math.floor(w / 2), y: h - 1 } };
}

/** A crate drifting in the water (the sea cuts off the bottom). */
function flotsam(): PropSprite {
  const c = new Canvas(12, 11);
  for (let y = 0; y < 11; y++) {
    for (let x = 0; x < 12; x++) {
      let col = (y >> 1) % 2 ? WOOD_L : WOOD;
      if (y % 3 === 2) col = WOOD_D;
      c.set(x, y, col, 2);
    }
  }
  for (let i = 1; i < 10; i++) c.set(i + 1, i, hex('#9a6a3e'), 2.6);
  c.rect(0, 3, 12, 1, hex('#2a4a66'), 1);
  c.innerOutline(OUT);
  return { name: 'flotsam', canvas: c, pivot: { x: 6, y: 8 } };
}

/** A swimmer: head and waving arms above the water; the coat layer is tinted like the player. */
function swimmer(): PropSprite[] {
  const out: PropSprite[] = [];
  const skin = hex('#e0b090');
  const hair = hex('#4a3020');
  for (let f = 0; f < 2; f++) {
    const c = new Canvas(14, 10);
    c.disc(7, 5, 2, skin, 3);
    c.rect(5, 2, 5, 2, hair, 3);
    c.set(6, 5, hex('#202020'), 3);
    c.set(8, 5, hex('#202020'), 3);
    const coat = hex('#d8d8d8');
    // arms waving
    if (f === 0) {
      c.line(4, 7, 1, 2, coat, 2);
      c.line(10, 7, 13, 3, coat, 2);
    } else {
      c.line(4, 7, 1, 5, coat, 2);
      c.line(10, 7, 13, 1, coat, 2);
    }
    c.rect(5, 8, 5, 2, coat, 2);
    out.push({ name: `swimmer_${f}`, canvas: c, pivot: { x: 7, y: 8 } });
  }
  return out;
}

function emptyPost(): PropSprite {
  const post = new Canvas(11, 18);
  post.rect(4, 6, 2, 12, WOOD_D, 2);
  post.rect(4, 6, 1, 12, WOOD, 2.2);
  post.rect(3, 6, 4, 1, hex('#5a5e68'), 2.6);
  post.rect(1, 16, 8, 2, WOOD, 1.8);
  for (let i = 0; i < 2; i++) post.rect(2, 15 - i, 6, 1, i % 2 ? hex('#c8b080') : hex('#a08860'), 2);
  post.innerOutline(OUT);
  return { name: 'ring_post_empty', canvas: post, pivot: { x: 5, y: 18 } };
}

export function drawEncounters(): PropSprite[] {
  return [...flames(), ...sloop(), hook(), ice('ice_a', 34, 20, 1), ice('ice_b', 22, 14, 2), flotsam(), ...swimmer(), emptyPost()];
}
