import { describe, expect, it } from "vitest";

import { generateChunk } from "./generateChunk";
import { CHUNK_SIZE, worldToChunk } from "./chunkCoordinates";
import {
  sampleChannelTerrainHeight,
  sampleTerrainHeight,
  sampleNaturalTerrainHeight,
  TERRAIN_SEGMENTS,
} from "./terrainSampling";
import { createWorldRiverCarvingContext, sampleWorldRiverCarving } from "./worldRiverCarving";
import { getWorldRiverOwner } from "./worldRiverOwner";
import { normalizeSeed } from "./random";
import { dryChunkOutsideRiverInfluence, riverChunkAtProgress, riverReachOutsideLegacyColumn } from "./riverProceduralFixtures";

describe("deterministic chunk generation", () => {
  it("repeats exactly for the same seed and coordinate", () => {
    expect(generateChunk("alpine", { x: 4, z: -2 })).toEqual(generateChunk("alpine", { x: 4, z: -2 }));
  });

  it("changes with the seed", () => {
    const alpineCoordinate=dryChunkOutsideRiverInfluence("alpine"),coastalCoordinate=dryChunkOutsideRiverInfluence("coastal");
    expect(getWorldRiverOwner("alpine").spine.queryRiverSegments({minX:alpineCoordinate.x*CHUNK_SIZE,maxX:(alpineCoordinate.x+1)*CHUNK_SIZE,minZ:alpineCoordinate.z*CHUNK_SIZE,maxZ:(alpineCoordinate.z+1)*CHUNK_SIZE},16)).toEqual([]);
    expect(getWorldRiverOwner("coastal").spine.queryRiverSegments({minX:coastalCoordinate.x*CHUNK_SIZE,maxX:(coastalCoordinate.x+1)*CHUNK_SIZE,minZ:coastalCoordinate.z*CHUNK_SIZE,maxZ:(coastalCoordinate.z+1)*CHUNK_SIZE},16)).toEqual([]);
    expect(generateChunk("alpine", alpineCoordinate)).not.toEqual(generateChunk("coastal", coastalCoordinate));
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
    const seed=42,owner=getWorldRiverOwner(seed),context=createWorldRiverCarvingContext(owner.spine.bounds,owner.spine,owner.widthProfile);
    const point=Array.from({length:399},(_,index)=>riverReachOutsideLegacyColumn(seed).progress+(index-199)*.0001)
      .filter(progress=>progress>0&&progress<1).map(progress=>owner.spine.samplePosition(progress))
      .find(candidate=>{const carving=sampleWorldRiverCarving(candidate.x,candidate.z,context);return carving?.insideChannel
        &&sampleNaturalTerrainHeight(normalizeSeed(seed),candidate.x,candidate.z)>carving.targetBedHeight;});
    expect(point,"fixture must find an actually lowered off-column channel point for the same seed-owned river").toBeDefined();
    if(!point)throw new Error("missing lowered off-column point");
    expect(worldToChunk(point.x, point.z).x).not.toBe(0);
    const sample = sampleWorldRiverCarving(point.x, point.z,context)!;
    expect(sample.insideChannel).toBe(true);
    const natural = sampleNaturalTerrainHeight(normalizeSeed(seed), point.x, point.z);
    expect(sampleChannelTerrainHeight(normalizeSeed(seed), point.x, point.z)).toBeLessThan(natural);
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
});
