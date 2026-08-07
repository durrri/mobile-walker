/** Temporary day-length tuning for the authored lighting roadmap, not a gameplay decision. */
export const WORLD_DAY_DURATION_SECONDS = 20 * 60;
export const INITIAL_DAY_PHASE = 0.5;
const HOURS_PER_DAY = 24;
const DEGREES_PER_TURN = 360;
const AUTHORED_NOON_AZIMUTH_DEGREES = 51;

export interface EnvironmentTime {
  readonly normalizedDayPhase: number;
  readonly timeOfDayHours: number;
  /** -1 at local midnight, 0 at the horizon, and 1 at local noon. */
  readonly solarPhase: number;
  readonly solarAzimuthDegrees: number;
  readonly solarElevationDegrees: number;
  readonly maximumNoonSolarElevationDegrees: number;
}

export interface EnvironmentTimeOptions {
  readonly maximumNoonSolarElevationDegrees: number;
}

export function normalizeDayPhase(phase: number): number {
  if (!Number.isFinite(phase)) return 0;
  return ((phase % 1) + 1) % 1;
}

/** Pure authored time model; it deliberately contains no geographic astronomy. */
export function deriveEnvironmentTime(
  normalizedDayPhase: number,
  options: EnvironmentTimeOptions,
): EnvironmentTime {
  const phase = normalizeDayPhase(normalizedDayPhase);
  const maximumNoonSolarElevationDegrees = Math.min(90, Math.max(0, options.maximumNoonSolarElevationDegrees));
  const solarPhase = -Math.cos(phase * Math.PI * 2);
  return Object.freeze({
    normalizedDayPhase: phase,
    timeOfDayHours: phase * HOURS_PER_DAY,
    solarPhase,
    solarAzimuthDegrees: ((AUTHORED_NOON_AZIMUTH_DEGREES + (phase - 0.5) * DEGREES_PER_TURN) % DEGREES_PER_TURN + DEGREES_PER_TURN) % DEGREES_PER_TURN,
    solarElevationDegrees: maximumNoonSolarElevationDegrees * Math.max(0, solarPhase),
    maximumNoonSolarElevationDegrees,
  });
}
