import { courseLateralAt, predictCourse } from '../navigation';
import { nextRandom } from '../rng';
import { seaSurfaceY } from '../sea';
import { BOW_OFFSET, ROCK_LOOKAHEAD } from './constants';
import type { SimContext } from './context';

/** Spawns rocks ahead, spots them with the searchlight, checks collisions at the bow. */
export function updateRocks(ctx: SimContext, progress: number): void {
  const s = ctx.state;
  const v = s.voyage;
  const G = ctx.tuning.gameplay;
  const ship = s.ship;
  // after a jump (debug, reconnect) never spawn a pile of rocks behind the bow
  if (v.nextRockX < ship.x + 60) v.nextRockX = ship.x + 60;
  // new rocks appear far ahead, denser the closer the lighthouse
  while (v.nextRockX - ship.x < ROCK_LOOKAHEAD && v.nextRockX < v.length - 40) {
    // around where the ship will be when it gets there on its current heading:
    // drifting off course does not dodge rocks, only steering does
    const predicted = courseLateralAt(predictCourse(s, ctx.tuning, ROCK_LOOKAHEAD), v.nextRockX - ship.x);
    const inLane = nextRandom(s) < 0.45;
    const lateral = predicted + (inLane ? ctx.rand(-1.5, 1.5) : ctx.rand(-8, 8));
    s.rocks.push({ id: ctx.nextId(), x: v.nextRockX, lateral, radius: ctx.rand(1.6, 3.4), spotted: false, hit: false });
    v.nextRockX += ctx.rand(G.rockSpacingMin, G.rockSpacingMax) * (1 - 0.35 * progress);
  }
  const light = ctx.searchlightRay();
  for (const r of s.rocks) {
    const ahead = r.x - ship.x;
    if (!r.spotted) {
      const byLight = light !== null && ctx.inBeam(light, r.x, seaSurfaceY(r.x, s.time, ship.seaState) - 0.6, r.radius, G.rockSpotRange);
      if (byLight || ahead < G.rockSeeRange) {
        r.spotted = true;
        ctx.emit({ type: 'rockSpotted', rock: r.id });
        if (byLight && s.shouts.rock <= 0) {
          const st = s.stations.find((x) => x.kind === 'searchlight');
          const op = st?.occupant ? s.players.find((p) => p.id === st.occupant) : null;
          const who = op ?? (st ? ctx.closestPlayer(st.x, st.y) : null);
          if (who) ctx.say(who, 'rock');
          s.shouts.rock = 6;
        }
      }
    }
    if (!r.hit && ahead <= BOW_OFFSET) {
      if (Math.abs(r.lateral - ship.lateral) < r.radius + G.shipBeam) hitRock(ctx, r.id);
      else {
        r.hit = true; // passed (no second check)
        v.rocksPassed++;
      }
    }
  }
  if (s.rocks.some((r) => r.x < ship.x - 30)) s.rocks = s.rocks.filter((r) => r.x >= ship.x - 30);
}

export function hitRock(ctx: SimContext, id: number): void {
  const s = ctx.state;
  const r = s.rocks.find((x) => x.id === id);
  if (!r) return;
  r.hit = true;
  s.voyage.rocksHit++;
  s.ship.rollVel += (r.lateral > s.ship.lateral ? -1 : 1) * ctx.tuning.gameplay.rockShake;
  ctx.emit({ type: 'rockHit', rock: r.id, x: r.x });
  ctx.emit({ type: 'splash', x: BOW_OFFSET - 1, y: 0.5, strength: 1.4 });
  ctx.leakAt('bow');
  if (r.radius > 2.8) ctx.leakAt('bottom');
}
