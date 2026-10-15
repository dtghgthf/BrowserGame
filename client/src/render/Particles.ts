import { Particle, ParticleContainer, Texture, type Container } from 'pixi.js';

interface P {
  sprite: Particle;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  gx: number;
  gy: number;
  drag: number;
  /** y (in the particle space) below which the particle dies (e.g. the water surface); NaN = never. */
  floorY: number;
}

/**
 * Tiny pixel particles (1x1 px, client-only decoration). Positions are rounded
 * to whole pixels so they stay crisp in the low-res buffer.
 */
export class Particles {
  readonly container: ParticleContainer;
  private readonly pool: P[] = [];
  private readonly alive: P[] = [];

  constructor(parent: Container, private readonly max = 600) {
    this.container = new ParticleContainer({ dynamicProperties: { position: true, color: true, vertex: false, rotation: false, uvs: false } });
    parent.addChild(this.container);
  }

  spawn(x: number, y: number, vx: number, vy: number, life: number, color: number, gx = 0, gy = 300, drag = 0.4, floorY = NaN): void {
    if (this.alive.length >= this.max) return;
    let p = this.pool.pop();
    if (!p) {
      p = { sprite: new Particle({ texture: Texture.WHITE, anchorX: 0, anchorY: 0 }), x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, gx: 0, gy: 0, drag: 0, floorY: NaN };
    }
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.maxLife = life;
    p.gx = gx;
    p.gy = gy;
    p.drag = drag;
    p.floorY = floorY;
    p.sprite.tint = color;
    p.sprite.alpha = 1;
    this.alive.push(p);
    this.container.addParticle(p.sprite);
  }

  update(dt: number): void {
    for (let i = this.alive.length - 1; i >= 0; i--) {
      const p = this.alive[i]!;
      p.life -= dt;
      p.vx += p.gx * dt;
      p.vy += p.gy * dt;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0 || p.y > p.floorY) {
        this.container.removeParticle(p.sprite);
        this.alive.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      p.sprite.x = Math.round(p.x);
      p.sprite.y = Math.round(p.y);
      p.sprite.alpha = Math.min(1, (p.life / p.maxLife) * 2.5);
    }
  }

  get count(): number {
    return this.alive.length;
  }
}
