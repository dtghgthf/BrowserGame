import { Canvas } from './canvas';

/**
 * Builds a tangent-space normal map from the canvas' height map.
 * Convention (same as Laigter / SpriteIlluminator defaults): R = +x right,
 * G = +y UP, B = z towards the viewer. Transparent pixels stay transparent.
 *
 * `bevel` adds rounded edges: pixels close to the silhouette are lowered.
 */
export function normalMap(src: Canvas, strength = 1.0, bevel = 2): Uint8Array {
  const { w, h } = src;
  const H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!src.alpha(x, y)) continue;
      let d = bevel;
      if (bevel > 0) {
        for (let r = 1; r <= bevel && d === bevel; r++) {
          for (let k = -r; k <= r; k++) {
            if (!src.alpha(x + k, y - r) || !src.alpha(x + k, y + r) || !src.alpha(x - r, y + k) || !src.alpha(x + r, y + k)) {
              d = r - 1;
              break;
            }
          }
        }
      }
      const edge = bevel > 0 ? (d + 0.5) / (bevel + 0.5) : 1;
      H[y * w + x] = src.getHeight(x, y) + edge * 1.5;
    }
  }
  const at = (x: number, y: number, fx: number, fy: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h || !src.alpha(x, y)) return H[fy * w + fx]! - 0.8;
    return H[y * w + x]!;
  };
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = src.alpha(x, y);
      const i = (y * w + x) * 4;
      if (!a) continue;
      // Sobel
      const tl = at(x - 1, y - 1, x, y);
      const t = at(x, y - 1, x, y);
      const tr = at(x + 1, y - 1, x, y);
      const l = at(x - 1, y, x, y);
      const r = at(x + 1, y, x, y);
      const bl = at(x - 1, y + 1, x, y);
      const b = at(x, y + 1, x, y);
      const br = at(x + 1, y + 1, x, y);
      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) / 8;
      const dyDown = (bl + 2 * b + br - (tl + 2 * t + tr)) / 8;
      // surface normal (screen y-down): (-dh/dx, -dh/dy, 1); store y UP
      let nx = -dx * strength;
      let nyUp = dyDown * strength;
      let nz = 1;
      const len = Math.hypot(nx, nyUp, nz);
      nx /= len;
      nyUp /= len;
      nz /= len;
      out[i] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((nyUp * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out[i + 3] = a;
    }
  }
  return out;
}
