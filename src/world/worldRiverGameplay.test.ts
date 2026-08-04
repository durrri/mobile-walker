import { describe, expect, it } from "vitest";
import { CHUNK_SIZE } from "./chunkCoordinates";
import { WORLD_RIVER_CARVING, WORLD_RIVER_LIP_CREST_DISTANCE, WORLD_RIVER_MAX_CARVING_RADIUS } from "./worldRiverCarving";
import { createWorldRiverGameplayContext, isInsideWorldRiverWater, sampleWorldRiverGameplay } from "./worldRiverGameplay";
import { getWorldRiverOwner } from "./worldRiverOwner";
import { sampleTerrainHeight } from "./terrainSampling";

describe("world river gameplay classification", () => {
  const seed = "r5d-gameplay";
  const worldRiverSpine = getWorldRiverOwner(seed).spine;
  const contextAt = (x:number,z:number) => createWorldRiverGameplayContext({minX:x-16,maxX:x+16,minZ:z-16,maxZ:z+16},worldRiverSpine);
  const point = (progress: number, offset: number) => {
    const frame = worldRiverSpine.sampleFrame(progress);
    return { x: frame.position.x + frame.normal.x * offset, z: frame.position.z + frame.normal.z * offset };
  };

  it.each([0.08, 0.35, 0.62, 0.88])("classifies water and bank landmarks on representative reach %s", progress => {
    const centre = point(progress, 0);
    const inside = point(progress, WORLD_RIVER_CARVING.waterHalfWidth - 0.01);
    const outside = point(progress, WORLD_RIVER_CARVING.waterHalfWidth + 0.01);
    const bank = point(progress, WORLD_RIVER_LIP_CREST_DISTANCE + 0.05);
    const falloff = point(progress, WORLD_RIVER_CARVING.waterHalfWidth + WORLD_RIVER_CARVING.bankWidth + 0.05);
    expect(sampleWorldRiverGameplay(seed, centre.x, centre.z).insideWater).toBe(true);
    expect(isInsideWorldRiverWater(inside.x, inside.z, contextAt(inside.x,inside.z))).toBe(true);
    expect(isInsideWorldRiverWater(outside.x, outside.z, contextAt(outside.x,outside.z))).toBe(false);
    expect(sampleWorldRiverGameplay(seed, bank.x, bank.z)).toMatchObject({ zone: "walkableBank", insideWalkableBank: true, insideWater: false });
    expect(sampleWorldRiverGameplay(seed, falloff.x, falloff.z)).toMatchObject({ zone: "outerFalloff", insideWater: false });
  });

  it("works beyond legacy column zero and does not flood an unrelated old-column point", () => {
    const reach = point(0.62, 0);
    expect(Math.floor(reach.x / CHUNK_SIZE)).not.toBe(0);
    expect(isInsideWorldRiverWater(reach.x, reach.z, contextAt(reach.x,reach.z))).toBe(true);
    expect(isInsideWorldRiverWater(CHUNK_SIZE / 2, 150, contextAt(CHUNK_SIZE/2,150))).toBe(false);
  });

  it("gives identical direct and reusable bounded queries at a strong bend", () => {
    const p = point(0.48, WORLD_RIVER_CARVING.waterHalfWidth - 0.1);
    const context = createWorldRiverGameplayContext({
      minX: p.x - WORLD_RIVER_MAX_CARVING_RADIUS, maxX: p.x + WORLD_RIVER_MAX_CARVING_RADIUS,
      minZ: p.z - WORLD_RIVER_MAX_CARVING_RADIUS, maxZ: p.z + WORLD_RIVER_MAX_CARVING_RADIUS,
    }, worldRiverSpine);
    expect(sampleWorldRiverGameplay(seed, p.x, p.z, context)).toEqual(sampleWorldRiverGameplay(seed, p.x, p.z));
  });

  it("keeps terrain as the grounding surface instead of snapping to water", () => {
    const p = point(0.35, 0), sample = sampleWorldRiverGameplay(seed, p.x, p.z);
    expect(sample.insideWater).toBe(true);
    expect(sample.terrainElevation).toBe(sampleTerrainHeight(seed, p.x, p.z));
    expect(sample.terrainElevation).toBeLessThan(sample.waterSurfaceElevation);
    expect(sample.waterDepth).toBeCloseTo(sample.waterSurfaceElevation - sample.terrainElevation);
  });
});
