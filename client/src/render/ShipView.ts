import { Container, Graphics, Sprite } from 'pixi.js';
import {
  PIXELS_PER_METER,
  PLAYER_HALF_HEIGHT,
  TileKind,
  lerpAngle,
  shipToWorld,
  type GameState,
  type ObjectState,
  type PlayerState,
  type Simulation,
  type StationState,
} from '@lw/shared';
import { animFrame, frameOf, type ImageLayer, type Sheet, type SheetFrame } from './assets';
import type { GameRenderer } from './GameRenderer';
import { LightSystem, type LightDef } from './lighting/LightSystem';
import type { Segment } from './lighting/visibility';
import { LitSprite } from './LitSprite';
import { Particles } from './Particles';
import { WaterView } from './WaterView';
import type { Snapshot } from '../game/snapshot';

export interface GameAssets {
  hull: ImageLayer;
  back: ImageLayer;
  player: Sheet;
  props: Sheet;
}

export const PLAYER_COLORS = [0xe0503c, 0x3f8fe0, 0x52c46a, 0xb070e8];

const PPM = PIXELS_PER_METER;
const px = (m: number) => Math.round(m * PPM);

interface Lantern {
  pivotX: number;
  pivotY: number;
  angle: number;
  vel: number;
  seed: number;
  sprite: LitSprite;
  flame: Sprite;
  light: LightDef;
}

interface PlayerView {
  body: LitSprite;
  coat: Sprite;
  bubble: Container;
  bubbleIcon: Sprite;
}

interface StationView {
  parts: LitSprite[];
  moving: LitSprite | null;
  glow: Sprite | null;
}

/**
 * Everything that lives on the ship, mirrored into all render passes. Static
 * art is created once; dynamic entities (players, loose objects) are created
 * and destroyed as they appear in the state.
 */
export class ShipView {
  readonly lights: LightSystem;
  readonly water: WaterView;
  readonly waterGlint: WaterView;
  readonly leakParticles: Particles;
  private readonly layers: Record<'back' | 'stations' | 'objects' | 'players' | 'hull' | 'front' | 'water', { a: Container; n: Container }>;
  private readonly lanterns: Lantern[] = [];
  private readonly hatchClosed: LitSprite[][] = [];
  private readonly hatchOpen: LitSprite[] = [];
  private readonly stations: StationView[] = [];
  private readonly objects = new Map<number, LitSprite>();
  private readonly players = new Map<string, PlayerView>();
  private readonly leakSprites = new Map<number, LitSprite>();
  private readonly staticOccluders: Segment[];
  private hatchKey = '';
  readonly searchlight: LightDef;
  private readonly bubbleLayer: Container;
  private time = 0;

