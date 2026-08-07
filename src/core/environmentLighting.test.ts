import { describe, expect, it } from "vitest";

import { deriveEnvironmentLighting } from "./environmentLighting";
import { deriveEnvironmentTime } from "./environmentTime";

const options = { maximumNoonSolarElevationDegrees: 60 };
const lightingAt = (phase: number) => deriveEnvironmentLighting(deriveEnvironmentTime(phase, options));

describe("EnvironmentLightingModel", () => {
  it("is deterministic and finite through a complete day", () => {
    expect(lightingAt(0.5)).toEqual(lightingAt(0.5));
    for (let phase = 0; phase <= 1; phase += 0.01) {
      const lighting = lightingAt(phase);
      expect([
        lighting.solarAzimuthDegrees, lighting.solarElevationDegrees,
        lighting.directLightIntensity, lighting.hemisphereIntensity, lighting.solarShadowStrength,
        ...Object.values(lighting.directLightColor),
        ...Object.values(lighting.hemisphereSkyColor),
        ...Object.values(lighting.hemisphereGroundColor),
      ].every(Number.isFinite)).toBe(true);
    }
  });

  it("is continuous at the day wrap and retains a nonzero night ambient baseline", () => {
    const before = lightingAt(1 - 1e-8);
    const after = lightingAt(0);
    expect(before.directLightIntensity).toBeCloseTo(after.directLightIntensity, 6);
    expect(before.hemisphereIntensity).toBeCloseTo(after.hemisphereIntensity, 6);
    expect(after.hemisphereIntensity).toBeGreaterThan(0);
  });

  it("uses direct light and shadows only while the sun is above the horizon", () => {
    const midnight = lightingAt(0);
    const sunrise = lightingAt(0.25);
    const morning = lightingAt(0.36);
    const noon = lightingAt(0.5);
    const sunset = lightingAt(0.75);
    expect(midnight.directLightIntensity).toBe(0);
    expect(midnight.solarShadowStrength).toBe(0);
    expect(sunrise.directLightIntensity).toBe(0);
    expect(sunset.directLightIntensity).toBe(0);
    expect(morning.directLightIntensity).toBeGreaterThan(0);
    expect(noon.directLightIntensity).toBeGreaterThan(morning.directLightIntensity);
    expect(noon.hemisphereIntensity).toBeGreaterThan(midnight.hemisphereIntensity);
  });

  it("keeps azimuth time-derived and noon elevation configured by EnvironmentTime", () => {
    const noon = lightingAt(0.5);
    const afternoon = lightingAt(0.75);
    expect(noon.solarElevationDegrees).toBe(60);
    expect(noon.solarAzimuthDegrees).not.toBe(afternoon.solarAzimuthDegrees);
  });
});
