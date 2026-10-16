import { seaSurfaceY } from '../sea';
import type { SimContext } from './context';

/** A whirlpool pulls the ship towards its middle and spins it; through the middle = a hard knock on the keel. */
export function updateWhirl(ctx: SimContext, dt: number): void {
  const s = ctx.state;
  const w = s.whirl;
  if (!w) return;
  const G = ctx.tuning.gameplay;
  const ship = s.ship;
  const ahead = w.x - ship.x;
  if (!w.spotted) {
    const light = ctx.searchlightRay();
    if (ahead < G.rockSeeRange * 1.5 || (light && ctx.inBeam(light, w.x, seaSurfaceY(w.x, s.time, ship.seaState), w.radius * 0.5, ctx.spotRange()))) {
      w.spotted = true;
      const st = s.stations.find((x) => x.kind === 'searchlight');
      const who = (st?.occupant && s.players.find((p) => p.id === st.occupant)) || ctx.closestPlayer(10, -1);
      if (who) ctx.say(who, 'whirl');
    }
  }
  const reach = w.radius * 1.4;
  const d = w.lateral - ship.lateral;
  const dist = Math.hypot(d, ahead);
  if (dist < reach) {
    // two at the wheel hold the ship against the pull; alone the helmsman calls for help
    const wheel = s.stations.find((x) => x.kind === 'wheel');
    const held = !!wheel?.helper;
    const pull = G.whirlPull * (1 - dist / reach) * (held ? G.whirlHold : 1);
    if (!held && s.shouts.wheel <= 0) {
      const helm = wheel?.occupant ? s.players.find((p) => p.id === wheel.occupant) : null;
      if (helm) {
        ctx.say(helm, 'help');
        s.shouts.wheel = 6;
      }
    }
    ship.lateral += Math.sign(d) * pull * 2 * dt;
    ship.heading += Math.sign(d || 1) * pull * 0.35 * dt;
    ship.rollVel += Math.sin(s.time * 2.7) * pull * 0.9 * dt;
    if (dist < 2.2 && !w.hit) {
      w.hit = true;
      ship.rollVel += 0.5;
      ctx.emit({ type: 'whirlHit' });
      ctx.leakAt('bottom');
    }
  }
  if (ahead < -reach - 4) s.whirl = null;
}
