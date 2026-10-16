import { WORLD_GRAVITY } from '../constants';
import { seaSurfaceY } from '../sea';
import { TileKind, localToTile, tileKindAt } from '../layout/parseLayout';
import { shipToWorld, worldToShip } from '../ship';
import type { StationState } from '../state';
import { CANNON_LENGTH, CANNON_PIVOT } from './constants';
import type { SimContext } from './context';
import { ignite } from './fire';
import { hitMonster, monsterHead } from './monster';
import { PIRATE_HALF_LENGTH, PIRATE_HEIGHT, hitPirate, pirateShip } from './pirates';

/** Launch speed factor of a shot / throw for a strength 0..1. */
export function launchFactor(G: { powerMin: number }, power: number): number {
  return G.powerMin + (1 - G.powerMin) * Math.max(0, Math.min(1, power));
}

export function fireCannon(ctx: SimContext, st: StationState): void {
  const s = ctx.state;
  const G = ctx.tuning.gameplay;
  const ship = s.ship;
  const angle = st.value + ship.roll;
  const pivot = shipToWorld(ship, { x: st.x + CANNON_PIVOT.x, y: st.y + CANNON_PIVOT.y });
  const x = pivot.x + Math.cos(angle) * CANNON_LENGTH;
  const y = pivot.y + Math.sin(angle) * CANNON_LENGTH;
  // the strength only changes how far it flies, not what it does when it hits
  const speed = G.ballSpeed * launchFactor(G, st.power);
  s.balls.push({ id: ctx.nextId(), x, y, vx: Math.cos(angle) * speed + ship.speed, vy: Math.sin(angle) * speed + ship.vy, age: 0, pirate: false });
  st.charge = 0;
  ship.rollVel -= 0.06;
  ctx.emit({ type: 'cannonFire', player: st.occupant, x, y, angle });
}

/**
 * Cannonballs fly in world coordinates. The crew's hit the kraken, the pirates
 * or break a rock in the ship's lane; the pirates' hit the ship.
 */
export function updateBalls(ctx: SimContext, dt: number): void {
  const s = ctx.state;
  if (s.balls.length === 0) return;
  const ship = s.ship;
  const head = monsterHead(s);
  const sloop = pirateShip(s);
  const keep = [];
  for (const b of s.balls) {
    b.vy += WORLD_GRAVITY * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.age += dt;
    if (b.pirate) {
      if (b.age > 0.3 && hitsShip(ctx, b.x, b.y)) continue;
    } else {
      if (head && s.monster && s.monster.phase !== 'flee' && Math.hypot(b.x - head.x, b.y - head.y) < 2.2) {
        hitMonster(ctx);
        continue;
      }
      if (sloop && s.pirate?.phase !== 'flee' && Math.abs(b.x - sloop.x) < PIRATE_HALF_LENGTH && b.y > sloop.y - PIRATE_HEIGHT && b.y < sloop.y + 0.5) {
        hitPirate(ctx);
        continue;
      }
    }
    if (b.y > seaSurfaceY(b.x, s.time, ship.seaState)) {
      ctx.emit({ type: 'ballSplash', x: b.x, y: b.y });
      if (b.pirate) continue;
      // a rock straight ahead (in the ship's lane) breaks; ice takes two hits
      const rock = s.rocks.find((r) => !r.hit && Math.abs(r.x - b.x) < r.radius + 0.8 && Math.abs(r.lateral - ship.lateral) < r.radius + 1);
      if (rock && rock.hp > 1) {
        rock.hp--;
        ctx.emit({ type: 'iceHit', rock: rock.id, x: rock.x });
      } else if (rock) {
        s.rocks = s.rocks.filter((r) => r !== rock);
        s.voyage.rocksDestroyed++;
        ctx.emit({ type: 'rockBreak', rock: rock.id, x: rock.x });
      }
      continue;
    }
    if (b.age < 8) keep.push(b);
  }
  s.balls = keep;
}

/** A pirate ball reaching the hull or a deck: a leak near the hit, otherwise a fire. Returns true on impact. */
function hitsShip(ctx: SimContext, x: number, y: number): boolean {
  const s = ctx.state;
  const L = ctx.layout;
  const local = worldToShip(s.ship, { x, y });
  const t = localToTile(L, local.x, local.y);
  const k = tileKindAt(L, t.x, t.y);
  if (k !== TileKind.Solid && k !== TileKind.Hatch) return false;
  ctx.emit({ type: 'shipHit', x: local.x, y: local.y });
  s.ship.rollVel += 0.08;
  const tx = Math.floor(t.x);
  const ty = Math.floor(t.y);
  const lp = L.leakPoints.find((p) => Math.abs(p.tx - tx) <= 1 && Math.abs(p.ty - ty) <= 1 && !s.leaks.some((l) => l.point === p.id && l.active));
  if (lp) ctx.createLeak(lp.id);
  else if (ctx.rand(0, 1) < ctx.tuning.gameplay.pirateFireChance) ignite(ctx, tx, ty - 1, 0.45);
  for (const p of s.players) {
    if (p.overboard <= 0 && p.station === null && Math.hypot(p.x - local.x, p.y - local.y) < 1.2) ctx.knock(p, p.x < local.x ? -4 : 4, -4);
  }
  return true;
}
