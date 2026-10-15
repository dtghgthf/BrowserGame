import { predictCourse, rockThreat } from '../navigation';
import type { SimContext } from './context';

/** Automatic shouts so the crew knows what is going on without talking. */
export function updateShouts(ctx: SimContext): void {
  const s = ctx.state;
  const wheel = s.stations.find((st) => st.kind === 'wheel');
  // a spotted rock on the course and nobody steering: same call as drifting off course
  let rockAhead = false;
  if (wheel && !wheel.occupant && s.shouts.wheel <= 0 && s.tick % 30 === 0 && s.rocks.some((r) => r.spotted && !r.hit)) {
    const course = predictCourse(s, ctx.tuning, 90);
    rockAhead = s.rocks.some((r) => r.spotted && r.x - s.ship.x < 90 && rockThreat(r, s.ship.x, course, ctx.tuning.gameplay.shipBeam).danger);
  }
  if (wheel && !wheel.occupant && (Math.abs(s.ship.heading) > 0.45 || rockAhead) && s.shouts.wheel <= 0) {
    const p = ctx.closestPlayer(wheel.x, wheel.y, true);
    if (p) ctx.say(p, 'wheel');
    s.shouts.wheel = 14;
  }
  if (s.shouts.water <= 0) {
    for (let i = 0; i < s.compartments.length; i++) {
      const c = s.compartments[i]!;
      const cap = ctx.waterGeometry[i]!.capacity;
      if (cap > 0 && c.volume / cap > 0.3) {
        const p = ctx.closestPlayer(c.centroidX, c.surfaceY, true);
        if (p) ctx.say(p, 'water');
        s.shouts.water = 18;
        break;
      }
    }
  }
}
