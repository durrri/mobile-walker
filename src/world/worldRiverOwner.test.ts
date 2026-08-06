import { describe, expect, it } from "vitest";
import { generateChunk } from "./generateChunk";
import { getWorldRiverOwner, resetWorldRiverOwners, riverConfigForWorldSeed } from "./worldRiverOwner";
import { getWorldRiverGeneration, resetWorldRiverGenerationCaches } from "./worldRiverGeneration";

const bytes = (value: unknown) => JSON.stringify(value);

describe("world/session river ownership", () => {
  it("retains one immutable result for the actual game seed", () => {
    const first = getWorldRiverOwner("session-a"), second = getWorldRiverOwner("session-a");
    expect(second).toBe(first);
    expect(first.spine).toBe(first.generation.meanderedSpine);
    expect(first.macroSpine).toBe(first.generation.macroSpine);
  });

  it("isolates two sessions and regenerates byte-equivalently after reset", () => {
    const a = getWorldRiverOwner("session-a"), b = getWorldRiverOwner("session-b");
    expect(a.identity).not.toBe(b.identity);
    expect(bytes(a.generation.macroResampledPoints)).not.toBe(bytes(b.generation.macroResampledPoints));
    const snapshots = [bytes(a.generation.macroResampledPoints), bytes(a.generation.meanderedResampledPoints)];
    resetWorldRiverOwners(); resetWorldRiverGenerationCaches();
    const regenerated = getWorldRiverOwner("session-a");
    expect([bytes(regenerated.generation.macroResampledPoints), bytes(regenerated.generation.meanderedResampledPoints)]).toEqual(snapshots);
  });

  it("stamps generated chunks with the matching seed-owned river identity", () => {
    for (const seed of [11, 29]) expect(generateChunk(seed, { x: 20, z: 20 }).riverGenerationIdentity)
      .toBe(getWorldRiverOwner(seed).identity);
  });

  it("keeps authored R6 isolated from procedural session products", () => {
    const authored = getWorldRiverGeneration(riverConfigForWorldSeed(1, "authored-r6"));
    const procedural = getWorldRiverOwner(1).generation;
    expect(authored.cacheKey).not.toBe(procedural.cacheKey);
    expect(authored.macroSpine).not.toBe(procedural.macroSpine);
    expect(getWorldRiverGeneration(riverConfigForWorldSeed(1, "authored-r6"))).toBe(authored);
  });

  it("enforces finite bounds and reports real guard fallback/correction", () => {
    for (const seed of [1]) {
      const result = getWorldRiverOwner(seed).generation;
      expect(result.meanderedSpine.bounds.minX).toBeGreaterThanOrEqual(result.config.bounds.minX);
      expect(result.meanderedSpine.bounds.maxX).toBeLessThanOrEqual(result.config.bounds.maxX);
      expect(result.measuredMinimumBendRadius).toBeGreaterThanOrEqual(1 / result.config.curvatureGuard - .05);
    }
    const strict = getWorldRiverGeneration({ ...riverConfigForWorldSeed(99), macroCurvatureLimit: 1e-9 });
    expect(strict.usedFallback).toBe(true);
    expect(strict.correctionReasons).toContain("macro-curvature");
    const strictFinal = getWorldRiverGeneration({ ...riverConfigForWorldSeed(99), curvatureGuard: .001 });
    expect(strictFinal.correctionReasons).toContain("final-curvature");
    expect(strictFinal.usedFallback).toBe(true);
    expect(strictFinal.correctionReasons).toContain("fallback-straight");
    for (let index = 0; index <= 100; index += 1) {
      const frame = strictFinal.meanderedSpine.sampleFrame(index / 100);
      expect([...Object.values(frame.position), ...Object.values(frame.tangent), ...Object.values(frame.normal)]
        .every(Number.isFinite)).toBe(true);
      expect(Math.hypot(frame.tangent.x, frame.tangent.z)).toBeGreaterThan(0);
    }
  });
});
