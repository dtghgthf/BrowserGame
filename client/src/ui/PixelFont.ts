import { Container, Sprite, Texture, Rectangle } from 'pixi.js';

/** 3x5 pixel font (uppercase, digits, a little punctuation, German umlauts). One string per row. */
const GLYPHS: Record<string, readonly string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '.#.', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  '.': ['...', '...', '...', '...', '.#.'],
  ',': ['...', '...', '...', '.#.', '#..'],
  ':': ['...', '.#.', '...', '.#.', '...'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  '-': ['...', '...', '###', '...', '...'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  '(': ['.#.', '#..', '#..', '#..', '.#.'],
  ')': ['.#.', '..#', '..#', '..#', '.#.'],
  "'": ['.#.', '.#.', '...', '...', '...'],
  '°': ['###', '#.#', '###', '...', '...'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'],
  '=': ['...', '###', '...', '###', '...'],
  '_': ['...', '...', '...', '...', '###'],
  'Ä': ['#.#', '.#.', '#.#', '###', '#.#'],
  'Ö': ['#.#', '...', '###', '#.#', '###'],
  'Ü': ['#.#', '...', '#.#', '#.#', '###'],
  '#': ['#.#', '###', '#.#', '###', '#.#'],
  '[': ['##.', '#..', '#..', '#..', '##.'],
  ']': ['.##', '..#', '..#', '..#', '.##'],
  '^': ['.#.', '#.#', '...', '...', '...'],
};

export const GLYPH_W = 3;
export const GLYPH_H = 5;
export const ADVANCE = 4;

export class PixelFont {
  readonly textures = new Map<string, Texture>();

  constructor() {
    const chars = Object.keys(GLYPHS);
    const cols = 16;
    const canvas = document.createElement('canvas');
    canvas.width = cols * 4;
    canvas.height = Math.ceil(chars.length / cols) * 6;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    chars.forEach((ch, i) => {
      const gx = (i % cols) * 4;
      const gy = Math.floor(i / cols) * 6;
      GLYPHS[ch]!.forEach((row, y) => {
        for (let x = 0; x < 3; x++) if (row[x] === '#') ctx.fillRect(gx + x, gy + y, 1, 1);
      });
    });
    const base = Texture.from(canvas);
    base.source.scaleMode = 'nearest';
    chars.forEach((ch, i) => {
      const gx = (i % cols) * 4;
      const gy = Math.floor(i / cols) * 6;
      this.textures.set(ch, new Texture({ source: base.source, frame: new Rectangle(gx, gy, GLYPH_W, GLYPH_H) }));
    });
  }

  measure(text: string): number {
    return Math.max(0, text.length * ADVANCE - 1);
  }
}

/** Text made of glyph sprites, with an optional 1 px drop shadow for readability. */
export class PixelText extends Container {
  private current = '';
  private readonly glyphs: Sprite[] = [];
  private readonly shadows: Sprite[] = [];
  private color: number;

  constructor(
    private readonly font: PixelFont,
    text = '',
    color = 0xffffff,
    private readonly shadow: number | null = 0x05070d,
  ) {
    super();
    this.color = color;
    this.text = text;
  }

  get text(): string {
    return this.current;
  }

  set text(v: string) {
    v = v.toUpperCase();
    if (v === this.current) return;
    this.current = v;
    let n = 0;
    for (let i = 0; i < v.length; i++) {
      const tex = this.font.textures.get(v[i]!);
      if (!tex) continue;
      if (this.shadow !== null) this.place(this.shadows, n, tex, i * ADVANCE + 1, 1, this.shadow);
      this.place(this.glyphs, n, tex, i * ADVANCE, 0, this.color);
      n++;
    }
    for (let k = n; k < this.glyphs.length; k++) {
      this.glyphs[k]!.visible = false;
      if (this.shadows[k]) this.shadows[k]!.visible = false;
    }
  }

  setColor(c: number): void {
    if (c === this.color) return;
    this.color = c;
    for (const g of this.glyphs) g.tint = c;
  }

  get textWidth(): number {
    return this.font.measure(this.current);
  }

  private place(pool: Sprite[], i: number, tex: Texture, x: number, y: number, tint: number): void {
    let s = pool[i];
    if (!s) {
      s = new Sprite(tex);
      pool[i] = s;
      // shadows first so they stay behind the glyphs
      if (pool === this.shadows) this.addChildAt(s, 0);
      else this.addChild(s);
    }
    s.texture = tex;
    s.position.set(x, y);
    s.tint = tint;
    s.visible = true;
  }
}
