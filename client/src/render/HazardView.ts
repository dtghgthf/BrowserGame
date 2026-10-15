import { Container, Graphics, Sprite } from 'pixi.js';
import {
  BOW_OFFSET,
  PIXELS_PER_METER,
  RING_ANCHOR,
  hookPoint,
  monsterHead,
  pirateShip,
  shipToWorld,
  type GameState,
  type RockState,
  type ShipLayout,
} from '@lw/shared';
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
  private readonly sloop: LitSprite;
  private readonly sloopGlow: Sprite;
  private readonly hook: LitSprite;
  /** Lines (hook rope, life ring line) and whirlpool foam, drawn in front of the near sea. */
  private readonly lines = new Graphics();
  private readonly flotsam = new Map<number, { sprite: LitSprite; lane: boolean }>();
  private readonly swimmers = new Map<string, Sprite>();
  private readonly ring: LitSprite;
  private time = 0;

  constructor(
    private readonly r: GameRenderer,
    private readonly props: Sheet,
    private readonly layout: ShipLayout,
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

    this.sloop = new LitSprite(frameOf(props, 'sloop'), this.rockAlbedo, this.rockNormal);
    const sg = frameOf(props, 'sloop_glow');
    this.sloopGlow = new Sprite(sg.texture);
    this.sloopGlow.anchor.set(sg.pivot.x / sg.width, sg.pivot.y / sg.height);
    r.final.world.addChild(this.sloopGlow);
    this.front.addChild(this.lines);
    this.hook = new LitSprite(frameOf(props, 'hook'), this.front, this.frontNormal);
    this.ring = new LitSprite(frameOf(props, 'life_ring'), this.front, this.frontNormal);
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

    this.lines.clear();
    this.updateEncounters(state, view, surface, farSurface, left, right);

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

  private updateEncounters(
    state: GameState,
    view: Snapshot,
    surface: (x: number) => number,
    farSurface: (x: number) => number,
    left: number,
    right: number,
  ): void {
    const ship = { ...state.ship, x: view.ship.x, y: view.ship.y, roll: view.ship.roll };
    const t = this.time;

    // ---- the pirates' sloop, bobbing on the near sea ahead of the bow
    const pr = state.pirate;
    const sl = pr ? pirateShip({ ...state, ship }) : null;
    this.sloop.visible = !!sl;
    this.sloopGlow.visible = !!sl;
    this.hook.visible = false;
    if (pr && sl) {
      const x = Math.round(sl.x * PPM);
      const slope = (surface(sl.x + 2) - surface(sl.x - 2)) / 4;
      const y = Math.round(surface(sl.x) * PPM + 6 + Math.sin(t * 1.3) * 1);
      this.sloop.setTransform(x, y, Math.atan(slope) * 0.8);
      this.sloop.albedo.tint = pr.hurt > 0 ? 0xffb0a0 : 0xffffff;
      this.sloopGlow.position.set(x, y);
      this.sloopGlow.rotation = this.sloop.albedo.rotation;
      if (pr.hook > 0) {
        // rope from the sloop's bow to the hook on our railing
        const hp = shipToWorld(ship, hookPoint(this.layout));
        const fromX = x - 28;
        const fromY = y - 8;
        const toX = Math.round(hp.x * PPM);
        const toY = Math.round(hp.y * PPM) - 2;
        const sag = 6 + Math.sin(t * 2) * 1.5;
        this.rope(fromX, fromY, toX, toY, sag, 0x8a7448);
        this.hook.visible = true;
        this.hook.setTransform(toX, toY - 1, ship.roll);
      }
    }

    // ---- whirlpool: foam spiralling on the sea surface
    const w = state.whirl;
    if (w && w.x > left - 20 && w.x < right + 20) {
      const lane = Math.abs(w.lateral - state.ship.lateral) < w.radius + 4;
      const scale = lane ? 1 : 0.45;
      const surf = lane ? surface : farSurface;
      for (let arm = 0; arm < 3; arm++) {
        for (let k = 0; k < 26; k++) {
          const u = k / 25;
          const ang = arm * 2.094 + u * 5 - t * 2.2;
          const rad = (1 - u) * w.radius * 0.6 * scale;
          const wx = w.x + Math.cos(ang) * rad;
          const px = Math.round(wx * PPM);
          const py = Math.round(surf(wx) * PPM + 2 + Math.sin(ang) * rad * 1.2 + u * 4 * scale);
          this.lines.rect(px, py, u > 0.8 ? 1 : 2, 1).fill({ color: u > 0.6 ? 0x2a5070 : 0xd8ecf4, alpha: lane ? 0.85 : 0.5 });
        }
      }
    }

    // ---- flotsam crates
    const seenF = new Set<number>();
    for (const f of state.flotsam) {
      if (f.x < left || f.x > right) continue;
      seenF.add(f.id);
      const lane = Math.abs(f.lateral - state.ship.lateral) < 6;
      let fv = this.flotsam.get(f.id);
      if (!fv || fv.lane !== lane) {
        fv?.sprite.destroy();
        fv = { sprite: new LitSprite(frameOf(this.props, 'flotsam'), lane ? this.front : this.rockAlbedo, lane ? this.frontNormal : this.rockNormal), lane };
        this.flotsam.set(f.id, fv);
      }
      const bob = Math.sin(t * 2 + f.id) * 1.5;
      if (lane) {
        fv.sprite.setTransform(Math.round(f.x * PPM), Math.round(surface(f.x) * PPM + 3 + bob), Math.sin(t * 1.4 + f.id) * 0.2);
        fv.sprite.albedo.tint = 0xffffff;
      } else {
        fv.sprite.setTransform(Math.round(f.x * PPM), Math.round(farSurface(f.x) * PPM + 3), 0, 0.6, 0.6);
        fv.sprite.albedo.tint = 0x8c98a8;
      }
    }
    for (const [id, fv] of this.flotsam) {
      if (seenF.has(id)) continue;
      fv.sprite.destroy();
      this.flotsam.delete(id);
    }

    // ---- swimmers (players overboard)
    const seenS = new Set<string>();
    for (const p of state.players) {
      if (p.overboard <= 0) continue;
      seenS.add(p.id);
      let sp = this.swimmers.get(p.id);
      if (!sp) {
        sp = new Sprite();
        this.front.addChild(sp);
        this.swimmers.set(p.id, sp);
      }
      const frame = frameOf(this.props, `swimmer_${Math.floor(t * 3) % 2}`);
      sp.texture = frame.texture;
      sp.anchor.set(frame.pivot.x / frame.width, frame.pivot.y / frame.height);
      sp.position.set(Math.round(p.seaX * PPM), Math.round(surface(p.seaX) * PPM + 3 + Math.sin(t * 2.5) * 1));
    }
    for (const [id, sp] of this.swimmers) {
      if (seenS.has(id)) continue;
      sp.destroy();
      this.swimmers.delete(id);
    }

    // ---- the life ring and its line
    const ring = state.ring;
    this.ring.visible = !!ring;
    if (ring) {
      const st = state.stations.find((x) => x.kind === 'ring');
      const rx = Math.round(ring.x * PPM);
      const ry = Math.round((ring.phase === 'flying' ? ring.y : surface(ring.x)) * PPM + (ring.phase === 'flying' ? 0 : 2));
      this.ring.setTransform(rx, ry, ring.phase === 'flying' ? t * 8 : Math.sin(t * 2) * 0.2);
      if (st) {
        const a = shipToWorld(ship, { x: st.x + RING_ANCHOR.x, y: st.y + RING_ANCHOR.y });
        this.rope(Math.round(a.x * PPM), Math.round(a.y * PPM), rx, ry, ring.phase === 'pulling' ? 1 : 5, 0xd8c8a0);
      }
    }
  }

  /** A sagging rope as a pixel polyline. */
  private rope(x0: number, y0: number, x1: number, y1: number, sag: number, color: number): void {
    const n = Math.max(4, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 3));
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = x0 + (x1 - x0) * u;
      const y = y0 + (y1 - y0) * u + Math.sin(u * Math.PI) * sag;
      this.lines.rect(Math.round(x), Math.round(y), 1, 1).fill(color);
    }
  }

  private rockFrame(rock: RockState, lane: boolean): string {
    if (rock.kind === 'ice') return lane && rock.radius > 2 ? 'ice_a' : 'ice_b';
    if (!lane) return 'rock_b';
    return rock.radius > 2.7 ? 'rock_a' : rock.radius > 2.1 ? 'rock_c' : 'rock_b';
  }
}
