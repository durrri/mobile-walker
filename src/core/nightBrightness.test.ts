import { describe, expect, it } from "vitest";

import { deriveEnvironmentLighting } from "./environmentLighting";
import { deriveEnvironmentTime } from "./environmentTime";
import {
  DEFAULT_NIGHT_BRIGHTNESS_MULTIPLIER,
  deriveNightInfluence,
  derivePresentedEnvironmentLighting,
  restoreNightBrightnessMultiplier,
} from "./nightBrightness";

const presentedAt = (hours: number, multiplier: number) => {
  const environment = deriveEnvironmentTime(hours / 24);
  return derivePresentedEnvironmentLighting(deriveEnvironmentLighting(environment), environment, multiplier);
};

describe("Night Brightness presentation", () => {
  it("uses the authored default for missing, invalid, and non-finite saved values", () => {
    expect(restoreNightBrightnessMultiplier(null)).toBe(DEFAULT_NIGHT_BRIGHTNESS_MULTIPLIER);
    expect(restoreNightBrightnessMultiplier("not a number")).toBe(DEFAULT_NIGHT_BRIGHTNESS_MULTIPLIER);
    expect(restoreNightBrightnessMultiplier("Infinity")).toBe(DEFAULT_NIGHT_BRIGHTNESS_MULTIPLIER);
  });

  it("restores valid values and clamps saved values to the development range", () => {
    expect(restoreNightBrightnessMultiplier("1.25")).toBe(1.25);
    expect(restoreNightBrightnessMultiplier("0")).toBe(0.5);
    expect(restoreNightBrightnessMultiplier("3")).toBe(2);
  });

  it("adjusts only nighttime hemisphere ambient without changing direct light, shadows, or sky", () => {
    const authored = presentedAt(0, 1);
    const dim = presentedAt(0, 0.5);
    const bright = presentedAt(0, 2);

    expect(dim.hemisphereIntensity).toBeLessThan(authored.hemisphereIntensity);
    expect(bright.hemisphereIntensity).toBeGreaterThan(authored.hemisphereIntensity);
    expect(bright.directLightIntensity).toBe(0);
    expect(bright.solarShadowStrength).toBe(0);
    expect(bright.backgroundColor).toEqual(authored.backgroundColor);
    expect(bright.fogColor).toEqual(authored.fogColor);
  });

  it("has no noon effect and fades continuously through dawn and dusk", () => {
    expect(presentedAt(12, 2).hemisphereIntensity).toBe(presentedAt(12, 1).hemisphereIntensity);
    const beforeDawn = deriveNightInfluence(deriveEnvironmentTime(5.9 / 24));
    const afterDawn = deriveNightInfluence(deriveEnvironmentTime(6.1 / 24));
    const beforeDusk = deriveNightInfluence(deriveEnvironmentTime(20.4 / 24));
    const afterDusk = deriveNightInfluence(deriveEnvironmentTime(20.6 / 24));

    expect(beforeDawn).toBeGreaterThan(afterDawn);
    expect(beforeDawn - afterDawn).toBeLessThan(0.1);
    expect(afterDusk).toBeGreaterThan(beforeDusk);
    expect(afterDusk - beforeDusk).toBeLessThan(0.1);
  });
});
