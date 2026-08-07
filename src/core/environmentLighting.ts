import type { EnvironmentTime } from "./environmentTime";

export interface EnvironmentColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export type EnvironmentLightingPhase =
  | "midnight" | "pre-dawn" | "sunrise" | "morning"
  | "noon" | "afternoon" | "sunset" | "dusk";

export interface EnvironmentLightingState {
  readonly solarAzimuthDegrees: number;
  readonly solarElevationDegrees: number;
  readonly isSunAboveHorizon: boolean;
  readonly directLightIntensity: number;
  readonly directLightColor: EnvironmentColor;
  readonly hemisphereIntensity: number;
  readonly hemisphereSkyColor: EnvironmentColor;
  readonly hemisphereGroundColor: EnvironmentColor;
  readonly solarShadowStrength: number;
  readonly phase: EnvironmentLightingPhase;
}

interface LightingControlPoint {
  readonly phase: number;
  readonly lightingPhase: EnvironmentLightingPhase;
  readonly directLightIntensity: number;
  readonly directLightColor: EnvironmentColor;
  readonly hemisphereIntensity: number;
  readonly hemisphereSkyColor: EnvironmentColor;
  readonly hemisphereGroundColor: EnvironmentColor;
}

const color = (hex: number): EnvironmentColor => ({
  red: ((hex >> 16) & 0xff) / 0xff,
  green: ((hex >> 8) & 0xff) / 0xff,
  blue: (hex & 0xff) / 0xff,
});

/** Centralized authored global-light controls, ordered around the full day. */
const AUTHORED_LIGHTING: readonly LightingControlPoint[] = [
  { phase: 0, lightingPhase: "midnight", directLightIntensity: 0, directLightColor: color(0x000000), hemisphereIntensity: 0.28, hemisphereSkyColor: color(0x23334f), hemisphereGroundColor: color(0x182019) },
  { phase: 0.18, lightingPhase: "pre-dawn", directLightIntensity: 0, directLightColor: color(0x000000), hemisphereIntensity: 0.34, hemisphereSkyColor: color(0x3d4d6c), hemisphereGroundColor: color(0x243025) },
  { phase: 0.25, lightingPhase: "sunrise", directLightIntensity: 0.32, directLightColor: color(0xffb06a), hemisphereIntensity: 0.54, hemisphereSkyColor: color(0x8b8292), hemisphereGroundColor: color(0x4c4737) },
  { phase: 0.36, lightingPhase: "morning", directLightIntensity: 1.45, directLightColor: color(0xffe0b0), hemisphereIntensity: 1.18, hemisphereSkyColor: color(0xc7dcf0), hemisphereGroundColor: color(0x718167) },
  { phase: 0.5, lightingPhase: "noon", directLightIntensity: 2.2, directLightColor: color(0xfff3dc), hemisphereIntensity: 1.55, hemisphereSkyColor: color(0xe0edf5), hemisphereGroundColor: color(0x91a47c) },
  { phase: 0.64, lightingPhase: "afternoon", directLightIntensity: 1.45, directLightColor: color(0xffe0b0), hemisphereIntensity: 1.18, hemisphereSkyColor: color(0xc7dcf0), hemisphereGroundColor: color(0x718167) },
  { phase: 0.75, lightingPhase: "sunset", directLightIntensity: 0.32, directLightColor: color(0xffa45e), hemisphereIntensity: 0.54, hemisphereSkyColor: color(0x8b7888), hemisphereGroundColor: color(0x4b4034) },
  { phase: 0.82, lightingPhase: "dusk", directLightIntensity: 0, directLightColor: color(0x000000), hemisphereIntensity: 0.34, hemisphereSkyColor: color(0x3d4d6c), hemisphereGroundColor: color(0x243025) },
  { phase: 1, lightingPhase: "midnight", directLightIntensity: 0, directLightColor: color(0x000000), hemisphereIntensity: 0.28, hemisphereSkyColor: color(0x23334f), hemisphereGroundColor: color(0x182019) },
];

function interpolateColor(first: EnvironmentColor, second: EnvironmentColor, amount: number): EnvironmentColor {
  return Object.freeze({
    red: first.red + (second.red - first.red) * amount,
    green: first.green + (second.green - first.green) * amount,
    blue: first.blue + (second.blue - first.blue) * amount,
  });
}

function controlPointsAt(phase: number): readonly [LightingControlPoint, LightingControlPoint, number] {
  for (let index = 1; index < AUTHORED_LIGHTING.length; index += 1) {
    const next = AUTHORED_LIGHTING[index]!;
    if (phase <= next.phase) {
      const previous = AUTHORED_LIGHTING[index - 1]!;
      return [previous, next, (phase - previous.phase) / (next.phase - previous.phase)];
    }
  }
  return [AUTHORED_LIGHTING[0]!, AUTHORED_LIGHTING[0]!, 0];
}

/** Pure authored conversion from solar geometry to global lighting values. */
export function deriveEnvironmentLighting(environment: EnvironmentTime): EnvironmentLightingState {
  const [previous, next, amount] = controlPointsAt(environment.normalizedDayPhase);
  const directLightIntensity = previous.directLightIntensity
    + (next.directLightIntensity - previous.directLightIntensity) * amount;
  const isSunAboveHorizon = environment.solarPhase > 1e-6 && environment.solarElevationDegrees > 1e-6;
  const daylight = isSunAboveHorizon ? smoothstep(0, 0.08, environment.solarPhase) : 0;
  return Object.freeze({
    solarAzimuthDegrees: environment.solarAzimuthDegrees,
    solarElevationDegrees: environment.solarElevationDegrees,
    isSunAboveHorizon,
    directLightIntensity: directLightIntensity * daylight,
    directLightColor: interpolateColor(previous.directLightColor, next.directLightColor, amount),
    hemisphereIntensity: previous.hemisphereIntensity + (next.hemisphereIntensity - previous.hemisphereIntensity) * amount,
    hemisphereSkyColor: interpolateColor(previous.hemisphereSkyColor, next.hemisphereSkyColor, amount),
    hemisphereGroundColor: interpolateColor(previous.hemisphereGroundColor, next.hemisphereGroundColor, amount),
    solarShadowStrength: directLightIntensity <= 0 ? 0 : daylight * Math.min(1, directLightIntensity / 1.45),
    phase: amount < 0.5 ? previous.lightingPhase : next.lightingPhase,
  });
}

function smoothstep(minimum: number, maximum: number, value: number): number {
  const amount = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return amount * amount * (3 - 2 * amount);
}
