import { Container, Sprite } from 'pixi.js';
import { BOW_OFFSET, PIXELS_PER_METER, monsterHead, shipToWorld, type GameState, type RockState } from '@lw/shared';
import { frameOf, type Sheet } from './assets';
import type { GameRenderer } from './GameRenderer';
import { LitSprite } from './LitSprite';
import type { Snapshot } from '../game/snapshot';

const PPM = PIXELS_PER_METER;

interface RockView {
  sprite: LitSprite;
  lane: boolean | null;
}

/**
 * Everything dangerous outside the ship: rocks in the fog, the kraken and
 * cannonballs. Rocks in the ship's lane stand on the near sea, the others on the
 * far band (smaller, paler). All of it is lit (searchlight!) and fogged like the
 * rest of the world.
 */
export class HazardView {
  private readonly rockAlbedo = new Container();
  /** Lighthouse and its island (same depth as the rocks, in front of the far sea). */
  readonly landmarks = new Container();
  private readonly rockNormal = new Container();
  private readonly front = new Container();
  private readonly frontNormal = new Container();
  private readonly rocks = new Map<number, RockView>();
  private readonly balls = new Map<number, Sprite>();
  private readonly head: LitSprite;
  private readonly eyes: Sprite;
  private readonly tentacles: LitSprite[] = [];
  private readonly grab: LitSprite;
  private time = 0;

  constructor(
    private readonly r: GameRenderer,
    private readonly props: Sheet,
  ) {
    // between the far sea band and the near sea: the near sea hides what is under water
    const aw = r.albedo.world;
    const nearIndex = Math.max(0, aw.children.findIndex((c) => c === r.albedo.ship) - 1);
    aw.addChildAt(this.rockAlbedo, nearIndex);
    aw.addChildAt(this.landmarks, nearIndex);
    r.normal.world.addChildAt(this.rockNormal, 0);
    aw.addChild(this.front);
    r.normal.world.addChild(this.frontNormal);

    this.head = new LitSprite(frameOf(props, 'kraken_head'), this.rockAlbedo, this.rockNormal);
    for (let i = 0; i < 3; i++) this.tentacles.push(new LitSprite(frameOf(props, i % 2 ? 'kraken_tentacle_b' : 'kraken_tentacle_a'), this.rockAlbedo, this.rockNormal));
    this.grab = new LitSprite(frameOf(props, 'kraken_tentacle_a'), this.front, this.frontNormal);
    const ef = frameOf(props, 'kraken_eyes');
    this.eyes = new Sprite(ef.texture);
    this.eyes.anchor.set(ef.pivot.x / ef.width, ef.pivot.y / ef.height);
    r.final.world.addChild(this.eyes);
  }

  /** `surface(xm)` = world sea surface y in meters at world x (meters). */
  update(state: GameState, view: Snapshot, dt: number, surface: (x: number) => number, farSurface: (x: number) => number): void {
    this.time += dt;
    const left = this.r.viewLeft / PPM - 6;
    const right = (this.r.viewLeft + this.r.layout.width) / PPM + 6;

    // ---- rocks
    const seen = new Set<number>();
    for (const rock of state.rocks) {
      if (rock.x < left || rock.x > right) continue;
      seen.add(rock.id);
      const lane = Math.abs(rock.lateral - state.ship.lateral) < rock.radius + 6;
      let rv = this.rocks.get(rock.id);
      if (!rv || rv.lane !== lane) {
        rv?.sprite.destroy();
        rv = { sprite: new LitSprite(frameOf(this.props, this.rockFrame(rock, lane)), this.rockAlbedo, this.rockNormal), lane };
        this.rocks.set(rock.id, rv);
        // rocks first, kraken on top of them
        this.rockAlbedo.setChildIndex(rv.sprite.albedo, 0);
      }
      const x = Math.round(rock.x * PPM);
      if (lane) {
        const h = rv.sprite.albedo.height;
        rv.sprite.setTransform(x, Math.round(surface(rock.x) * PPM + h * 0.3));
        rv.sprite.albedo.tint = 0xffffff;
      } else {
        rv.sprite.setTransform(x, Math.round(farSurface(rock.x) * PPM + 4));
        rv.sprite.albedo.tint = 0x8c98a8;
      }
    }
    for (const [id, rv] of this.rocks) {
      if (seen.has(id)) continue;
      rv.sprite.destroy();
      this.rocks.delete(id);
    }

    // ---- kraken
    const m = state.monster;
    const showK = m !== null && m.depth < 1.1;
    this.head.visible = showK;
    this.eyes.visible = showK && m!.depth < 0.5;
    this.grab.visible = showK && m!.phase === 'attack';
    for (const t of this.tentacles) t.visible = showK;
    if (m && showK) {
      const hx = view.ship.x + m.offset;
      const headPos = monsterHead({ ...state, ship: { ...state.ship, x: view.ship.x } })!;
      const bob = Math.sin(this.time * 1.7) * 1.5;
      const x = Math.round(hx * PPM);
      const y = Math.round((headPos.y + 1.3) * PPM + bob + 4);
      this.head.setTransform(x, y);
      this.head.albedo.tint = m.hurt > 0 ? 0xffb0b0 : 0xffffff;
      this.eyes.position.set(x, y);
      this.eyes.alpha = 0.75 + 0.25 * Math.sin(this.time * 6);
      this.tentacles.forEach((t, i) => {
        const tx = hx + (i - 1) * 1.6 + (i === 1 ? 2.6 : 0);
        const sway = Math.sin(this.time * (1.3 + i * 0.4) + i * 2) * 0.35;
        const ty = surface(tx) * PPM + m.depth * 70 + 6;
        t.setTransform(Math.round(tx * PPM), Math.round(ty), (i - 1) * 0.5 + sway, i === 2 ? -1 : 1, 1);
      });
      if (m.phase === 'attack') {
        // one tentacle wraps over the bow
        const bow = shipToWorld(view.ship, { x: BOW_OFFSET - 2.2, y: 0.4 });
        const reach = Math.sin(this.time * 2.2) * 0.12;
        this.grab.setTransform(Math.round(bow.x * PPM + 10), Math.round(surface(bow.x + 0.6) * PPM + 8), -0.75 + reach + view.ship.roll, 1, 1.3);
      }
    }

    // ---- cannonballs
    const seenB = new Set<number>();
    for (const b of state.balls) {
      seenB.add(b.id);
      let s = this.balls.get(b.id);
      if (!s) {
        const f = frameOf(this.props, 'ball');
        s = new Sprite(f.texture);
        s.anchor.set(0.5);
        this.front.addChild(s);
        this.balls.set(b.id, s);
      }
      s.position.set(Math.round(b.x * PPM), Math.round(b.y * PPM));
    }
    for (const [id, s] of this.balls) {
      if (seenB.has(id)) continue;
      s.destroy();
      this.balls.delete(id);
    }
  }

  private rockFrame(rock: RockState, lane: boolean): string {
    if (!lane) return 'rock_b';
    return rock.radius > 2.7 ? 'rock_a' : rock.radius > 2.1 ? 'rock_c' : 'rock_b';
  }
}
