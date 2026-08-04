import { describe, expect, it } from "vitest";
import { CHUNK_SIZE } from "./chunkCoordinates";
import { RIVER_R6_FIXTURES } from "./riverR6Fixtures";
import { sampleChannelTerrainHeightInContext } from "./terrainSampling";
import { createWorldRiverCarvingContext, WORLD_RIVER_CARVING } from "./worldRiverCarving";
import { createWorldRiverEnvironmentContext, sampleWorldRiverEnvironment } from "./worldRiverEnvironment";
import { createWorldRiverGameplayContext, sampleWorldRiverGameplay } from "./worldRiverGameplay";
import { worldRiverSpine } from "./worldRiverSpine";
import { sampleWorldRiverWater } from "./worldRiverWater";
import { normalizeSeed } from "./random";

describe("R6 permanent authored fixtures", () => {
  it("covers the accepted authored-river baseline without duplicate fixture names", () => {
    expect(new Set(RIVER_R6_FIXTURES.map(f => f.name)).size).toBe(RIVER_R6_FIXTURES.length);
    expect(RIVER_R6_FIXTURES.map(f => f.name)).toEqual([
      "north-south", "diagonal", "near-horizontal", "strongest-bend", "canyon",
      "bridge", "poi-adjacent", "dry-far", "old-column-zero-dry", "outside-column-zero",
    ]);
    expect(RIVER_R6_FIXTURES.find(f => f.name === "old-column-zero-dry")!.chunk.x).toBe(0);
    expect(RIVER_R6_FIXTURES.find(f => f.name === "outside-column-zero")!.chunk.x).not.toBe(0);
  });

  it.each(RIVER_R6_FIXTURES.filter(f => f.kind === "reach"))("keeps $name water, environment, gameplay and terrain authoritative", fixture => {
    const { x, z } = fixture.position;
    const bounds={minX:x-8,maxX:x+8,minZ:z-8,maxZ:z+8};
    const carving=createWorldRiverCarvingContext(bounds,worldRiverSpine);
    const water = sampleWorldRiverWater(x, z,worldRiverSpine);
    const environment = sampleWorldRiverEnvironment(x, z,createWorldRiverEnvironmentContext(bounds,worldRiverSpine));
    const gameplay = sampleWorldRiverGameplay("r6", x, z,createWorldRiverGameplayContext(bounds,worldRiverSpine));
    expect(water.halfWidth).toBe(WORLD_RIVER_CARVING.waterHalfWidth);
    expect(water.inside).toBe(true);
    expect(environment.withinWater).toBe(true);
    expect(gameplay.insideWater).toBe(true);
    expect(gameplay.terrainElevation).toBe(sampleChannelTerrainHeightInContext(normalizeSeed("r6"), x, z,carving));
    expect(gameplay.waterSurfaceElevation).toBe(WORLD_RIVER_CARVING.surfaceElevation);
  });

  it.each(RIVER_R6_FIXTURES.filter(f => f.kind === "reach" && f.name !== "strongest-bend" && f.name !== "outside-column-zero"))("classifies strict water edges from the shared width at $name", fixture => {
      // Start with the same refined nearest frame used by production consumers;
      // control-point progress is approximate arc length by contract.
      const frame = worldRiverSpine.nearestPointToRiver(fixture.position.x, fixture.position.z);
      const sample = (offset: number) => ({ x: frame.position.x + frame.normal.x * offset, z: frame.position.z + frame.normal.z * offset });
      // Keep the probe clear of nearest-point numerical refinement error while
      // remaining immediately adjacent at world/gameplay scale.
      const inside = sample(WORLD_RIVER_CARVING.waterHalfWidth - .25);
      const outside = sample(WORLD_RIVER_CARVING.waterHalfWidth + .01);
      const bounds={minX:inside.x-8,maxX:inside.x+8,minZ:inside.z-8,maxZ:inside.z+8},context=createWorldRiverGameplayContext(bounds,worldRiverSpine);
      expect(sampleWorldRiverWater(inside.x, inside.z,worldRiverSpine).inside).toBe(true);
      expect(sampleWorldRiverGameplay(7, inside.x, inside.z,context).insideWater).toBe(true);
      expect(sampleWorldRiverWater(outside.x, outside.z,worldRiverSpine).inside).toBe(false);
      expect(sampleWorldRiverGameplay(7, outside.x, outside.z,context).insideWater).toBe(false);
  });

  it("keeps dry fixtures outside the controlled environment", () => {
    for (const fixture of RIVER_R6_FIXTURES.filter(f => f.kind !== "reach")) {
      expect(worldRiverSpine.nearestPointToRiver(fixture.position.x, fixture.position.z).distanceToRiver)
        .toBeGreaterThan(CHUNK_SIZE);
      expect(sampleWorldRiverEnvironment(fixture.position.x, fixture.position.z).zone).toBe("outsideRiverInfluence");
    }
  });
});
