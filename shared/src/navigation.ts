import type { GameState, RockState } from './state';
import type { Tuning } from './tuning';

/** One point of the predicted course: meters ahead of the ship and sideways position. */
export interface CoursePoint {
  ahead: number;
  lateral: number;
}

/**
 * Where the ship goes if it keeps its current heading: a straight line, like
 * the road ahead in a driving game. Turning the wheel changes the heading and so
 * the line; far points move a lot, near points a little. (The current and the
 * rudder change the heading over time - that is what the helmsman corrects.)
 */
export function predictCourse(state: Pick<GameState, 'ship'>, _tuning: Readonly<Tuning>, distance: number): CoursePoint[] {
  const ship = state.ship;
  // sideways meters per meter ahead (same speeds as updateShip)
  const slope = Math.sin(ship.heading) / (0.35 + 0.65 * Math.cos(ship.heading));
  return [
    { ahead: 0, lateral: ship.lateral },
    { ahead: distance, lateral: ship.lateral + slope * distance },
  ];
}

/** Sideways position of the predicted course `ahead` meters in front of the ship. */
export function courseLateralAt(course: readonly CoursePoint[], ahead: number): number {
  if (course.length === 0) return 0;
  for (let i = 1; i < course.length; i++) {
    const b = course[i]!;
    if (b.ahead >= ahead) {
      const a = course[i - 1]!;
      const k = b.ahead > a.ahead ? (ahead - a.ahead) / (b.ahead - a.ahead) : 0;
      return a.lateral + (b.lateral - a.lateral) * k;
    }
  }
  return course[course.length - 1]!.lateral;
}

/**
 * Whether a rock lies on the predicted course (would be hit if nobody steers),
 * and which way to steer to miss it (-1 = to port / left on the chart, +1 = starboard / right).
 */
export function rockThreat(rock: RockState, shipX: number, course: readonly CoursePoint[], shipBeam: number): { danger: boolean; steer: -1 | 1 } {
  const lat = courseLateralAt(course, rock.x - shipX);
  const danger = !rock.hit && Math.abs(rock.lateral - lat) < rock.radius + shipBeam;
  return { danger, steer: rock.lateral >= lat ? -1 : 1 };
}
