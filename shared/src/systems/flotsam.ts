import { seaSurfaceY } from '../sea';
import type { FlotsamState, PlayerState } from '../state';
import { BOW_OFFSET } from './constants';
import type { SimContext } from './context';
import { rollLoot } from './crates';

/** Flotsam is seen like rocks and lost once it has drifted past the stern. */
export function updateFlotsam(ctx: SimContext): void {
  const s = ctx.state;
  if (s.flotsam.length === 0) return;
  const G = ctx.tuning.gameplay;
  const light = ctx.searchlightRay();
  for (const f of s.flotsam) {
    if (f.spotted) continue;
    const ahead = f.x - s.ship.x;
    if (ahead < G.rockSeeRange || (light && ctx.inBeam(light, f.x, seaSurfaceY(f.x, s.time, s.ship.seaState) - 0.3, 1, G.rockSpotRange))) {
      f.spotted = true;
      const st = s.stations.find((x) => x.kind === 'searchlight');
      const who = st?.occupant ? s.players.find((p) => p.id === st.occupant) : null;
      if (who && !who.bubble) ctx.say(who, 'flotsam');
    }
  }
  if (s.flotsam.some((f) => f.x - s.ship.x < -BOW_OFFSET - 4)) s.flotsam = s.flotsam.filter((f) => f.x - s.ship.x >= -BOW_OFFSET - 4);
}

/** Flotsam alongside (in the ship's lane) a player on the open deck can reach with the boat hook. */
export function reachableFlotsam(ctx: SimContext, p: PlayerState): FlotsamState | null {
  const s = ctx.state;
  const G = ctx.tuning.gameplay;
  for (const f of s.flotsam) {
    if (Math.abs(f.lateral - s.ship.lateral) > G.shipBeam + 0.8) continue;
    const ahead = f.x - s.ship.x;
    if (Math.abs(ahead) > BOW_OFFSET + 1) continue;
    if (Math.abs(ahead - p.x) < 2) return f;
  }
  return null;
}

export function fishFlotsam(ctx: SimContext, p: PlayerState, f: FlotsamState): void {
  const s = ctx.state;
  s.flotsam = s.flotsam.filter((o) => o !== f);
  const crate = ctx.spawnLoose('crate', p.x + p.facing * 0.7, p.y - 0.4);
  crate.contents = rollLoot(s);
  s.voyage.flotsamFished++;
  ctx.emit({ type: 'flotsamFished', player: p.id, id: f.id });
  ctx.emit({ type: 'splash', x: p.x + p.facing * 1.5, y: 0.4, strength: 0.6 });
}