  constructor(
    private readonly r: GameRenderer,
    private readonly assets: GameAssets,
    private readonly sim: Simulation,
  ) {
    const L = sim.layout;
    const mkLayer = () => {
      const a = new Container();
      const n = new Container();
      r.albedo.ship.addChild(a);
      r.normal.ship.addChild(n);
      return { a, n };
    };
    this.layers = {
      back: mkLayer(),
      stations: mkLayer(),
      objects: mkLayer(),
      players: mkLayer(),
      hull: mkLayer(),
      front: mkLayer(),
      water: mkLayer(),
    };
    const ox = -L.origin.x * 8;
    const oy = -L.origin.y * 8;

    // static hull layers (the PNGs are aligned with tile (0,0))
    const backFrame = imageFrame('back', assets.back);
    new LitSprite(backFrame, this.layers.back.a, this.layers.back.n).setTransform(ox, oy);
    const hullFrame = imageFrame('hull', assets.hull);
    new LitSprite(hullFrame, this.layers.hull.a, this.layers.hull.n).setTransform(ox, oy);

    // mask pass: r = ship, g = interior
    // solid tiles count as interior unless they touch the outside (hull shell, top deck)
    const mask = new Graphics();
    const kindAt = (x: number, y: number) => (x < 0 || y < 0 || x >= L.width || y >= L.height ? TileKind.Exterior : L.tiles[y * L.width + x]);
    for (let y = 0; y < L.height; y++) {
      for (let x = 0; x < L.width; x++) {
        const k = kindAt(x, y);
        if (k === TileKind.Exterior) continue;
        let outside = false;
        for (let dy = -1; dy <= 1 && !outside; dy++) for (let dx = -1; dx <= 1; dx++) if (kindAt(x + dx, y + dy) === TileKind.Exterior) outside = true;
        mask.rect(ox + x * 8, oy + y * 8, 8, 8).fill(k === TileKind.Interior || !outside ? 0xffff00 : 0xff0000);
      }
    }
    r.mask.ship.addChild(mask);

    // hatches
    const P = assets.props;
    for (const h of L.hatches) {
      const tiles: LitSprite[] = [];
      for (let i = 0; i < h.width; i++) {
        const s = new LitSprite(frameOf(P, 'hatch_closed'), this.layers.front.a, this.layers.front.n);
        s.setTransform(ox + (h.tx + i) * 8, oy + h.ty * 8);
        tiles.push(s);
      }
      this.hatchClosed.push(tiles);
      const lid = new LitSprite(frameOf(P, 'hatch_open'), this.layers.stations.a, this.layers.stations.n);
      lid.setTransform(ox + h.tx * 8, oy + h.ty * 8);
      this.hatchOpen.push(lid);
    }

    // lights
    this.lights = new LightSystem(r.light.ship, r.light.world, r.rt.normal, { width: r.layout.width, height: r.layout.height });
    this.staticOccluders = L.occluders.map((s) => ({ ax: ox + s.ax * 8, ay: oy + s.ay * 8, bx: ox + s.bx * 8, by: oy + s.by * 8 }));
    this.lights.setOccluders(this.staticOccluders);

    let seed = 1;
    for (const m of L.markers) {
      if (m.type !== 'lantern') continue;
      const pivotX = ox + m.tx * 8 + 4;
      const pivotY = oy + m.ty * 8;
      const sprite = new LitSprite(frameOf(P, 'lantern'), this.layers.stations.a, this.layers.stations.n);
      const flameFrame = frameOf(P, 'lantern_flame');
      const flame = new Sprite(flameFrame.texture);
      flame.anchor.set(flameFrame.pivot.x / flameFrame.width, flameFrame.pivot.y / flameFrame.height);
      r.final.ship.addChild(flame);
      const light = this.lights.add({
        space: 'ship',
        x: pivotX,
        y: pivotY + 6,
        color: [1.0, 0.66, 0.34],
        intensity: 1.8,
        radius: 120,
        height: 16,
        cone: null,
        scatter: 0.0,
        occluded: true,
        enabled: true,
      });
      this.lanterns.push({ pivotX, pivotY, angle: 0, vel: 0, seed: seed++, sprite, flame, light });
    }

    // stations
    for (const st of sim.state.stations) this.stations.push(this.createStation(st));
    this.searchlight = this.lights.add({
      space: 'ship',
      x: 0,
      y: 0,
      color: [0.82, 0.92, 1.0],
      intensity: 2.6,
      radius: 470,
      height: 40,
      cone: { direction: 0, half: 0.19, soft: 0.025 },
      scatter: 1.6,
      occluded: true,
      enabled: true,
    });

    // hull water + leak spray (lit, in front of players)
    this.water = new WaterView(this.layers.water.a, sim.waterGeometry);
    // a faint unlit glint on the water surface keeps flooding readable in dark holds
    this.waterGlint = new WaterView(r.final.ship, sim.waterGeometry, true);
    // leak water is drawn unlit: a leak must be readable even in a dark hold
    this.leakParticles = new Particles(r.final.ship, 400);
    this.bubbleLayer = new Container();
    r.final.world.addChild(this.bubbleLayer);
  }

