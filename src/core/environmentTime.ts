/** Temporary day-length tuning for the authored lighting roadmap, not a gameplay decision. */
export const WORLD_DAY_DURATION_SECONDS = 20 * 60;
export const INITIAL_DAY_PHASE = 0.5;
export const DEFAULT_MAXIMUM_NOON_SOLAR_ELEVATION_DEGREES = 45;
const HOURS_PER_DAY = 24;
const DEGREES_PER_TURN = 360;
/** Renderer/world-space angle: 90° places the sun at world +Z (south), not a compass bearing. */
export const AUTHORED_NOON_AZIMUTH_DEGREES = 90;
export const AUTHORED_PRE_DAWN_START_HOURS = 4.5;
export const AUTHORED_SUNRISE_HOURS = 6;
export const AUTHORED_SUNRISE_END_HOURS = 6.5;
export const AUTHORED_SOFT_MORNING_END_HOURS = 8;
export const AUTHORED_NOON_HOURS = 12;
export const AUTHORED_BROAD_DAYLIGHT_END_HOURS = 18;
export const AUTHORED_SUNSET_START_HOURS = 20;
export const AUTHORED_SUNSET_HOURS = 20.5;
export const AUTHORED_DUSK_END_HOURS = 22;

export type AuthoredDailyPhase =
  | "true-night" | "pre-dawn" | "sunrise" | "morning"
  | "daylight" | "evening" | "sunset" | "dusk";

export interface DailySolarPhase {
  readonly phase: AuthoredDailyPhase;
  /** A monotonic authored visual timeline consumed by global lighting and atmosphere. */
  readonly visualDayPhase: number;
  /** Continuous solar-path progress; 0 is sunrise, 0.5 noon, and 1 sunset. */
  readonly solarCycleProgress: number;
  /** Signed solar path: positive above the horizon and negative during night. */
  readonly solarPhase: number;
}

export interface EnvironmentTime {
  readonly normalizedDayPhase: number;
  readonly timeOfDayHours: number;
  readonly authoredDailyPhase: AuthoredDailyPhase;
  readonly visualDayPhase: number;
  /** Negative below the horizon, zero at authored sunrise/sunset, and 1 at noon. */
  readonly solarPhase: number;
  /** Game-native renderer/world-space angle, not a conventional compass bearing. */
  readonly solarAzimuthDegrees: number;
  /** Signed authored solar elevation: negative values are below the horizon. */
  readonly solarElevationDegrees: number;
  readonly maximumNoonSolarElevationDegrees: number;
}

export interface EnvironmentTimeOptions {
  readonly maximumNoonSolarElevationDegrees?: number;
}

export function normalizeDayPhase(phase: number): number {
  if (!Number.isFinite(phase)) return 0;
  return ((phase % 1) + 1) % 1;
}

const VISUAL_DAY_PHASES: readonly (readonly [number, number])[] = [
  [0, 0],
  [AUTHORED_PRE_DAWN_START_HOURS, 0.18],
  [AUTHORED_SUNRISE_HOURS, 0.25],
  [AUTHORED_SOFT_MORNING_END_HOURS, 0.36],
  [AUTHORED_NOON_HOURS, 0.5],
  [AUTHORED_BROAD_DAYLIGHT_END_HOURS, 0.7],
  [AUTHORED_SUNSET_START_HOURS, 0.8],
  [AUTHORED_SUNSET_HOURS, 0.82],
  [AUTHORED_DUSK_END_HOURS, 0.89],
  [HOURS_PER_DAY, 1],
];

