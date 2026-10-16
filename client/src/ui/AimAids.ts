import { Container, Graphics } from 'pixi.js';
import {
  CANNON_LENGTH,
  CANNON_PIVOT,
  PIRATE_HALF_LENGTH,
  PIRATE_HEIGHT,
  RING_ANCHOR,
  SEARCHLIGHT_PIVOT,
  WORLD_GRAVITY,
  monsterHead,
  pirateShip,
  seaSurfaceY,
  shipToWorld,
  type GameState,
  type StationState,
  type Tuning,
} from '@lw/shared';
import type { Snapshot } from '../game/snapshot';
import { PixelText, type PixelFont } from './PixelFont';

/** World meters -> screen px of the current view (null = not on screen / behind the camera). */
export type WorldToScreen = (wx: number, wy: number) => { x: number; y: number } | null;

interface Target {
  x: number;
  y: number;
  label: string;
  color: number;
  /** Hit radius around (x, y) for the predicted path. */
  radius: number;
}

const GOLD = 0xe0b860;
const RED = 0xe8584a;
const GREEN = 0x6cc070;
const PALE = 0xd8dde6;

/**
 * Aiming aids for the cannon, the life ring and the searchlight: the predicted
 * flight path (dotted, green with "TREFFER" where it would hit), the targets
 * (kraken, pirates, rocks in the lane, swimmers) with their distance, and for
 * the searchlight the stretch of sea ahead where rocks can be spotted. In the
 * 2D view targets are marked where they are (arrows at the screen edge when
 * out of sight); in the 2.5D scene, which does not show the sea around the
 * ship, they sit on a bearing ring around the barrel / lamp.
 */
export class AimAids {
  readonly root = new Container();
  private readonly g = new Graphics();
  private readonly labels: PixelText[] = [];
  private used = 0;

  constructor(private readonly font: PixelFont) {
    this.root.addChild(this.g);
  }

  private label(text: string, x: number, y: number, color: number, W: number): void {
    let t = this.labels[this.used];
    if (!t) {
      t = new PixelText(this.font, '', color);
      this.labels.push(t);
      this.root.addChild(t);
    }
    this.used++;
    t.text = text;
    t.setColor(color);
    t.visible = true;
    t.position.set(Math.round(Math.max(2, Math.min(W - t.textWidth - 2, x - t.textWidth / 2))), Math.round(y));
  }

  clear(): void {
    this.g.clear();
    for (const t of this.labels) t.visible = false;
    this.used = 0;
  }

