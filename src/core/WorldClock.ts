import {
  deriveEnvironmentTime,
  INITIAL_DAY_PHASE,
  normalizeDayPhase,
  type EnvironmentTime,
  type EnvironmentTimeOptions,
  WORLD_DAY_DURATION_SECONDS,
} from "./environmentTime";

export interface WorldClockOptions extends EnvironmentTimeOptions {
  readonly dayDurationSeconds?: number;
  readonly initialDayPhase?: number;
}

/** Game owns this sole world-session clock and advances it only from loop deltas. */
export class WorldClock {
  private readonly dayDurationSeconds: number;
  private elapsedDaySeconds: number;
  private paused = false;
  private timeSpeed = 1;
  private maximumNoonSolarElevationDegrees: number;

  constructor(options: WorldClockOptions) {
    this.dayDurationSeconds = options.dayDurationSeconds ?? WORLD_DAY_DURATION_SECONDS;
    if (!Number.isFinite(this.dayDurationSeconds) || this.dayDurationSeconds <= 0) throw new Error("World day duration must be positive.");
    this.elapsedDaySeconds = normalizeDayPhase(options.initialDayPhase ?? INITIAL_DAY_PHASE) * this.dayDurationSeconds;
    this.maximumNoonSolarElevationDegrees = options.maximumNoonSolarElevationDegrees;
  }

  get state(): EnvironmentTime {
    return deriveEnvironmentTime(this.elapsedDaySeconds / this.dayDurationSeconds, {
      maximumNoonSolarElevationDegrees: this.maximumNoonSolarElevationDegrees,
    });
  }

  advance(deltaSeconds: number): void {
    if (this.paused || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    this.elapsedDaySeconds = modulo(this.elapsedDaySeconds + deltaSeconds * this.timeSpeed, this.dayDurationSeconds);
  }

  setPaused(paused: boolean): void { this.paused = paused; }
  setTimeSpeed(multiplier: number): void { this.timeSpeed = Number.isFinite(multiplier) ? Math.max(0, multiplier) : 1; }
  setTimeOfDayHours(hours: number): void {
    if (Number.isFinite(hours)) this.elapsedDaySeconds = modulo(hours / 24 * this.dayDurationSeconds, this.dayDurationSeconds);
  }
  setMaximumNoonSolarElevationDegrees(degrees: number): void {
    this.maximumNoonSolarElevationDegrees = Number.isFinite(degrees) ? degrees : 0;
  }
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
