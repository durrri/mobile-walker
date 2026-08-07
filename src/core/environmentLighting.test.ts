import { describe, expect, it } from "vitest";

import { deriveEnvironmentLighting } from "./environmentLighting";
import { AUTHORED_SUNSET_HOURS, deriveEnvironmentTime } from "./environmentTime";

const options = { maximumNoonSolarElevationDegrees: 60 };
const lightingAt = (phase: number) => deriveEnvironmentLighting(deriveEnvironmentTime(phase, options));

describe("deriveEnvironmentLighting", () => {
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
        ...Object.values(lighting.backgroundColor),
        ...Object.values(lighting.fogColor),
      ].every(Number.isFinite)).toBe(true);
    }
  });

  it("is continuous at the day wrap and retains a nonzero night ambient baseline", () => {
    const before = lightingAt(1 - 1e-8);
    const after = lightingAt(0);
    expect(before.directLightIntensity).toBeCloseTo(after.directLightIntensity, 6);
    expect(before.hemisphereIntensity).toBeCloseTo(after.hemisphereIntensity, 6);
    expect(before.backgroundColor.red).toBeCloseTo(after.backgroundColor.red, 6);
    expect(before.backgroundColor.green).toBeCloseTo(after.backgroundColor.green, 6);
    expect(before.backgroundColor.blue).toBeCloseTo(after.backgroundColor.blue, 6);
    expect(before.fogColor.red).toBeCloseTo(after.fogColor.red, 6);
    expect(before.fogColor.green).toBeCloseTo(after.fogColor.green, 6);
    expect(before.fogColor.blue).toBeCloseTo(after.fogColor.blue, 6);
    expect(after.hemisphereIntensity).toBeGreaterThan(0);
  });

  it("keeps fog close to the sky while making night substantially darker than day", () => {
    const midnight = lightingAt(0);
    const noon = lightingAt(0.5);
    const sunrise = lightingAt(0.25);

    expect(midnight.backgroundColor.blue).toBeGreaterThan(midnight.backgroundColor.red);
    expect(midnight.fogColor.green).toBeLessThan(noon.fogColor.green);
    expect(sunrise.backgroundColor.red).toBeGreaterThan(midnight.backgroundColor.red);
    expect(Math.abs(noon.backgroundColor.green - noon.fogColor.green)).toBeLessThan(0.05);
    expect(Math.abs(midnight.backgroundColor.blue - midnight.fogColor.blue)).toBeLessThan(0.05);
  });

  it("keeps extended evening direct light and shadows until the authored sunset", () => {
    const midnight = lightingAt(0);
    const sunrise = lightingAt(0.25);
    const morning = lightingAt(0.36);
    const noon = lightingAt(0.5);
    const evening = lightingAt(18 / 24);
    const lateEvening = lightingAt(20 / 24);
    const sunset = lightingAt(AUTHORED_SUNSET_HOURS / 24);
    expect(midnight.directLightIntensity).toBe(0);
    expect(midnight.solarShadowStrength).toBe(0);
    expect(sunrise.directLightIntensity).toBe(0);
    expect(evening.directLightIntensity).toBeGreaterThan(0);
    expect(evening.solarShadowStrength).toBeGreaterThan(0);
    expect(lateEvening.directLightIntensity).toBeGreaterThan(0);
    expect(lateEvening.solarShadowStrength).toBeGreaterThan(0);
    expect(sunset.directLightIntensity).toBe(0);
    expect(sunset.solarShadowStrength).toBe(0);
    expect(morning.directLightIntensity).toBeGreaterThan(0);
    expect(noon.directLightIntensity).toBeGreaterThan(morning.directLightIntensity);
    expect(noon.hemisphereIntensity).toBeGreaterThan(midnight.hemisphereIntensity);
  });

  it("keeps presentation synchronized with the authored phase from evening through true night", () => {
    const evening = lightingAt(18 / 24);
    const dusk = lightingAt(21 / 24);
    const night = lightingAt(22 / 24);

    expect(evening.phase).not.toBe("midnight");
    expect(evening.backgroundColor.red).toBeGreaterThan(night.backgroundColor.red);
    expect(dusk.directLightIntensity).toBe(0);
    expect(dusk.hemisphereIntensity).toBeGreaterThan(night.hemisphereIntensity);
    expect(night.directLightIntensity).toBe(0);
    expect(night.solarShadowStrength).toBe(0);
    expect(night.hemisphereIntensity).toBeGreaterThan(0);
  });

  it("keeps azimuth time-derived and noon elevation configured by EnvironmentTime", () => {
    const noon = lightingAt(0.5);
    const afternoon = lightingAt(0.75);
    expect(noon.solarElevationDegrees).toBe(60);
    expect(noon.solarAzimuthDegrees).not.toBe(afternoon.solarAzimuthDegrees);
  });
});