  /**
   * @param ring  2.5D: screen px of the aim pivot (bearing ring); null = 2D (targets where they are)
   */
  draw(
    st: StationState,
    state: GameState,
    view: Snapshot,
    tuning: Readonly<Tuning>,
    toScreen: WorldToScreen,
    ring: { x: number; y: number; radius: number } | null,
    W: number,
    H: number,
    time: number,
  ): void {
    this.clear();
    const ship = view.ship;
    const G = tuning.gameplay;
    const value = view.stations[st.id]?.value ?? st.value;
    const angle = value + ship.roll;
    const sea = (x: number) => seaSurfaceY(x, view.time, state.ship.seaState);
    const targets: Target[] = [];
    let path: { x: number; y: number }[] = [];
    if (st.kind === 'cannon') {
      const head = monsterHead(state);
      if (head && state.monster && state.monster.phase !== 'flee') targets.push({ x: head.x, y: head.y, label: 'KRAKE', color: RED, radius: 2.2 });
      const sloop = pirateShip(state);
      if (sloop && state.pirate?.phase !== 'flee') targets.push({ x: sloop.x, y: sloop.y - PIRATE_HEIGHT / 2, label: 'PIRATEN', color: RED, radius: PIRATE_HALF_LENGTH });
      for (const r of state.rocks) {
        const ahead = r.x - state.ship.x;
        if (r.hit || !r.spotted || ahead < 0 || ahead > 70 || Math.abs(r.lateral - state.ship.lateral) > r.radius + 1) continue;
        targets.push({ x: r.x, y: sea(r.x) - 0.4, label: r.kind === 'ice' ? 'EIS' : 'FELS', color: GOLD, radius: r.radius + 0.8 });
      }
      const pivot = shipToWorld(ship, { x: st.x + CANNON_PIVOT.x, y: st.y + CANNON_PIVOT.y });
      const o = { x: pivot.x + Math.cos(angle) * CANNON_LENGTH, y: pivot.y + Math.sin(angle) * CANNON_LENGTH };
      path = flight(o, Math.cos(angle) * G.ballSpeed + state.ship.speed, Math.sin(angle) * G.ballSpeed + state.ship.vy, sea);
    } else if (st.kind === 'ring') {
      for (const p of state.players) {
        if (p.overboard <= 0) continue;
        targets.push({ x: p.seaX, y: sea(p.seaX) - 0.2, label: p.name ? p.name.slice(0, 8) : 'SCHWIMMER', color: GREEN, radius: 1.4 });
      }
      if (!state.ring) {
        const a = shipToWorld(ship, { x: st.x + RING_ANCHOR.x, y: st.y + RING_ANCHOR.y });
        path = flight(a, Math.cos(angle) * G.ringSpeed + state.ship.speed, Math.sin(angle) * G.ringSpeed + state.ship.vy, sea);
      }
    } else if (st.kind === 'searchlight') {
      for (const r of state.rocks) {
        const ahead = r.x - state.ship.x;
        if (r.hit || !r.spotted || ahead < 0) continue;
        targets.push({ x: r.x, y: sea(r.x) - 0.6, label: r.kind === 'ice' ? 'EIS' : 'FELS', color: RED, radius: r.radius });
      }
    }

    // where the predicted path ends up: the first target it passes through
    let hit: Target | null = null;
    let end = path.length;
    for (let i = 0; i < path.length && !hit; i++) {
      for (const t of targets) {
        if (Math.hypot(path[i]!.x - t.x, path[i]!.y - t.y) < t.radius) {
          hit = t;
          end = i + 1;
          break;
        }
      }
    }
    const g = this.g;
    // dotted path (every other step), fading out
    let last: { x: number; y: number } | null = null;
    for (let i = 0; i < end; i += 2) {
      const s = toScreen(path[i]!.x, path[i]!.y);
      if (!s || s.x < -40 || s.x > W + 40 || s.y < -40 || s.y > H + 40) continue;
      const k = 1 - i / Math.max(1, path.length);
      g.rect(Math.round(s.x) - 1, Math.round(s.y) - 1, 2, 2).fill({ color: hit ? GREEN : GOLD, alpha: 0.35 + 0.6 * k });
      last = s;
    }
    if (last && end > 0) {
      const p = path[end - 1]!;
      const s = toScreen(p.x, p.y);
      if (s && s.x > 0 && s.x < W && s.y > 0 && s.y < H) {
        if (hit) {
          ring4(g, s.x, s.y, 5 + Math.round(Math.sin(time * 8)), GREEN);
          this.label('TREFFER!', s.x, s.y - 14, GREEN, W);
        } else {
          // splash mark where it comes down
          g.rect(Math.round(s.x) - 3, Math.round(s.y), 7, 1).fill({ color: PALE, alpha: 0.8 });
        }
      }
    }

    if (ring) this.bearings(st, state, view, targets, hit, ring, angle, W, sea, tuning);
    else this.marks(targets, hit, state, toScreen, W, H, time);
  }

  /** 2D: brackets around targets on screen, arrows at the edge for those out of sight. */
  private marks(targets: Target[], hit: Target | null, state: GameState, toScreen: WorldToScreen, W: number, H: number, time: number): void {
    const g = this.g;
    for (const t of targets) {
      const s = toScreen(t.x, t.y);
      if (!s) continue;
      const dist = Math.round(Math.abs(t.x - state.ship.x));
      const color = t === hit ? GREEN : t.color;
      if (s.x > 8 && s.x < W - 8 && s.y > 8 && s.y < H - 8) {
        const r = 7 + Math.round(Math.sin(time * 5) * 1);
        bracket(g, s.x, s.y, r, color);
        this.label(t.label, s.x, s.y - r - 9, color, W);
      } else {
        const x = Math.max(10, Math.min(W - 10, s.x));
        const y = Math.max(16, Math.min(H - 20, s.y));
        const dir = s.x > W - 10 ? 1 : s.x < 10 ? -1 : 0;
        arrow(g, x, y, dir, color);
        this.label(`${t.label} ${dist} M`, x - dir * 26, y - 3, color, W);
      }
    }
  }

