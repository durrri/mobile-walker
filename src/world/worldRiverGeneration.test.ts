import { describe, expect, it } from "vitest";
import { DEFAULT_RIVER_GENERATION_CONFIG, generateMacroControlPoints, getWorldRiverGeneration,
  generateMeanderedControlPoints, sampleRegionalMeanderStrength, resetWorldRiverGenerationCaches,
  validateControlPolygonSeparation, validateSmoothedSpineSeparation, type MeanderRegion } from "./worldRiverGeneration";
import { RiverSpine } from "./riverSpineGeometry";

describe("R7 procedural macro river", () => {
  it("rejects Catmull-Rom separation hidden by a valid raw control polygon", () => {
    const config={...DEFAULT_RIVER_GENERATION_CONFIG,selfSeparationDistance:5,bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100}};
    const points=[{"x":-10.541778989136219,"z":18.69270673720166},{"x":0.16968129202723503,"z":15.048832636792213},{"x":-17.978254854679108,"z":4.695183543022722},{"x":10.990518499165773,"z":-0.43811429431661963},{"x":-19.340270571410656,"z":-6.607539602089673},{"x":-9.981954339891672,"z":-15.776222317945212},{"x":3.627607896924019,"z":-18.630663408432156}];
    expect(validateControlPolygonSeparation(points,config)).toBe(true);
    expect(validateSmoothedSpineSeparation(new RiverSpine(points),config)).toMatchObject({valid:false});
  });

  it("accepts measured smoothed separation for reference and strong-region rivers deterministically", () => {
    for(const seed of [DEFAULT_RIVER_GENERATION_CONFIG.worldSeed,1,6,8]){
      const generated=getWorldRiverGeneration({...DEFAULT_RIVER_GENERATION_CONFIG,worldSeed:seed});
      expect(validateSmoothedSpineSeparation(generated.macroSpine,generated.config).valid).toBe(true);
      expect(validateSmoothedSpineSeparation(generated.meanderedSpine,generated.config).valid).toBe(true);
      if(seed!==DEFAULT_RIVER_GENERATION_CONFIG.worldSeed)expect(generated.meanderRegions.some(region=>region.profile==="strong")).toBe(true);
    }
  });

  it("falls back when corrected smoothed separation still fails and regenerates identically", () => {
    const config={...DEFAULT_RIVER_GENERATION_CONFIG,worldSeed:6,bounds:{minX:-50000,maxX:50000,minZ:-128,maxZ:128},
      meanderAmplitudeRange:[3000,3000] as const,curvatureGuard:10};
    const first=getWorldRiverGeneration(config),bytes=JSON.stringify(first.meanderedResampledPoints);
    expect(first.usedFallback).toBe(true);expect(first.correctionReasons).toContain("self-separation");
    expect(validateSmoothedSpineSeparation(first.meanderedSpine,config).valid).toBe(true);
    resetWorldRiverGenerationCaches();
    expect(JSON.stringify(getWorldRiverGeneration(config).meanderedResampledPoints)).toBe(bytes);
  });
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


  it("extends the standard river bounds and distributes quiet-gapped meander regions", () => {
    const generated = getWorldRiverGeneration();
    expect(generated.config.generationVersion).toBe(10);
    expect(generated.config.bounds).toEqual({ minX: -160, maxX: 160, minZ: -3000, maxZ: 0 });
    expect(generated.meanderedSpine.totalLength).toBeGreaterThan(3000);
    expect(generated.meanderedSpine.bounds.minZ).toBeLessThanOrEqual(-2999);
    expect(generated.meanderedSpine.bounds.maxZ).toBeGreaterThanOrEqual(-1);
    expect(generated.meanderedSpine.bounds.minX).toBeGreaterThanOrEqual(-160);
    expect(generated.meanderedSpine.bounds.maxX).toBeLessThanOrEqual(160);
    expect(generated.meanderRegions.length).toBeGreaterThanOrEqual(8);
    expect(generated.meanderRegions.length).toBeLessThanOrEqual(14);
    expect(generated.meanderRegions.filter(region => region.profile === "strong").length).toBeLessThanOrEqual(2);
    const thirds = generated.meanderRegions.map(region => Math.floor(((region.startDistance + region.endDistance) / 2) / generated.macroSpine.totalLength * 3));
    expect(new Set(thirds).size).toBe(3);
    const quietGaps = generated.meanderRegions.slice(1).map((region, index) => region.startDistance - generated.meanderRegions[index]!.endDistance);
    expect(quietGaps.some(gap => gap > 90)).toBe(true);
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
      targetWavelength: 81, targetBendRadius: 4, correctionApplied: false });
    const points = generateMeanderedControlPoints(macro, DEFAULT_RIVER_GENERATION_CONFIG, [region]);
    const final = new RiverSpine(points);
    let reversed = false;
    for (let index = 1; index < points.length; index += 1) reversed ||= points[index]!.z > points[index - 1]!.z;
    expect(reversed).toBe(true);
    let maximumReversal = 0, minimumRadius = Infinity;
    for (let index = 1; index < 500; index += 1) {
      const tangent = final.sampleTangent(index / 500);
      maximumReversal = Math.max(maximumReversal, Math.acos(Math.max(-1, Math.min(1, -tangent.z))));
    }
    for (let index = 1; index < points.length - 1; index += 1) {
      const a = points[index - 1]!, b = points[index]!, c = points[index + 1]!;
      const ab = Math.hypot(a.x - b.x, a.z - b.z), bc = Math.hypot(b.x - c.x, b.z - c.z), ac = Math.hypot(a.x - c.x, a.z - c.z);
      const area = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
      if (area > 1e-6) minimumRadius = Math.min(minimumRadius, ab * bc * ac / (4 * area));
    }
    expect(maximumReversal * 180 / Math.PI).toBeGreaterThan(150);
    expect(minimumRadius).toBeGreaterThanOrEqual(region.targetBendRadius);
    for (const distance of [region.startDistance, region.endDistance]) {
      const progress = macro.progressAtDistance(distance), expected = macro.samplePosition(progress);
      const actual = final.nearestPointToRiver(expected.x, expected.z);
      expect(actual.distanceToRiver).toBeLessThan(.35);
      expect(Math.abs(actual.tangent.z)).toBeGreaterThan(.8);
    }
  });
});