  private createStation(st: StationState): StationView {
    const P = this.assets.props;
    const parts: LitSprite[] = [];
    const L = this.layers.stations;
    const add = (name: string, dx: number, dy: number, layer = L) => {
      const s = new LitSprite(frameOf(P, name), layer.a, layer.n);
      s.setTransform(px(st.x) + dx, px(st.y) + dy);
      parts.push(s);
      return s;
    };
    let moving: LitSprite | null = null;
    let glow: Sprite | null = null;
    switch (st.kind) {
      case 'wheel':
        add('helm', 8, 0);
        moving = add('wheel', 8, -10);
        break;
      case 'pump':
        add('pump', 7, 0);
        moving = add('pump_handle', 7, -15);
        break;
      case 'searchlight': {
        add('searchlight_base', -5, 0);
        moving = add('searchlight_head', -5, -12);
        const gf = frameOf(P, 'searchlight_glow');
        glow = new Sprite(gf.texture);
        glow.anchor.set(gf.pivot.x / gf.width, gf.pivot.y / gf.height);
        this.r.final.ship.addChild(glow);
        break;
      }
      case 'cannon':
        add('cannon_carriage', 8, 0);
        moving = add('cannon', 6, -6);
        break;
      case 'workshop':
        add('workbench', 0, 0);
        break;
    }
    return { parts, moving, glow };
  }

  /** Searchlight lens position (ship px) and beam angle. */
  searchlightPose(view: Snapshot): { x: number; y: number; angle: number } | null {
    const st = this.sim.state.stations.find((s) => s.kind === 'searchlight');
    if (!st) return null;
    const angle = view.stations[st.id]?.value ?? st.value;
    const hx = px(st.x) - 5;
    const hy = px(st.y) - 12;
    return { x: hx + Math.cos(angle) * 7, y: hy + Math.sin(angle) * 7, angle };
  }

  update(state: GameState, view: Snapshot, dt: number): void {
    this.time += dt;
    const L = this.sim.layout;
    const ox = -L.origin.x * 8;
    const oy = -L.origin.y * 8;

    // hatches (+ their occluders when closed)
    const key = state.hatches.map((h) => (h.open ? '1' : '0')).join('');
    if (key !== this.hatchKey) {
      this.hatchKey = key;
      const segs = [...this.staticOccluders];
      state.hatches.forEach((h, i) => {
        const def = L.hatches[i]!;
        for (const t of this.hatchClosed[i]!) t.visible = !h.open;
        this.hatchOpen[i]!.visible = h.open;
        if (!h.open) {
          const x0 = ox + def.tx * 8;
          const y0 = oy + def.ty * 8;
          const x1 = x0 + def.width * 8;
          const y1 = y0 + 8;
          segs.push({ ax: x0, ay: y0, bx: x1, by: y0 }, { ax: x1, ay: y0, bx: x1, by: y1 }, { ax: x1, ay: y1, bx: x0, by: y1 }, { ax: x0, ay: y1, bx: x0, by: y0 });
        }
      });
      this.lights.setOccluders(segs);
    }

    // swinging lanterns: client-only pendulums driven by the apparent gravity
    const g = state.ship.gravity;
    const eq = Math.atan2(g.x, g.y);
    const stepDt = Math.min(dt, 1 / 30);
    for (const l of this.lanterns) {
      const acc = -(9.81 / 0.55) * Math.sin(l.angle - eq) - 0.7 * l.vel;
      l.vel += acc * stepDt;
      l.angle += l.vel * stepDt;
      l.sprite.setTransform(l.pivotX, l.pivotY, -l.angle);
      l.flame.position.set(l.pivotX, l.pivotY);
      l.flame.rotation = -l.angle;
      l.light.x = l.pivotX + Math.sin(l.angle) * 6;
      l.light.y = l.pivotY + Math.cos(l.angle) * 6;
      const t = this.time * 9 + l.seed * 13.7;
      const flicker = 0.88 + 0.07 * Math.sin(t) + 0.05 * Math.sin(t * 2.7 + 1.3) + (Math.sin(t * 0.37 + l.seed) > 0.97 ? -0.25 : 0);
      l.light.intensity = 1.8 * flicker;
      l.flame.alpha = 0.75 + 0.25 * flicker;
    }

    // stations
    state.stations.forEach((st, i) => {
      const sv = this.stations[i]!;
      const v = view.stations[i]?.value ?? st.value;
      if (!sv.moving) return;
      const base = sv.moving.albedo.position;
      switch (st.kind) {
        case 'wheel':
          sv.moving.setTransform(base.x, base.y, v * Math.PI * 1.5);
          break;
        case 'pump':
          sv.moving.setTransform(base.x, base.y, v * 0.45);
          break;
        case 'searchlight':
          sv.moving.setTransform(base.x, base.y, v);
          if (sv.glow) {
            sv.glow.position.set(base.x, base.y);
            sv.glow.rotation = v;
          }
          break;
        case 'cannon':
          sv.moving.setTransform(base.x, base.y, v);
          break;
        default:
          break;
      }
    });
    const pose = this.searchlightPose(view);
    if (pose) {
      this.searchlight.x = pose.x;
      this.searchlight.y = pose.y;
      this.searchlight.cone!.direction = pose.angle;
    }

    this.updateObjects(state, view);
    this.updatePlayers(state, view);
    this.updateLeaks(state, dt);
    this.water.update(state.compartments, this.time);
    this.waterGlint.update(state.compartments, this.time);
    this.leakParticles.update(dt);
  }

