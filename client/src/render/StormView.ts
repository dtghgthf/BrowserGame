import { Graphics } from 'pixi.js';
import type { GameRenderer } from './GameRenderer';

interface Drop {
  x: number;
  y: number;
  speed: number;
}

/**
 * Rain streaks (screen space, unlit, over the world) and lightning flashes once
 * the sea gets rough. Pure decoration - no gameplay, so it may use Math.random.
 */
export class StormView {
  private readonly g = new Graphics();
  private readonly drops: Drop[] = [];
  private nextFlash = 6;
  private flashes = 0;
  /** Called when lightning strikes (for thunder). */
  onLightning: (strength: number) => void = () => {};

  constructor(private readonly r: GameRenderer) {
    r.final.root.addChild(this.g);
  }

  update(dt: number, seaState: number): void {
    const W = this.r.layout.width;
    const H = this.r.layout.height;
    const rain = Math.max(0, Math.min(1, (seaState - 0.9) / 0.4));
    const want = Math.round(rain * 220);
    while (this.drops.length < want) this.drops.push({ x: Math.random() * (W + 40), y: Math.random() * H, speed: 260 + Math.random() * 140 });
    this.drops.length = Math.min(this.drops.length, want);
    const wind = 0.35;
    this.g.clear();
    for (const d of this.drops) {
      d.y += d.speed * dt;
      d.x -= d.speed * wind * dt;
      if (d.y > H || d.x < -4) {
        d.y = -4;
        d.x = Math.random() * (W + 40);
      }
      const x = Math.round(d.x);
      const y = Math.round(d.y);
      this.g.moveTo(x, y).lineTo(x + 2, y - 5);
    }
    if (this.drops.length) this.g.stroke({ color: 0xa8b8d0, width: 1, alpha: 0.28, pixelLine: true });

    // lightning: a flash (sometimes double) every few seconds in a real storm
    this.r.flash = Math.max(0, this.r.flash - dt * 4);
    if (seaState < 1.05) return;
    this.nextFlash -= dt;
    if (this.nextFlash <= 0) {
      const strength = 0.5 + Math.random() * 0.5;
      this.r.flash = strength;
      this.onLightning(strength);
      this.flashes = Math.random() < 0.4 ? 1 : 0;
      this.nextFlash = this.flashes ? 0.15 : 6 + Math.random() * 12 * (1.5 - Math.min(1.4, seaState));
    }
  }
}
