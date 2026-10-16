import type { GameState, ObjectState } from '../state';
import type { GameplayTuning } from '../tuning';
import type { SimContext } from './context';

const DEG = Math.PI / 180;

/** Crates and barrels are cargo: lashed down in the hold, they can break loose in heavy seas. */
export function isCargo(o: ObjectState): boolean {
  return o.kind === 'crate' || o.kind === 'barrel';
}

/** Lashings snap when the ship heels hard - the more, the likelier. */
export function updateCargo(ctx: SimContext, dt: number): void {
  const s = ctx.state;
  if (s.status !== 'sailing') return;
  const G = ctx.tuning.gameplay;
  const roll = Math.abs(s.ship.roll) / DEG;
  if (roll <= G.cargoBreakRoll) return;
  const chance = G.cargoBreakRate * ((roll - G.cargoBreakRoll) / G.cargoBreakRoll) * dt;
  for (const o of s.objects) {
    if (!o.lashed || o.carriedBy) continue;
    if (ctx.rand(0, 1) >= chance) continue;
    ctx.setLashed(o, false);
    ctx.emit({ type: 'cargoLoose', object: o.id, x: o.x, y: o.y });
    const who = ctx.closestPlayer(o.x, o.y);
    if (who) ctx.say(who, 'cargo');
  }
}

/**
 * Loose cargo that slid away from its place shifts the ship's balance: a moment
 * like water in the hull (volume x distance), measured from where it was stowed.
 */
export function cargoMoment(state: GameState, G: Readonly<GameplayTuning>): number {
  let m = 0;
  for (const o of state.objects) {
    if (!isCargo(o) || o.lashed || o.carriedBy || !o.spawn) continue;
    const weight = o.kind === 'crate' && o.opened ? 0.3 : o.kind === 'barrel' ? 0.6 + 0.6 * o.fill : 1;
    m += G.cargoWeight * weight * (o.x - o.spawn.x);
  }
  return m;
}
