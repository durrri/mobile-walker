import type { EnvironmentTime } from "./environmentTime";

export interface EnvironmentColor {
  /** Normalized sRGB-authored channels; renderer consumers convert them to their working space. */
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export type EnvironmentLightingPhase =
  | "midnight" | "pre-dawn" | "sunrise" | "morning"
  | "noon" | "afternoon" | "evening" | "sunset" | "dusk";

export interface EnvironmentLightingState {
  readonly solarAzimuthDegrees: number;
  readonly solarElevationDegrees: number;
  readonly isSunAboveHorizon: boolean;
  readonly directLightIntensity: number;
  readonly directLightColor: EnvironmentColor;
  readonly hemisphereIntensity: number;
  readonly hemisphereSkyColor: EnvironmentColor;
  readonly hemisphereGroundColor: EnvironmentColor;
  readonly backgroundColor: EnvironmentColor;
  readonly fogColor: EnvironmentColor;
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
  readonly backgroundColor: EnvironmentColor;
  readonly fogColor: EnvironmentColor;
}

const color = (hex: number): EnvironmentColor => ({
  red: ((hex >> 16) & 0xff) / 0xff,
  green: ((hex >> 8) & 0xff) / 0xff,
  blue: (hex & 0xff) / 0xff,
});

/** Centralized global-light controls keyed only by EnvironmentTime's authored visual phase. */
const AUTHORED_LIGHTING: readonly LightingControlPoint[] = [
  { phase: 0, lightingPhase: "midnight", directLightIntensity: 0, directLightColor: color(0x000000), hemisphereIntensity: 0.39, hemisphereSkyColor: color(0x23334f), hemisphereGroundColor: color(0x182019), backgroundColor: color(0x1e2b45), fogColor: color(0x202d42) },
  { phase: 0.18, lightingPhase: "pre-dawn", directLightIntensity: 0, directLightColor: color(0x000000), hemisphereIntensity: 0.45, hemisphereSkyColor: color(0x565276), hemisphereGroundColor: color(0x303445), backgroundColor: color(0x4b496d), fogColor: color(0x514c6d) },
  { phase: 0.25, lightingPhase: "sunrise", directLightIntensity: 0.32, directLightColor: color(0xffb07a), hemisphereIntensity: 0.58, hemisphereSkyColor: color(0xbd839b), hemisphereGroundColor: color(0x634851), backgroundColor: color(0xd29aaa), fogColor: color(0xbf8da0) },
  { phase: 0.36, lightingPhase: "morning", directLightIntensity: 1.45, directLightColor: color(0xffe0b0), hemisphereIntensity: 1.18, hemisphereSkyColor: color(0xc7dcf0), hemisphereGroundColor: color(0x718167), backgroundColor: color(0xcde4dc), fogColor: color(0xc8ddd3) },
  { phase: 0.5, lightingPhase: "noon", directLightIntensity: 2.2, directLightColor: color(0xfff3dc), hemisphereIntensity: 1.55, hemisphereSkyColor: color(0xe0edf5), hemisphereGroundColor: color(0x91a47c), backgroundColor: color(0xd9ead8), fogColor: color(0xd4e4d4) },
  { phase: 0.7, lightingPhase: "afternoon", directLightIntensity: 1.45, directLightColor: color(0xffe0b0), hemisphereIntensity: 1.18, hemisphereSkyColor: color(0xc7dcf0), hemisphereGroundColor: color(0x718167), backgroundColor: color(0xdfe2cd), fogColor: color(0xd6dccb) },
  { phase: 0.8, lightingPhase: "evening", directLightIntensity: 0.65, directLightColor: color(0xff812d), hemisphereIntensity: 0.78, hemisphereSkyColor: color(0xc17e5d), hemisphereGroundColor: color(0x704a32), backgroundColor: color(0xd97a48), fogColor: color(0xc8754e) },
  { phase: 0.82, lightingPhase: "sunset", directLightIntensity: 0, directLightColor: color(0xff5d1f), hemisphereIntensity: 0.58, hemisphereSkyColor: color(0xa35d69), hemisphereGroundColor: color(0x573a38), backgroundColor: color(0xb55b62), fogColor: color(0xa85a63) },
  { phase: 0.89, lightingPhase: "dusk", directLightIntensity: 0, directLightColor: color(0x000000), hemisphereIntensity: 0.45, hemisphereSkyColor: color(0x4a5779), hemisphereGroundColor: color(0x2c3541), backgroundColor: color(0x53627c), fogColor: color(0x516078) },
  { phase: 1, lightingPhase: "midnight", directLightIntensity: 0, directLightColor: color(0x000000), hemisphereIntensity: 0.39, hemisphereSkyColor: color(0x23334f), hemisphereGroundColor: color(0x182019), backgroundColor: color(0x1e2b45), fogColor: color(0x202d42) },
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
  const [previous, next, amount] = controlPointsAt(environment.visualDayPhase);
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
    backgroundColor: interpolateColor(previous.backgroundColor, next.backgroundColor, amount),
    fogColor: interpolateColor(previous.fogColor, next.fogColor, amount),
    solarShadowStrength: directLightIntensity <= 0 ? 0 : daylight * Math.min(1, directLightIntensity / 1.45),
    phase: amount < 0.5 ? previous.lightingPhase : next.lightingPhase,
  });
}

function smoothstep(minimum: number, maximum: number, value: number): number {
  const amount = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return amount * amount * (3 - 2 * amount);
}
