import { describe, expect, it } from "vitest";

import {
  generateChunk,
  WORLD_RIVER_TERRAIN_STRIP_SAMPLE_SPACING,
  worldRiverTerrainStripOffsets,
} from "./generateChunk";
import { CHUNK_SIZE, worldToChunk } from "./chunkCoordinates";
import {
  sampleChannelTerrainHeight,
  sampleTerrainHeight,
  sampleNaturalTerrainHeight,
  TERRAIN_SEGMENTS,
} from "./terrainSampling";
import {
  createWorldRiverCarvingContext,
  sampleWorldRiverCarving,
  WORLD_RIVER_CARVING,
  WORLD_RIVER_LIP_CREST_DISTANCE,
  WORLD_RIVER_MAX_CARVING_RADIUS,
} from "./worldRiverCarving";
import { getWorldRiverOwner } from "./worldRiverOwner";
import { normalizeSeed } from "./random";
import { dryChunkOutsideRiverInfluence, riverChunkAtProgress, riverReachOutsideLegacyColumn } from "./riverProceduralFixtures";

describe("deterministic chunk generation", () => {
  it("repeats exactly for the same seed and coordinate", () => {
    expect(generateChunk("alpine", { x: 4, z: -2 })).toEqual(generateChunk("alpine", { x: 4, z: -2 }));
  });

  it("changes with the seed", () => {
    expect(generateChunk("alpine", { x: 0, z: 0 })).not.toEqual(generateChunk("coastal", { x: 0, z: 0 }));
  });

  it("uses mathematical floor for negative world coordinates", () => {
    expect(worldToChunk(-0.01, -16.01)).toEqual({ x: -1, z: -2 });
    expect(generateChunk(7, { x: -3, z: -5 }).id).toBe("-3,-5");
  });

  it("does not depend on generation order", () => {
    const coordinates = [{ x: 2, z: 1 }, { x: -1, z: 8 }, { x: 0, z: 0 }] as const;
    const forward = new Map(coordinates.map((coordinate) => [JSON.stringify(coordinate), generateChunk(42, coordinate)]));
    const reverse = new Map([...coordinates].reverse().map((coordinate) => [JSON.stringify(coordinate), generateChunk(42, coordinate)]));
    expect(forward).toEqual(reverse);
  });



  it("shares exact terrain vertices on every edge of adjacent chunks", () => {
    const seed = "four-way-continuity";
    const center = generateChunk(seed, { x: -2, z: 1 });
    const east = generateChunk(seed, { x: -1, z: 1 });
    const south = generateChunk(seed, { x: -2, z: 2 });
    const side = center.terrainVerticesPerSide;

    for (let index = 0; index < side; index += 1) {
      expect(center.terrainHeights[index * side + side - 1])
        .toBe(east.terrainHeights[index * side]);
      expect(center.terrainHeights[(side - 1) * side + index])
        .toBe(south.terrainHeights[index]);
    }
  });

  it("carves the same-position natural terrain and matches the generated grid", () => {
    const seed = "channel";
    const normalizedSeed = normalizeSeed(seed);
    const coordinate = riverChunkAtProgress(.5, seed);
    const owner = getWorldRiverOwner(seed);
    const carving = createWorldRiverCarvingContext(owner.spine.bounds, owner.spine,owner.widthProfile);
    const step = CHUNK_SIZE / TERRAIN_SEGMENTS;
    const point = Array.from({ length: (TERRAIN_SEGMENTS + 1) ** 2 }, (_, index) => ({
      x: coordinate.x * CHUNK_SIZE + (index % (TERRAIN_SEGMENTS + 1)) * step,
      z: coordinate.z * CHUNK_SIZE + Math.floor(index / (TERRAIN_SEGMENTS + 1)) * step,
    })).find(candidate => sampleWorldRiverCarving(candidate.x, candidate.z, carving)?.insideChannel
      && sampleNaturalTerrainHeight(normalizedSeed, candidate.x, candidate.z)
        > sampleWorldRiverCarving(candidate.x, candidate.z, carving)!.targetBedHeight);
    expect(point, `expected carved grid point in ${JSON.stringify(coordinate)}`).toBeDefined();
    if (!point) throw new Error(`expected carved grid point in ${JSON.stringify(coordinate)}`);
    const natural = sampleNaturalTerrainHeight(normalizedSeed, point.x, point.z);
    const carved = sampleChannelTerrainHeight(normalizedSeed, point.x, point.z);
    const target = sampleWorldRiverCarving(point.x, point.z, carving)!.targetBedHeight;
    expect(natural).toBeGreaterThan(target);
    expect(carved).toBeLessThan(natural);

    const chunk = generateChunk(seed, coordinate);
    const side = chunk.terrainVerticesPerSide;
    const x = (point.x - coordinate.x * CHUNK_SIZE) / (CHUNK_SIZE / TERRAIN_SEGMENTS);
    const z = (point.z - coordinate.z * CHUNK_SIZE) / (CHUNK_SIZE / TERRAIN_SEGMENTS);
    expect(chunk.terrainHeights[z * side + x]).toBe(sampleChannelTerrainHeight(chunk.seed, point.x, point.z));
  });

  it("carves the world spine outside the old fixed river column", () => {
    const point = riverReachOutsideLegacyColumn().position;
    expect(worldToChunk(point.x, point.z).x).not.toBe(0);
    const sample = sampleWorldRiverCarving(point.x, point.z)!;
    expect(sample.insideChannel).toBe(true);
    const natural = sampleNaturalTerrainHeight(42, point.x, point.z);
    expect(sampleChannelTerrainHeight(42, point.x, point.z)).toBeLessThan(natural);
  });


  it("keeps coarse height data while refining only chunks touched by the world river", () => {
    const dryChunk = generateChunk("local-river-detail", dryChunkOutsideRiverInfluence("local-river-detail"));
    const riverChunk = generateChunk("local-river-detail", riverChunkAtProgress(.5, "local-river-detail"));

    expect(dryChunk.terrainVerticesPerSide).toBe(TERRAIN_SEGMENTS + 1);
    expect(riverChunk.terrainVerticesPerSide).toBe(TERRAIN_SEGMENTS + 1);
    expect(dryChunk.terrainHeights).toHaveLength((TERRAIN_SEGMENTS + 1) ** 2);
    expect(riverChunk.terrainHeights.length).toBeLessThanOrEqual(dryChunk.terrainHeights.length);
    expect(riverChunk.irregularTerrain).toBeDefined();
    expect(riverChunk.irregularTerrain!.vertices.length).toBeGreaterThan(riverChunk.terrainHeights.length);
  });

  it("keeps river-column edges on the neighboring coarse edge", () => {
    const riverChunk = generateChunk("local-edge-continuity", { x: 0, z: 0 });
    const eastChunk = generateChunk("local-edge-continuity", { x: 1, z: 0 });
    const riverSide = riverChunk.terrainVerticesPerSide;
    const coarseSide = eastChunk.terrainVerticesPerSide;

    for (let coarseZ = 0; coarseZ < coarseSide; coarseZ += 1) {
      expect(riverChunk.terrainHeights[coarseZ * riverSide + riverSide - 1])
        .toBe(eastChunk.terrainHeights[coarseZ * coarseSide]);
    }
  });

  it("keeps locally refined rendered vertices on the random-access movement field", () => {
    const coordinate = riverChunkAtProgress(.5, "refined-movement-agreement"), chunk = generateChunk("refined-movement-agreement", coordinate);
    expect(chunk.irregularTerrain, `expected refined river chunk ${JSON.stringify(coordinate)}`).toBeDefined();
    const owner=getWorldRiverOwner("refined-movement-agreement"),spine = owner.spine;
    const context = createWorldRiverCarvingContext(spine.bounds, spine,owner.widthProfile);
    const refined = chunk.irregularTerrain!.vertices.filter(vertex =>
      sampleWorldRiverCarving(vertex.x, vertex.z, context)?.insideCarvingFalloff);
    expect(refined.length).toBeGreaterThan(20);
    for (let index = 7; index < refined.length; index += 17) {
      const vertex = refined[index]!;
      expect(vertex.height).toBeCloseTo(sampleTerrainHeight(chunk.seed, vertex.x, vertex.z), 12);
    }
  }, 20_000);

  it("moves the full dense river-row handoff inward from L2/L3 to L1.1", () => {
    const seed = "river-bank-topology-handoff";
    const coordinate = riverChunkAtProgress(.5, seed);
    const chunk = generateChunk(seed, coordinate);
    expect(chunk.irregularTerrain, `expected refined river chunk ${JSON.stringify(coordinate)}`).toBeDefined();

    const configuredOffsets = [...worldRiverTerrainStripOffsets()].map(Math.abs);
    const l0 = WORLD_RIVER_CARVING.waterHalfWidth;
    const l1 = WORLD_RIVER_LIP_CREST_DISTANCE;
    const l2 = WORLD_RIVER_CARVING.waterHalfWidth + WORLD_RIVER_CARVING.bankWidth;
    const l11 = (l1 + l2) / 2;
    expect(configuredOffsets).toContain(0);
    expect(configuredOffsets).toContain(l0);
    expect(configuredOffsets).toContain(l1);
    expect(configuredOffsets).toContain(l11);
    expect(configuredOffsets).not.toContain(l2);
    expect(configuredOffsets).not.toContain(WORLD_RIVER_MAX_CARVING_RADIUS);
    expect(WORLD_RIVER_TERRAIN_STRIP_SAMPLE_SPACING).toBe(.5);

    const owner = getWorldRiverOwner(seed);
    const carving = createWorldRiverCarvingContext(owner.spine.bounds, owner.spine, owner.widthProfile);
    const denseVertices = chunk.irregularTerrain!.vertices.filter(vertex => vertex.riverStripOffset !== undefined);
    expect(denseVertices.length).toBeGreaterThan(20);
    const tolerance = 1e-6;
    const hasDenseLandmark = (distanceAtSample: (sample: NonNullable<ReturnType<typeof sampleWorldRiverCarving>>) => number) => denseVertices.some(vertex => {
      const sample = sampleWorldRiverCarving(vertex.x, vertex.z, carving);
      return sample && Math.abs(Math.abs(vertex.riverStripOffset!) - distanceAtSample(sample)) <= tolerance;
    });
    expect(hasDenseLandmark(sample => sample.halfWidth)).toBe(true);
    expect(hasDenseLandmark(sample => sample.halfWidth + WORLD_RIVER_CARVING.shoreTransitionWidth)).toBe(true);
    expect(hasDenseLandmark(sample => sample.halfWidth + (WORLD_RIVER_CARVING.bankWidth + WORLD_RIVER_CARVING.shoreTransitionWidth) / 2)).toBe(true);
    expect(hasDenseLandmark(sample => sample.halfWidth + sample.bankWidth)).toBe(false);
    expect(hasDenseLandmark(() => WORLD_RIVER_MAX_CARVING_RADIUS)).toBe(false);

    const coarseOuterBankVertices = chunk.irregularTerrain!.vertices.filter(vertex => {
      if (vertex.riverStripOffset !== undefined) return false;
      const sample = sampleWorldRiverCarving(vertex.x, vertex.z, carving);
      return sample && sample.distanceToCentreline >= sample.halfWidth + sample.bankWidth - 1e-8
        && sample.distanceToCentreline <= sample.halfWidth + sample.bankWidth + sample.falloffWidth + 1e-8;
    });
    expect(coarseOuterBankVertices.length).toBeGreaterThan(0);
  });

});
