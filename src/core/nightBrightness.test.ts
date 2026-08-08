import { describe, expect, it } from "vitest";

import { deriveEnvironmentLighting } from "./environmentLighting";
import { deriveEnvironmentTime } from "./environmentTime";
import {
  DEFAULT_NIGHT_BRIGHTNESS_MULTIPLIER,
  deriveNightInfluence,
  derivePresentedEnvironmentLighting,
  MAX_NIGHT_BRIGHTNESS_MULTIPLIER,
  MIN_NIGHT_BRIGHTNESS_MULTIPLIER,
  normalizeNightBrightnessMultiplier,
  restoreNightBrightnessMultiplier,
} from "./nightBrightness";

const presentedAt = (hours: number, multiplier: number) => {
  const environment = deriveEnvironmentTime(hours / 24);
  return derivePresentedEnvironmentLighting(deriveEnvironmentLighting(environment), environment, multiplier);
};
const oldScalePresentationAt = (hours: number, multiplier: number) => {
  const environment = deriveEnvironmentTime(hours / 24);
  const authored = deriveEnvironmentLighting(environment);
  return authored.hemisphereIntensity * (1 + (multiplier - 1) * deriveNightInfluence(environment));
};

describe("Night Brightness presentation", () => {
  it("uses the 1× default for missing, invalid, and non-finite saved values", () => {
    expect(restoreNightBrightnessMultiplier(null)).toBe(DEFAULT_NIGHT_BRIGHTNESS_MULTIPLIER);
    expect(restoreNightBrightnessMultiplier("not a number")).toBe(DEFAULT_NIGHT_BRIGHTNESS_MULTIPLIER);
    expect(restoreNightBrightnessMultiplier("Infinity")).toBe(DEFAULT_NIGHT_BRIGHTNESS_MULTIPLIER);
  });

  it("restores valid values and clamps saved values to the development range", () => {
    expect(restoreNightBrightnessMultiplier("1.25")).toBe(1.25);
    expect(restoreNightBrightnessMultiplier("4")).toBe(MAX_NIGHT_BRIGHTNESS_MULTIPLIER);
    expect(restoreNightBrightnessMultiplier("0")).toBe(MIN_NIGHT_BRIGHTNESS_MULTIPLIER);
    expect(restoreNightBrightnessMultiplier("5")).toBe(MAX_NIGHT_BRIGHTNESS_MULTIPLIER);
    expect(normalizeNightBrightnessMultiplier(4.1)).toBe(MAX_NIGHT_BRIGHTNESS_MULTIPLIER);
  });

  it("maps the rebased scale to its equivalent old presentation", () => {
    for (const hours of [0, 5.9, 6.1, 12, 20.4, 20.6]) {
      for (const [rebased, oldScale] of [[0.5, 4], [1, 8], [2, 16], [4, 32]]) {
        expect(presentedAt(hours, rebased).hemisphereIntensity).toBe(oldScalePresentationAt(hours, oldScale));
      }
    }
  });

  it("adjusts only nighttime hemisphere ambient", () => {
    const authored = presentedAt(0, 1);
    const bright = presentedAt(0, 4);

    expect(bright.directLightIntensity).toBe(authored.directLightIntensity);
    expect(bright.solarShadowStrength).toBe(authored.solarShadowStrength);
    expect(bright.backgroundColor).toEqual(authored.backgroundColor);
    expect(bright.fogColor).toEqual(authored.fogColor);
  });

  it("has no noon effect and fades continuously through dawn and dusk", () => {
    for (const multiplier of [0.5, 1, 4]) {
      expect(presentedAt(12, multiplier).hemisphereIntensity).toBe(presentedAt(12, 1).hemisphereIntensity);
    }
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
