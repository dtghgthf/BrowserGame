import { compartmentAtLocal, tileToLocal } from '../layout/parseLayout';
import type { SimContext } from './context';
import { ignite, isFloorTile } from './fire';

/** Breaking waves and lightning: only in a storm. */
export function updateWeather(ctx: SimContext, dt: number): void {
  const s = ctx.state;
  const v = s.voyage;
  const G = ctx.tuning.gameplay;
  if (s.status !== 'sailing') return;

  // a breaking wave washes over the open deck (announced two seconds before)
  if (s.ship.seaState < G.waveMinSea || G.waveEvery <= 0) {
    v.waveIn = Math.max(v.waveIn, 8);
    v.waveWarn = 0;
  } else if (v.waveWarn > 0) {
    v.waveWarn -= dt;
    if (v.waveWarn <= 0) breakWave(ctx);
  } else {
    v.waveIn -= dt;
    if (v.waveIn <= 0) {
      v.waveWarn = 2.2;
      v.waveIn = ctx.rand(0.7, 1.3) * G.waveEvery;
      ctx.emit({ type: 'waveWarn' });
      const p = ctx.closestPlayer(10, -1);
      if (p) ctx.say(p, 'wave');
    }
  }

  // lightning hits the highest deck and may set it on fire
  if (s.ship.seaState >= G.waveMinSea && G.lightningEvery > 0) {
    v.lightningIn -= dt;
    if (v.lightningIn <= 0) {
      v.lightningIn = ctx.rand(0.6, 1.4) * G.lightningEvery;
      strike(ctx);
    }
  }
}

export function breakWave(ctx: SimContext): void {
  const s = ctx.state;
  const G = ctx.tuning.gameplay;
  s.voyage.waveWarn = 0;
  s.ship.rollVel += ctx.rand(-0.35, 0.35);
  ctx.emit({ type: 'wave' });
  ctx.emit({ type: 'splash', x: 12, y: -0.5, strength: 2.4 });
  for (const p of s.players) {
    if (p.overboard > 0 || p.station !== null || p.climbing !== null) continue;
    // only the open deck: inside the hull the wave does not reach
    if (compartmentAtLocal(ctx.layout, p.x, p.y) >= 0) continue;
    ctx.knock(p, -G.wavePush * ctx.rand(0.75, 1.2), -ctx.rand(2.5, 4.5));
  }
}

export function strike(ctx: SimContext): void {
  const L = ctx.layout;
  const G = ctx.tuning.gameplay;
  const tx = Math.floor(ctx.rand(4, L.width - 4));
  let ty = 0;
  while (ty < L.height - 1 && !isFloorTile(L, tx, ty)) ty++;
  if (ty >= L.height - 1) return;
  const c = tileToLocal(L, tx + 0.5, ty + 0.5);
  ctx.emit({ type: 'lightning', x: c.x, y: c.y });
  if (ctx.rand(0, 1) < G.lightningFireChance) ignite(ctx, tx, ty, 0.5);
}
