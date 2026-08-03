import { describe, expect, it } from "vitest";
import { CHUNK_SIZE, worldToChunk } from "./chunkCoordinates";
import { WORLD_RIVER_CARVING } from "./worldRiverCarving";
import { worldRiverSpine } from "./worldRiverSpine";
import {
  sampleWorldRiverWater, tessellateWorldRiverWater, tessellateWorldRiverWaterChunk,
  WORLD_RIVER_WATER_SAMPLE_SPACING,
} from "./worldRiverWater";

describe("world river water field", () => {
  for (const progress of [0.1, 0.35, 0.52, 0.8]) {
    it(`uses the symmetric authoritative footprint at ${progress}`, () => {
      const frame = worldRiverSpine.sampleFrame(progress), half = WORLD_RIVER_CARVING.halfWidth;
      const at = (offset: number) => sampleWorldRiverWater(frame.position.x + frame.normal.x * offset, frame.position.z + frame.normal.z * offset);
      expect(at(0).inside).toBe(true);
      expect(at(half - 0.05).inside).toBe(true);
      expect(at(-half + 0.05).inside).toBe(true);
      expect(at(half + 0.05).inside).toBe(false);
      expect(at(-half - 0.05).inside).toBe(false);
      expect(at(half + 0.25).signedDistanceToEdge).toBeCloseTo(0.25, 2);
      expect(at(0).surfaceElevation).toBe(WORLD_RIVER_CARVING.surfaceElevation);
      expect(at(0).halfWidth * 2).toBe(4);
      expect(at(0)).toEqual(at(0));
    });
  }
});

describe("stable pure water tessellation", () => {
  it("uses an ordered global distance lattice, stable frames, elevation and winding", () => {
    const geometry = tessellateWorldRiverWater();
    expect(geometry).toEqual(tessellateWorldRiverWater());
    expect(geometry.sampleDistances[0]).toBe(0);
    geometry.sampleDistances.slice(1).forEach((distance, index) => {
      expect(distance).toBeGreaterThan(geometry.sampleDistances[index]!);
      expect(distance - geometry.sampleDistances[index]!).toBeLessThanOrEqual(WORLD_RIVER_WATER_SAMPLE_SPACING);
    });
    geometry.vertices.forEach(vertex => expect(vertex.y).toBe(WORLD_RIVER_CARVING.surfaceElevation));
    for (let index = 0; index < geometry.indices.length; index += 3) {
      const a = geometry.vertices[geometry.indices[index]!]!, b = geometry.vertices[geometry.indices[index + 1]!]!, c = geometry.vertices[geometry.indices[index + 2]!]!;
      const normalY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      expect(normalY).toBeGreaterThan(1e-8);
    }
    for (let index = 0; index + 3 < geometry.vertices.length; index += 6) {
      const left = geometry.vertices[index]!, right = geometry.vertices[index + 2]!;
      expect(Math.hypot(left.x - right.x, left.z - right.z)).toBeCloseTo(4, 6);
    }
  });

  it("clips neighboring chunks to identical boundaries without order dependence", () => {
    const point = worldRiverSpine.samplePosition(0.5), owner = worldToChunk(point.x, point.z);
    const coordinates = [owner, { x: owner.x + 1, z: owner.z }, { x: owner.x, z: owner.z + 1 }];
    const forward = coordinates.map(coordinate => tessellateWorldRiverWaterChunk(coordinate));
    const reverse = [...coordinates].reverse().map(coordinate => tessellateWorldRiverWaterChunk(coordinate)).reverse();
    expect(forward).toEqual(reverse);
    forward.forEach((fragment, i) => fragment.vertices.forEach(vertex => {
      const coordinate = coordinates[i]!;
      expect(vertex.x).toBeGreaterThanOrEqual(coordinate.x * CHUNK_SIZE - 1e-9);
      expect(vertex.x).toBeLessThanOrEqual((coordinate.x + 1) * CHUNK_SIZE + 1e-9);
      expect(vertex.z).toBeGreaterThanOrEqual(coordinate.z * CHUNK_SIZE - 1e-9);
      expect(vertex.z).toBeLessThanOrEqual((coordinate.z + 1) * CHUNK_SIZE + 1e-9);
    }));
    expect(tessellateWorldRiverWaterChunk({ x: 100, z: 100 }).vertices).toHaveLength(0);
  });
});