  /** 2.5D: a bearing ring around the barrel / lamp: targets at their direction, the beam / barrel direction, the sea ahead. */
  private bearings(
    st: StationState,
    state: GameState,
    view: Snapshot,
    targets: Target[],
    hit: Target | null,
    ring: { x: number; y: number; radius: number },
    angle: number,
    W: number,
    sea: (x: number) => number,
    tuning: Readonly<Tuning>,
  ): void {
    const g = this.g;
    const R = ring.radius;
    const origin = st.kind === 'searchlight' ? shipToWorld(view.ship, { x: st.x + SEARCHLIGHT_PIVOT.x, y: st.y + SEARCHLIGHT_PIVOT.y }) : shipToWorld(view.ship, { x: st.x + CANNON_PIVOT.x, y: st.y + CANNON_PIVOT.y });
    const at = (a: number, r: number) => ({ x: ring.x + Math.cos(a) * r, y: ring.y + Math.sin(a) * r });
    // the faint ring
    for (let i = 0; i < 48; i++) {
      const p = at((i / 48) * Math.PI * 2, R);
      g.rect(Math.round(p.x), Math.round(p.y), 1, 1).fill({ color: PALE, alpha: 0.25 });
    }
    if (st.kind === 'searchlight') {
      // where the sea ahead is (that is where rocks can be found)
      const near = 12;
      const far = tuning.gameplay.rockSpotRange;
      const a0 = Math.atan2(sea(origin.x + near) - origin.y, near);
      const a1 = Math.atan2(sea(origin.x + far) - origin.y, far);
      const inSector = angle >= Math.min(a0, a1) - 0.1 && angle <= Math.max(a0, a1) + 0.1;
      for (let a = Math.min(a0, a1); a <= Math.max(a0, a1); a += 0.03) {
        const p = at(a, R);
        g.rect(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3).fill({ color: inSector ? GREEN : GOLD, alpha: 0.85 });
      }
      const m = at((a0 + a1) / 2, R + 10);
      this.label(inSector ? 'MEER VORAUS - GUT' : 'MEER VORAUS', m.x + 18, m.y - 3, inSector ? GREEN : GOLD, W);
    }
    // the current direction
    const d = at(angle, R + 4);
    g.moveTo(Math.round(ring.x + Math.cos(angle) * (R - 6)), Math.round(ring.y + Math.sin(angle) * (R - 6))).lineTo(Math.round(d.x), Math.round(d.y)).stroke({ color: PALE, width: 1, alpha: 0.9 });
    for (const t of targets) {
      const a = Math.atan2(t.y - origin.y, t.x - origin.x);
      const p = at(a, R);
      const color = t === hit ? GREEN : t.color;
      g.rect(Math.round(p.x) - 2, Math.round(p.y) - 2, 5, 5).fill(color);
      const dist = Math.round(Math.hypot(t.x - origin.x, t.y - origin.y));
      const q = at(a, R + 12);
      this.label(`${t.label} ${dist} M`, q.x + (Math.cos(a) >= 0 ? 22 : -22), q.y - 3, color, W);
    }
    void state;
  }
}

/** Ballistic flight in world coordinates until it reaches the sea (max 3 s). */
function flight(o: { x: number; y: number }, vx: number, vy: number, sea: (x: number) => number): { x: number; y: number }[] {
  const pts = [{ ...o }];
  const dt = 1 / 30;
  let x = o.x;
  let y = o.y;
  for (let t = 0; t < 3; t += dt) {
    vy += WORLD_GRAVITY * dt;
    x += vx * dt;
    y += vy * dt;
    pts.push({ x, y });
    if (y > sea(x)) break;
  }
  return pts;
}

function bracket(g: Graphics, x: number, y: number, r: number, color: number): void {
  const X = Math.round(x);
  const Y = Math.round(y);
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    g.rect(X + sx * r - (sx > 0 ? 3 : 0), Y + sy * r, 4, 1).fill(color);
    g.rect(X + sx * r, Y + sy * r - (sy > 0 ? 3 : 0), 1, 4).fill(color);
  }
}

function ring4(g: Graphics, x: number, y: number, r: number, color: number): void {
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.rect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), 1, 1).fill(color);
  }
}

function arrow(g: Graphics, x: number, y: number, dir: number, color: number): void {
  const X = Math.round(x);
  const Y = Math.round(y);
  if (dir === 0) {
    g.rect(X - 2, Y - 2, 5, 5).fill(color);
    return;
  }
  // the tip points to the side where the target is
  for (let i = 0; i < 5; i++) g.rect(X - dir * i, Y - i, 1, i * 2 + 1).fill(color);
}
