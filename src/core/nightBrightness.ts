import type { EnvironmentLightingState } from "./environmentLighting";
import type { EnvironmentTime } from "./environmentTime";

export const NIGHT_BRIGHTNESS_STORAGE_KEY = "mobile-walker:night-brightness";
export const DEFAULT_NIGHT_BRIGHTNESS_MULTIPLIER = 1;
export const MIN_NIGHT_BRIGHTNESS_MULTIPLIER = 0.5;
export const MAX_NIGHT_BRIGHTNESS_MULTIPLIER = 4;
export const NIGHT_BRIGHTNESS_STEP = 0.05;
const BASELINE_NIGHT_BRIGHTNESS_MULTIPLIER = 8;

export function normalizeNightBrightnessMultiplier(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_NIGHT_BRIGHTNESS_MULTIPLIER;
  return Math.min(MAX_NIGHT_BRIGHTNESS_MULTIPLIER, Math.max(MIN_NIGHT_BRIGHTNESS_MULTIPLIER, value));
}

export function restoreNightBrightnessMultiplier(value: string | null): number {
  return value === null
    ? DEFAULT_NIGHT_BRIGHTNESS_MULTIPLIER
    : normalizeNightBrightnessMultiplier(Number(value));
}

export function deriveNightInfluence(environment: Pick<EnvironmentTime, "solarPhase">): number {
  const belowHorizon = Math.max(0, -environment.solarPhase);
  const amount = Math.min(1, belowHorizon / 0.25);
  return amount * amount * (3 - 2 * amount);
}

/** Applies the user visibility preference without changing authored sky, fog, or solar lighting. */
export function derivePresentedEnvironmentLighting(
  authored: EnvironmentLightingState,
  environment: Pick<EnvironmentTime, "solarPhase">,
  nightBrightnessMultiplier: number,
): EnvironmentLightingState {
  const nightInfluence = deriveNightInfluence(environment);
  const effectiveNightPreference = BASELINE_NIGHT_BRIGHTNESS_MULTIPLIER * normalizeNightBrightnessMultiplier(nightBrightnessMultiplier);
  const multiplier = 1 + (effectiveNightPreference - 1) * nightInfluence;
  return Object.freeze({
    ...authored,
    hemisphereIntensity: authored.hemisphereIntensity * multiplier,
  });
}
