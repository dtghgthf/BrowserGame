export type RGBA = readonly [number, number, number, number];

export function hex(h: string, a = 255): RGBA {
  const v = h.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), a];
}

export function shade(c: RGBA, f: number): RGBA {
  const k = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return [k(c[0]), k(c[1]), k(c[2]), c[3]];
}

export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    Math.round(a[3] + (b[3] - a[3]) * t),
  ];
}

/** Deterministic integer hash -> [0,1). */
export function hash(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) {
    h ^= v | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * RGBA pixel buffer with a parallel height map (used to derive the normal map).
 * Heights are in "pixels"; 0 = background plane.
 */
export class Canvas {
  readonly data: Uint8Array;
  readonly height: Float32Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8Array(w * h * 4);
    this.height = new Float32Array(w * h);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  set(x: number, y: number, c: RGBA, height?: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    if (c[3] === 0) {
      this.data[i + 3] = 0;
      return;
    }
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
    if (height !== undefined) this.height[y * this.w + x] = height;
  }

  get(x: number, y: number): RGBA {
    if (!this.inside(x, y)) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i]!, this.data[i + 1]!, this.data[i + 2]!, this.data[i + 3]!];
  }

  alpha(x: number, y: number): number {
    if (!this.inside(x, y)) return 0;
    return this.data[(y * this.w + x) * 4 + 3]!;
  }

  getHeight(x: number, y: number): number {
    if (!this.inside(x, y)) return 0;
    return this.height[y * this.w + x]!;
  }

  setHeight(x: number, y: number, v: number): void {
    if (this.inside(x, y)) this.height[y * this.w + x] = v;
  }

  rect(x: number, y: number, w: number, h: number, c: RGBA, height?: number): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c, height);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: RGBA, height?: number): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c, height);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Filled circle (pixel-art style, integer radius). */
  disc(cx: number, cy: number, r: number, c: RGBA, height?: number): void {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r * r + r * 0.6) this.set(cx + x, cy + y, c, height);
      }
    }
  }

  /** Draws pixels from a string pattern; each char maps to a colour (space = skip). */
  pattern(x: number, y: number, rows: readonly string[], palette: Record<string, RGBA>, heights?: Record<string, number>): void {
    rows.forEach((row, yy) => {
      for (let xx = 0; xx < row.length; xx++) {
        const ch = row[xx]!;
        const c = palette[ch];
        if (c) this.set(x + xx, y + yy, c, heights?.[ch] ?? 1);
      }
    });
  }

  /** Darkens every opaque pixel that touches a transparent one (1 px outline inside the shape). */
  innerOutline(c: RGBA): void {
    const copy = new Uint8Array(this.data);
    const a = (x: number, y: number) => (this.inside(x, y) ? copy[(y * this.w + x) * 4 + 3]! : 0);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!a(x, y)) continue;
        if (!a(x - 1, y) || !a(x + 1, y) || !a(x, y - 1) || !a(x, y + 1)) this.set(x, y, c);
      }
    }
  }

  blit(src: Canvas, dx: number, dy: number): void {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const c = src.get(x, y);
        if (c[3] === 0) continue;
        this.set(dx + x, dy + y, c);
        this.setHeight(dx + x, dy + y, src.getHeight(x, y));
      }
    }
  }
}
