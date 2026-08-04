import { describe, expect, it } from "vitest";
import { DEFAULT_RIVER_GENERATION_CONFIG, generateMacroControlPoints, getWorldRiverGeneration,
  generateMeanderedControlPoints, sampleRegionalMeanderStrength, resetWorldRiverGenerationCaches,
  type MeanderRegion } from "./worldRiverGeneration";
import { RiverSpine } from "./riverSpineGeometry";

describe("R7 procedural macro river", () => {
  it("is deterministic, immutable, bounded and seed-sensitive", () => {
    const a = getWorldRiverGeneration();
    expect(generateMacroControlPoints(DEFAULT_RIVER_GENERATION_CONFIG)).toEqual(a.macroControlPoints);
    expect(Object.isFrozen(a.macroControlPoints)).toBe(true);
    const changed = getWorldRiverGeneration({ ...DEFAULT_RIVER_GENERATION_CONFIG, worldSeed: 42 });
    expect(changed.macroControlPoints).not.toEqual(a.macroControlPoints);
    expect(a.macroControlPoints[0]!.z).toBe(DEFAULT_RIVER_GENERATION_CONFIG.bounds.maxZ);
    expect(a.macroControlPoints.at(-1)!.z).toBe(DEFAULT_RIVER_GENERATION_CONFIG.bounds.minZ);
    expect(a.macroSpine.totalLength).toBeGreaterThan(250);
    for (const point of a.macroResampledPoints) {
      expect(point.x).toBeGreaterThanOrEqual(DEFAULT_RIVER_GENERATION_CONFIG.bounds.minX);
      expect(point.x).toBeLessThanOrEqual(DEFAULT_RIVER_GENERATION_CONFIG.bounds.maxX);
    }
  });

  it("is random-access cached and byte-equivalent after reset", () => {
    const first = getWorldRiverGeneration();
    expect(getWorldRiverGeneration()).toBe(first);
    const bytes = JSON.stringify(first.macroResampledPoints);
    resetWorldRiverGenerationCaches();
    const regenerated = getWorldRiverGeneration();
    expect(regenerated).not.toBe(first);
    expect(JSON.stringify(regenerated.macroResampledPoints)).toBe(bytes);
    expect(regenerated.macroSpine.nearestPointToRiver(12, 10)).toEqual(first.macroSpine.nearestPointToRiver(12, 10));
  });

  it("keeps finite frames and bounded arc-length samples", () => {
    const { macroSpine } = getWorldRiverGeneration();
    for (let distance = 0; distance <= macroSpine.totalLength; distance += 2) {
      const frame = macroSpine.sampleFrame(macroSpine.progressAtDistance(distance));
      expect(Object.values(frame.tangent).every(Number.isFinite)).toBe(true);
      expect(Object.values(frame.normal).every(Number.isFinite)).toBe(true);
    }
  });

  it("layers deterministic R8 arc-length meanders without mutating R7", () => {
    resetWorldRiverGenerationCaches();
    const first = getWorldRiverGeneration(), macroBytes = JSON.stringify(first.macroResampledPoints);
    expect(first.meanderedSpine).not.toBe(first.macroSpine);
    expect(JSON.stringify(first.macroResampledPoints)).toBe(macroBytes);
    expect(first.meanderedSpine.samplePosition(.5)).not.toEqual(first.macroSpine.samplePosition(.5));
    for (const progress of [0, 1]) {
      const macro = first.macroSpine.samplePosition(progress), final = first.meanderedSpine.samplePosition(progress);
      expect(Math.hypot(final.x - macro.x, final.z - macro.z)).toBeLessThan(1e-8);
    }
    expect(first.meanderWavelength).toBeGreaterThanOrEqual(first.config.meanderWavelengthRange[0]);
    expect(first.meanderWavelength).toBeLessThanOrEqual(first.config.meanderWavelengthRange[1]);
    expect(first.meanderAmplitude).toBeGreaterThanOrEqual(first.config.meanderAmplitudeRange[0] * .25);
    expect(first.meanderedSpine.totalLength / first.macroSpine.totalLength).toBeLessThan(1.2);
    const bytes = JSON.stringify(first.meanderedResampledPoints);
    resetWorldRiverGenerationCaches();
    expect(JSON.stringify(getWorldRiverGeneration().meanderedResampledPoints)).toBe(bytes);
  });

  it("clusters activity into smoothly faded belts separated by long quiet reaches", () => {
    const generated = getWorldRiverGeneration();
    const displacements = Array.from({ length: 201 }, (_, index) => {
      const progress = index / 200, macro = generated.macroSpine.samplePosition(progress);
      const final = generated.meanderedSpine.nearestPointToRiver(macro.x, macro.z);
      return final.distanceToRiver;
    });
    expect(displacements.filter(value => value < .15).length / displacements.length).toBeGreaterThan(.35);
    expect(displacements.some(value => value > 1)).toBe(true);
    for (const region of generated.meanderRegions) {
      expect(sampleRegionalMeanderStrength(region.startDistance, region)).toBe(0);
      expect(sampleRegionalMeanderStrength(region.endDistance, region)).toBe(0);
      expect(sampleRegionalMeanderStrength(region.startDistance + .01, region)).toBeLessThan(.001);
      expect(region.endDistance).toBeLessThan(generated.macroSpine.totalLength - generated.config.endpointProtectionDistance / 2);
    }
  });

  it("supports a local strong belt with heading reversal and smooth reconnection", () => {
    const macro = new RiverSpine([{ x: 0, z: 100 }, { x: 0, z: -100 }]);
    const region: MeanderRegion = Object.freeze({ startDistance: 55, endDistance: 145,
      fadeInDistance: 12, fadeOutDistance: 12, strength: 1, profile: "strong",
      targetWavelength: 81, targetBendRadius: 8, correctionApplied: false });
    const points = generateMeanderedControlPoints(macro, DEFAULT_RIVER_GENERATION_CONFIG, [region]);
    const final = new RiverSpine(points);
    let reversed = false;
    for (let index = 1; index < points.length; index += 1) reversed ||= points[index]!.z > points[index - 1]!.z;
    expect(reversed).toBe(true);
    for (const distance of [region.startDistance, region.endDistance]) {
      const progress = macro.progressAtDistance(distance), expected = macro.samplePosition(progress);
      const actual = final.nearestPointToRiver(expected.x, expected.z);
      expect(actual.distanceToRiver).toBeLessThan(.35);
      expect(Math.abs(actual.tangent.z)).toBeGreaterThan(.8);
    }
  });
});
