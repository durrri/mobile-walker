import { describe, expect, it } from "vitest";
import { bridgeFixture, poiAdjacentRiverFixture, riverChunkAtProgress, riverPointAtProgress } from "./riverProceduralFixtures";
import { generateBridges } from "./bridges";
import { generateChunk } from "./generateChunk";
import { generatePois } from "./poi";
import { createWorldRiverGameplayContext, sampleWorldRiverGameplay } from "./worldRiverGameplay";
import { tessellateWorldRiverWaterChunk } from "./worldRiverWater";
import { getWorldRiverOwner } from "./worldRiverOwner";

describe("production procedural river consumer integration", () => {
  it("feeds water, refined terrain, bridges, POIs, objects, and gameplay from the active spine", () => {
    const seed = 7, riverChunk = riverChunkAtProgress(.5, seed), data = generateChunk(seed, riverChunk);
    expect(data.irregularTerrain, `missing refined terrain in ${JSON.stringify(riverChunk)}`).toBeDefined();
    const owner = getWorldRiverOwner(seed);
    expect(data.riverGenerationIdentity).toBe(owner.identity);
    expect(tessellateWorldRiverWaterChunk(riverChunk, owner.spine,owner.widthProfile).vertices.length).toBeGreaterThan(0);
    expect(data.pines.length + data.vegetation.leafTrees.length + data.vegetation.bushes.length + data.collectibles.length).toBeGreaterThan(0);

    const bridgeLocation = bridgeFixture(seed, true), bridgeData = generateBridges(seed, bridgeLocation.chunk);
    expect(bridgeData.candidates.length).toBeGreaterThan(0);
    expect(bridgeData.bridges.length).toBeGreaterThan(0);

    const poiSeed = 2, poiLocation = poiAdjacentRiverFixture(poiSeed);
    expect(poiLocation.riverDistance).toBeLessThan(3 * 16);
    expect(generatePois(poiSeed, poiLocation.chunk).pois.some(poi => poi.id === poiLocation.poi.id)).toBe(true);

    const point = riverPointAtProgress(.5, seed), bounds = { minX: point.x - 8, maxX: point.x + 8, minZ: point.z - 8, maxZ: point.z + 8 };
    const gameplay = sampleWorldRiverGameplay(seed, point.x, point.z, createWorldRiverGameplayContext(bounds, owner.spine,owner.widthProfile));
    expect(gameplay.insideWater).toBe(true);
  });
});