  private updateObjects(state: GameState, view: Snapshot): void {
    const seen = new Set<number>();
    for (const o of state.objects) {
      seen.add(o.id);
      let s = this.objects.get(o.id);
      if (!s) {
        s = new LitSprite(frameOf(this.assets.props, o.kind), this.layers.objects.a, this.layers.objects.n);
        this.objects.set(o.id, s);
      }
      const v = view.objects.get(o.id) ?? o;
      s.setTransform(px(v.x), px(v.y), carriedAngle(o, v.angle));
    }
    for (const [id, s] of this.objects) {
      if (!seen.has(id)) {
        s.destroy();
        this.objects.delete(id);
      }
    }
  }

  private updatePlayers(state: GameState, view: Snapshot): void {
    const seen = new Set<string>();
    for (const p of state.players) {
      seen.add(p.id);
      let pv = this.players.get(p.id);
      if (!pv) pv = this.createPlayer(p);
      const visible = p.overboard <= 0;
      pv.body.visible = visible;
      pv.coat.visible = visible;
      const v = view.players.get(p.id) ?? p;
      const frame = playerFrame(this.assets.player, p);
      pv.body.setFrame(frame);
      const x = px(v.x);
      // pivot row 23 is the boot row: shift up 1 px so the boots stand on the deck
      const y = Math.round((v.y + PLAYER_HALF_HEIGHT) * PPM) - 1;
      pv.body.setTransform(x, y, 0, p.facing, 1);
      pv.coat.texture = frame.layers.coat ?? frame.texture;
      pv.coat.anchor.copyFrom(pv.body.albedo.anchor);
      pv.coat.position.set(x, y);
      pv.coat.scale.set(p.facing, 1);

      // automatic speech bubble (unlit, world space so it never rotates)
      pv.bubble.visible = visible && p.bubble !== null;
      if (pv.bubble.visible && p.bubble) {
        const w = shipToWorld(view.ship, { x: v.x, y: v.y - PLAYER_HALF_HEIGHT - 0.2 });
        pv.bubble.position.set(Math.round(w.x * PPM) - 2, Math.round(w.y * PPM) - 2);
        pv.bubbleIcon.texture = frameOf(this.assets.props, `icon_${p.bubble.key}`).texture;
        const pop = Math.min(1, (3 - p.bubble.time) * 8);
        pv.bubble.alpha = Math.min(pop, p.bubble.time * 3);
      }
    }
    for (const [id, pv] of this.players) {
      if (!seen.has(id)) {
        pv.body.destroy();
        pv.coat.destroy();
        pv.bubble.destroy();
        this.players.delete(id);
      }
    }
  }

  private createPlayer(p: PlayerState): PlayerView {
    const f = this.assets.player.frames[0]!;
    const body = new LitSprite(f, this.layers.players.a, this.layers.players.n);
    const coat = new Sprite(f.layers.coat ?? f.texture);
    coat.tint = PLAYER_COLORS[p.color % PLAYER_COLORS.length]!;
    this.layers.players.a.addChild(coat);
    const bubble = new Container();
    const bf = frameOf(this.assets.props, 'bubble');
    const bs = new Sprite(bf.texture);
    bs.anchor.set(bf.pivot.x / bf.width, bf.pivot.y / bf.height);
    bubble.addChild(bs);
    const icon = new Sprite(frameOf(this.assets.props, 'icon_leak').texture);
    icon.position.set(2, -11);
    bubble.addChild(icon);
    this.bubbleLayer.addChild(bubble);
    const pv = { body, coat, bubble, bubbleIcon: icon };
    this.players.set(p.id, pv);
    return pv;
  }

