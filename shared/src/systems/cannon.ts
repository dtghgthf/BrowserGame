import { WORLD_GRAVITY } from '../constants';
import { seaSurfaceY } from '../sea';
import { shipToWorld } from '../ship';
import type { StationState } from '../state';
import { CANNON_LENGTH, CANNON_PIVOT } from './constants';
import type { SimContext } from './context';
import { hitMonster, monsterHead } from './monster';

export function fireCannon(ctx: SimContext, st: StationState): void {
  const s = ctx.state;
  const G = ctx.tuning.gameplay;
  const ship = s.ship;
  const angle = st.value + ship.roll;
  const pivot = shipToWorld(ship, { x: st.x + CANNON_PIVOT.x, y: st.y + CANNON_PIVOT.y });
  const x = pivot.x + Math.cos(angle) * CANNON_LENGTH;
  const y = pivot.y + Math.sin(angle) * CANNON_LENGTH;
  s.balls.push({ id: ctx.nextId(), x, y, vx: Math.cos(angle) * G.ballSpeed + ship.speed, vy: Math.sin(angle) * G.ballSpeed + ship.vy, age: 0 });
  st.aux = G.cannonReload;
  ship.rollVel -= 0.06;
  ctx.emit({ type: 'cannonFire', player: st.occupant, x, y, angle });
}

/** Cannonballs fly in world coordinates; they hit the kraken or break a rock in the ship's lane. */
export function updateBalls(ctx: SimContext, dt: number): void {
  const s = ctx.state;
  if (s.balls.length === 0) return;
  const ship = s.ship;
  const head = monsterHead(s);
  const keep = [];
  for (const b of s.balls) {
    b.vy += WORLD_GRAVITY * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.age += dt;
    if (head && s.monster && s.monster.phase !== 'flee' && Math.hypot(b.x - head.x, b.y - head.y) < 2.2) {
      hitMonster(ctx);
      continue;
    }
    if (b.y > seaSurfaceY(b.x, s.time, ship.seaState)) {
      ctx.emit({ type: 'ballSplash', x: b.x, y: b.y });
      // a rock straight ahead (in the ship's lane) breaks
      const rock = s.rocks.find((r) => !r.hit && Math.abs(r.x - b.x) < r.radius + 0.8 && Math.abs(r.lateral - ship.lateral) < r.radius + 1);
      if (rock) {
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
