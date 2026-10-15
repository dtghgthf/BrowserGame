import { WORLD_GRAVITY } from '../constants';
import { TileKind, tileKindAt, tileToLocal, type ShipLayout } from '../layout/parseLayout';
import type { Vec2 } from '../math';
import { seaSurfaceY } from '../sea';
import { shipToWorld } from '../ship';
import type { GameState } from '../state';
import type { SimContext } from './context';

/** Where the pirates' sloop settles ahead of the pivot (m); closer while the hook holds. */
const FIGHT_OFFSET = 23;
const HOOKED_OFFSET = 19.5;
/** Half length and height of the sloop's hull (hit box for cannon balls). */
export const PIRATE_HALF_LENGTH = 3.4;
export const PIRATE_HEIGHT = 3.2;

/** World position of the sloop's waterline centre. */
export function pirateShip(state: Pick<GameState, 'ship' | 'time' | 'pirate'>): Vec2 | null {
  const p = state.pirate;
  if (!p) return null;
  const x = state.ship.x + p.offset;
  return { x, y: seaSurfaceY(x, state.time, state.ship.seaState) };
}

const hookCache = new WeakMap<ShipLayout, Vec2>();
/** Ship-local point on the bow railing where the grappling hook bites (feet height of the top deck). */
export function hookPoint(layout: ShipLayout): Vec2 {
  let p = hookCache.get(layout);
  if (p) return p;
  let best = { tx: layout.width - 1, ty: 0 };
  let found = false;
  for (let tx = layout.width - 1; tx > layout.width * 0.55 && !found; tx--) {
    for (let ty = 0; ty < layout.height - 1; ty++) {
      const k = tileKindAt(layout, tx, ty);
      const below = tileKindAt(layout, tx, ty + 1);
      if (k === TileKind.Exterior && below === TileKind.Solid) {
        best = { tx, ty };
        found = true;
        break;
      }
    }
  }
  // two tiles in from the bow wall so a player can stand next to it
  p = tileToLocal(layout, best.tx - 2 + 0.5, best.ty + 1);
  hookCache.set(layout, p);
  return p;
}

export function spawnPirates(ctx: SimContext): void {
  const s = ctx.state;
  if (s.pirate) return;
  const G = ctx.tuning.gameplay;
  s.pirate = { offset: 75, hp: G.pirateHp, phase: 'approach', timer: 0, fireIn: 3, hook: 0, hookIn: G.pirateHookAfter, hurt: 0, spotted: false };
  ctx.emit({ type: 'pirateAppear' });
}

export function updatePirates(ctx: SimContext, dt: number): void {
  const s = ctx.state;
  const pr = s.pirate;
  if (!pr) return;
  const G = ctx.tuning.gameplay;
  pr.timer += dt;
  pr.hurt = Math.max(0, pr.hurt - dt);
  const pos = pirateShip(s)!;
  if (!pr.spotted) {
    const light = ctx.searchlightRay();
    if (pr.offset < 40 || (light && ctx.inBeam(light, pos.x, pos.y - 1.5, PIRATE_HALF_LENGTH, ctx.spotRange()))) {
      pr.spotted = true;
      const st = s.stations.find((x) => x.kind === 'searchlight');
      const who = (st?.occupant && s.players.find((p) => p.id === st.occupant)) || ctx.closestPlayer(10, -1);
      if (who) ctx.say(who, 'pirate');
    }
  }
  switch (pr.phase) {
    case 'approach':
      pr.offset = Math.max(FIGHT_OFFSET, pr.offset - 4 * dt);
      if (pr.offset <= FIGHT_OFFSET) {
        pr.phase = 'fight';
        pr.timer = 0;
      }
      break;
    case 'fight': {
      const target = (pr.hook > 0 ? HOOKED_OFFSET : FIGHT_OFFSET) + Math.sin(pr.timer * 0.4) * 2;
      pr.offset += (target - pr.offset) * Math.min(1, dt * 0.8);
      pr.fireIn -= dt;
      if (pr.fireIn <= 0) {
        pr.fireIn = G.pirateFireInterval * ctx.rand(0.7, 1.3);
        fireAtShip(ctx);
      }
      if (pr.hook > 0) pr.hook += dt;
      else {
        pr.hookIn -= dt;
        if (pr.hookIn <= 0) {
          pr.hook = 0.01;
          ctx.emit({ type: 'hook', on: true });
          const hp = hookPoint(ctx.layout);
          const who = ctx.closestPlayer(hp.x, hp.y);
          if (who) ctx.say(who, 'pirate');
        }
      }
      break;
    }
    case 'flee':
      pr.offset += 7 * dt;
      if (pr.offset > 95) s.pirate = null;
      break;
  }
}

/** A ball lobbed at the deck (a few meters of scatter: closer = more accurate). */
function fireAtShip(ctx: SimContext): void {
  const s = ctx.state;
  const pr = s.pirate!;
  const G = ctx.tuning.gameplay;
  const from = pirateShip(s)!;
  const x0 = from.x - PIRATE_HALF_LENGTH * 0.6;
  const y0 = from.y - 1.4;
  const target = shipToWorld(s.ship, { x: ctx.rand(-12, 13), y: -1.5 });
  const spread = G.pirateAccuracy * (pr.hook > 0 ? 0.6 : 1);
  target.x += ctx.rand(-spread, spread);
  const T = 2.0;
  const vx = (target.x - x0) / T + s.ship.speed;
  const vy = (target.y - y0 - 0.5 * WORLD_GRAVITY * T * T) / T;
  s.balls.push({ id: ctx.nextId(), x: x0, y: y0, vx, vy, age: 0, pirate: true });
  ctx.emit({ type: 'pirateFire', x: x0, y: y0, angle: Math.atan2(vy, vx) });
}

export function hitPirate(ctx: SimContext): void {
  const s = ctx.state;
  const pr = s.pirate;
  if (!pr || pr.phase === 'flee') return;
  pr.hp--;
  pr.hurt = 0.4;
  ctx.emit({ type: 'pirateHit', hp: pr.hp });
  if (pr.hp > 0) return;
  pr.phase = 'flee';
  if (pr.hook > 0) cutHook(ctx);
  s.voyage.piratesBeaten++;
  ctx.emit({ type: 'pirateFlee' });
  // they throw cargo overboard to get away: something to fish out
  for (let i = 0; i < 2; i++) {
    s.flotsam.push({ id: ctx.nextId(), x: s.ship.x + pr.offset + 6 + i * 9, lateral: s.ship.lateral + ctx.rand(-1.5, 1.5), spotted: true });
  }
}

export function cutHook(ctx: SimContext): void {
  const pr = ctx.state.pirate;
  if (!pr || pr.hook <= 0) return;
  pr.hook = 0;
  pr.hookIn = ctx.tuning.gameplay.pirateHookAfter;
  ctx.emit({ type: 'hook', on: false });
}
