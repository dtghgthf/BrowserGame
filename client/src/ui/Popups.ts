import { Container } from 'pixi.js';
import { PIXELS_PER_METER, shipToWorld } from '@lw/shared';
import type { Snapshot } from '../game/snapshot';
import { PixelFont, PixelText } from './PixelFont';

const PPM = PIXELS_PER_METER;

interface Popup {
  text: PixelText;
  /** Ship-local meters. */
  x: number;
  y: number;
  age: number;
  delay: number;
  /** Pixels above the first line (lines stack). */
  lift: number;
}

/** Short texts rising from a spot on the ship ("+ PLANKE", "+12 MÜNZEN", "GERETTET!"). HUD layer. */
export class Popups {
  readonly root = new Container();
  private readonly items: Popup[] = [];

  constructor(private readonly font: PixelFont) {}

  /** Several lines appear one after the other. */
  add(lines: readonly string[], x: number, y: number, color = 0xe0b860): void {
    lines.forEach((line, i) => {
      const text = new PixelText(this.font, line, color);
      text.visible = false;
      this.root.addChild(text);
      this.items.push({ text, x, y, age: 0, delay: i * 0.25, lift: i * 8 });
    });
  }

  update(dt: number, view: Snapshot, left: number, top: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i]!;
      p.age += dt;
      const t = p.age - p.delay;
      if (t > 1.8) {
        p.text.destroy();
        this.items.splice(i, 1);
        continue;
      }
      p.text.visible = t >= 0;
      if (t < 0) continue;
      const w = shipToWorld(view.ship, { x: p.x, y: p.y });
      p.text.position.set(Math.round(w.x * PPM - left - p.text.textWidth / 2), Math.round(w.y * PPM - top - 10 - p.lift - t * 12));
      p.text.alpha = t > 1.3 ? (1.8 - t) * 2 : 1;
    }
  }
}
