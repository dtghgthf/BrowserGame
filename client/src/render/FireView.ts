import { Sprite, type Container } from 'pixi.js';
import { PIXELS_PER_TILE, type FireState, type GameState, type ShipLayout } from '@lw/shared';
import { frameOf, type Sheet } from './assets';
import type { LightDef, LightSystem } from './lighting/LightSystem';
import type { Particles } from './Particles';

/** Fire lights at most (the hottest fires get one). */
const LIGHTS = 6;

/**
 * Fires on the decks: unlit flame sprites (they are their own light), a pool of
 * flickering point lights and smoke puffs. Ship space, like everything on board.
 */
export class FireView {
  private readonly flames = new Map<number, Sprite>();
  private readonly lights: LightDef[] = [];
  private time = 0;

  constructor(
    private readonly layer: Container,
    private readonly props: Sheet,
    lights: LightSystem,
    private readonly smoke: Particles,
    private readonly layout: ShipLayout,
  ) {
    for (let i = 0; i < LIGHTS; i++) {
      this.lights.push(
        lights.add({
          space: 'ship',
          x: 0,
          y: 0,
          color: [1.0, 0.55, 0.22],
          intensity: 0,
          radius: 80,
          height: 12,
          cone: null,
          scatter: 0.3,
          occluded: true,
          enabled: false,
        }),
      );
    }
  }

  /** Ship px of the bottom centre of a fire tile. */
  private pos(f: FireState): { x: number; y: number } {
    const T = PIXELS_PER_TILE;
    return { x: (f.tx - this.layout.origin.x) * T + T / 2, y: (f.ty + 1 - this.layout.origin.y) * T };
  }

  update(state: GameState, dt: number): void {
    this.time += dt;
    const seen = new Set<number>();
    for (const f of state.fires) {
      seen.add(f.id);
      let s = this.flames.get(f.id);
      if (!s) {
        s = new Sprite();
        this.layer.addChild(s);
        this.flames.set(f.id, s);
      }
      const frame = frameOf(this.props, `flame_${Math.floor(this.time * 10 + f.id * 1.7) % 4}`);
      s.texture = frame.texture;
      s.anchor.set(frame.pivot.x / frame.width, frame.pivot.y / frame.height);
      const p = this.pos(f);
      s.position.set(p.x, p.y);
      const k = 0.45 + f.heat * 0.75;
      s.scale.set(f.id % 2 ? -k : k, k);
      // smoke rising (it is lit: dark grey in the hold, visible in the lantern light)
      if (Math.random() < f.heat * 6 * dt) {
        const grey = Math.random() > 0.5 ? 0x3a3a40 : 0x55555c;
        this.smoke.spawn(p.x + (Math.random() - 0.5) * 6, p.y - 10 * k, (Math.random() - 0.5) * 6, -10 - Math.random() * 10, 1.4 + Math.random(), grey, 0, -6, 0.6);
      }
    }
    for (const [id, s] of this.flames) {
      if (seen.has(id)) continue;
      s.destroy();
      this.flames.delete(id);
    }
    // lights on the hottest fires
    const hot = [...state.fires].sort((a, b) => b.heat - a.heat);
    this.lights.forEach((l, i) => {
      const f = hot[i];
      l.enabled = !!f;
      if (!f) return;
      const p = this.pos(f);
      const t = this.time * 13 + f.id * 3.1;
      l.x = p.x;
      l.y = p.y - 6;
      l.intensity = (0.9 + 0.8 * f.heat) * (0.8 + 0.12 * Math.sin(t) + 0.08 * Math.sin(t * 2.3));
    });
  }
}
