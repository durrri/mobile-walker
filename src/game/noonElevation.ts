import { DEFAULT_MAXIMUM_NOON_SOLAR_ELEVATION_DEGREES } from "../core/environmentTime";

export const NOON_ELEVATION_STORAGE_KEY = "mobile-walker:noon-solar-elevation";

export function restoreNoonElevation(rawValue: string | null): number {
  if (rawValue === null) return DEFAULT_MAXIMUM_NOON_SOLAR_ELEVATION_DEGREES;
  const elevation = Number(rawValue);
  return Number.isFinite(elevation)
    ? Math.min(90, Math.max(0, elevation))
    : DEFAULT_MAXIMUM_NOON_SOLAR_ELEVATION_DEGREES;
}
