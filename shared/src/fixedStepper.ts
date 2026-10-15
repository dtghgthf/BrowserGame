import { SIM_DT } from './constants';

/**
 * Classic fixed-timestep accumulator. The render loop feeds real frame time,
 * the stepper calls `step` zero or more times with the fixed dt and exposes
 * `alpha` (0..1) for interpolating between the previous and current state.
 */
export class FixedStepper {
  accumulator = 0;
  /** Number of steps dropped because the frame took too long (spiral-of-death guard). */
  droppedSteps = 0;

  constructor(
    readonly dt: number = SIM_DT,
    readonly maxStepsPerFrame = 6,
    readonly maxFrameTime = 0.25,
  ) {}

  /** Advances by `frameTime` seconds, running `step` for each whole fixed step. Returns the steps run. */
  advance(frameTime: number, step: (dt: number) => void): number {
    this.accumulator += Math.min(Math.max(frameTime, 0), this.maxFrameTime);
    let steps = 0;
    while (this.accumulator >= this.dt - 1e-9) {
      if (steps >= this.maxStepsPerFrame) {
        const dropped = Math.floor(this.accumulator / this.dt);
        this.droppedSteps += dropped;
        this.accumulator -= dropped * this.dt;
        break;
      }
      step(this.dt);
      this.accumulator -= this.dt;
      steps++;
    }
    if (this.accumulator < 0) this.accumulator = 0;
    return steps;
  }

  /** Interpolation factor between the last two simulation states. */
  get alpha(): number {
    return Math.min(this.accumulator / this.dt, 1);
  }
}