/** Pure authored visual schedule; it intentionally has a longer-than-astronomical day. */
export function deriveAuthoredDailySolarPhase(timeOfDayHours: number): DailySolarPhase {
  const hours = normalizeDayPhase(timeOfDayHours / HOURS_PER_DAY) * HOURS_PER_DAY;
  const visualDayPhase = interpolateVisualDayPhase(hours);
  const solarCycleProgress = hours >= AUTHORED_SUNSET_HOURS
    ? 1 + (hours - AUTHORED_SUNSET_HOURS) / (HOURS_PER_DAY - AUTHORED_SUNSET_HOURS + AUTHORED_SUNRISE_HOURS)
    : hours < AUTHORED_SUNRISE_HOURS
      ? 1 + (hours + HOURS_PER_DAY - AUTHORED_SUNSET_HOURS) / (HOURS_PER_DAY - AUTHORED_SUNSET_HOURS + AUTHORED_SUNRISE_HOURS)
      : hours <= AUTHORED_NOON_HOURS
        ? (hours - AUTHORED_SUNRISE_HOURS) / (AUTHORED_NOON_HOURS - AUTHORED_SUNRISE_HOURS) * 0.5
        : 0.5 + (hours - AUTHORED_NOON_HOURS) / (AUTHORED_SUNSET_HOURS - AUTHORED_NOON_HOURS) * 0.5;
  return Object.freeze({
    phase: phaseAt(hours),
    visualDayPhase,
    solarCycleProgress,
    solarPhase: Math.sin(solarCycleProgress * Math.PI),
  });
}

/** Pure authored time model; its azimuth is a game-native world-space angle, not geographic astronomy. */
export function deriveEnvironmentTime(
  normalizedDayPhase: number,
  options: EnvironmentTimeOptions = {},
): EnvironmentTime {
  const phase = normalizeDayPhase(normalizedDayPhase);
  const timeOfDayHours = phase * HOURS_PER_DAY;
  const maximumNoonSolarElevationDegrees = Math.min(90, Math.max(0, options.maximumNoonSolarElevationDegrees ?? DEFAULT_MAXIMUM_NOON_SOLAR_ELEVATION_DEGREES));
  const dailySolarPhase = deriveAuthoredDailySolarPhase(timeOfDayHours);
  return Object.freeze({
    normalizedDayPhase: phase,
    timeOfDayHours,
    authoredDailyPhase: dailySolarPhase.phase,
    visualDayPhase: dailySolarPhase.visualDayPhase,
    solarPhase: dailySolarPhase.solarPhase,
    solarAzimuthDegrees: ((AUTHORED_NOON_AZIMUTH_DEGREES + 90 - dailySolarPhase.solarCycleProgress * DEGREES_PER_TURN / 2) % DEGREES_PER_TURN + DEGREES_PER_TURN) % DEGREES_PER_TURN,
    solarElevationDegrees: maximumNoonSolarElevationDegrees * dailySolarPhase.solarPhase,
    maximumNoonSolarElevationDegrees,
  });
}

function interpolateVisualDayPhase(hours: number): number {
  for (let index = 1; index < VISUAL_DAY_PHASES.length; index += 1) {
    const [nextHours, nextPhase] = VISUAL_DAY_PHASES[index]!;
    if (hours <= nextHours) {
      const [previousHours, previousPhase] = VISUAL_DAY_PHASES[index - 1]!;
      return previousPhase + (nextPhase - previousPhase) * (hours - previousHours) / (nextHours - previousHours);
    }
  }
  return VISUAL_DAY_PHASES[VISUAL_DAY_PHASES.length - 1]![1];
}

function phaseAt(hours: number): AuthoredDailyPhase {
  if (hours < AUTHORED_PRE_DAWN_START_HOURS || hours >= AUTHORED_DUSK_END_HOURS) return "true-night";
  if (hours < AUTHORED_SUNRISE_HOURS) return "pre-dawn";
  if (hours < AUTHORED_SUNRISE_END_HOURS) return "sunrise";
  if (hours < AUTHORED_SOFT_MORNING_END_HOURS) return "morning";
  if (hours < AUTHORED_BROAD_DAYLIGHT_END_HOURS) return "daylight";
  if (hours < AUTHORED_SUNSET_START_HOURS) return "evening";
  if (hours < AUTHORED_SUNSET_HOURS) return "sunset";
  return "dusk";
}