  /**
   * Ship px y where falling water inside the hull stops: the water surface or
   * the floor of the interior span below the given tile.
   */
  floorBelow(tx: number, ty: number, state: GameState): number {
    const L = this.sim.layout;
    const comp = L.compartmentOf[ty * L.width + tx] ?? -1;
    let floor = (ty + 1 - L.origin.y) * 8;
    if (comp >= 0) {
      const span = L.compartments[comp]!.spans.find((sp) => sp.tx === tx && ty >= sp.top && ty <= sp.bottom);
      if (span) floor = (span.bottom + 1 - L.origin.y) * 8;
      const c = state.compartments[comp]!;
      const geom = this.sim.waterGeometry[comp]!;
      if (c.volume > 0.02) {
        const x = (tx + 0.5 - L.origin.x) * L.tileSize;
        floor = Math.min(floor, (c.surfaceY + c.slope * (x - geom.xMid)) * PPM);
      }
    }
    return floor - 1;
  }

  private updateLeaks(state: GameState, dt: number): void {
    const L = this.sim.layout;
    const ox = -L.origin.x * 8;
    const oy = -L.origin.y * 8;
    const latest = new Map<number, (typeof state.leaks)[number]>();
    for (const leak of state.leaks) latest.set(leak.point, leak);
    for (const [point, leak] of latest) {
      const lp = L.leakPoints[point]!;
      let s = this.leakSprites.get(point);
      const name = leak.active ? 'leak' : 'patch';
      if (!s) {
        s = new LitSprite(frameOf(this.assets.props, name), this.layers.front.a, this.layers.front.n);
        s.setTransform(ox + lp.tx * 8, oy + lp.ty * 8);
        this.leakSprites.set(point, s);
      }
      s.setFrame(frameOf(this.assets.props, name));
      if (leak.active && leak.inflow > 0) {
        // water jet + drips into the hull, in ship space with the apparent gravity
        const n = Math.min(6, leak.inflow * 40 * dt * 10);
        const cx = ox + lp.tx * 8 + 4 + lp.inward.x * 3;
        const cy = oy + lp.ty * 8 + 4 + lp.inward.y * 3;
        const g = state.ship.gravity;
        const floorY = this.floorBelow(lp.tx + lp.inward.x, lp.ty + lp.inward.y, state);
        for (let i = 0; i < n; i++) {
          if (Math.random() > 0.7) continue;
          const spd = 20 + leak.inflow * 90 * Math.random();
          const spread = (Math.random() - 0.5) * 18;
          this.leakParticles.spawn(cx, cy + (Math.random() - 0.5) * 4, lp.inward.x * spd + spread * Math.abs(lp.inward.y), lp.inward.y * spd + spread * Math.abs(lp.inward.x) - 10 * Math.random(), 0.5 + Math.random() * 0.6, Math.random() > 0.3 ? 0x9cc8e0 : 0xe0f0ff, g.x * PPM * 0.6, g.y * PPM * 0.6, 0.6, floorY);
        }
      }
    }
  }
}

function imageFrame(name: string, layer: ImageLayer): SheetFrame {
  return {
    name,
    texture: layer.texture,
    normal: layer.normal,
    layers: {},
    width: layer.texture.width,
    height: layer.texture.height,
    pivot: { x: 0, y: 0 },
    duration: 100,
  };
}

function carriedAngle(o: ObjectState, angle: number): number {
  return o.carriedBy ? 0 : angle;
}

function playerFrame(sheet: Sheet, p: PlayerState): SheetFrame {
  let tag: string = p.anim;
  if (p.carrying !== null && (tag === 'idle' || tag === 'run')) tag = `carry_${tag}`;
  if (tag === 'climb' && Math.abs(p.vy) < 0.05) return animFrame(sheet, 'climb', 0);
  return animFrame(sheet, tag, p.animTime);
}

export { lerpAngle };
