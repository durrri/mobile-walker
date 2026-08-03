import { describe, expect, it } from "vitest";

import { CHUNK_SIZE } from "./chunkCoordinates";
import { generateChunk } from "./generateChunk";
import {
  isRiverAt,
  isLakeAt,
  mountainSnowCoverage,
  MOUNTAIN_SNOW_LINE,
  RIVER_BED_DEPTH,
  TERRAIN_SEGMENTS,
  sampleChannelTerrainLatticeHeight,
  sampleRiverCrossSection,
  sampleTerrain,
  sampleTerrainHeight,
} from "./terrainSampling";

describe("terrain sampling", () => {
  it("returns the exact generated lattice heights on both sides of a negative chunk boundary", () => {
    const seed = "boundary";
    const left = generateChunk(seed, { x: -1, z: -2 });
    const right = generateChunk(seed, { x: 0, z: -2 });
    const side = left.terrainVerticesPerSide;

    for (let z = 0; z < side; z += 1) {
      const worldZ = -2 * CHUNK_SIZE + z * CHUNK_SIZE / (side - 1);
      const sampled = sampleTerrainHeight(seed, 0, worldZ);
      expect(sampled).toBe(left.terrainHeights[z * side + side - 1]);
      expect(sampled).toBe(right.terrainHeights[z * side]);
    }
  });

  it("matches every generated vertex with the random-access height sampler", () => {
    const seed = "vertex-agreement";
    const coordinate = { x: -3, z: 2 };
    const chunk = generateChunk(seed, coordinate);
    const side = chunk.terrainVerticesPerSide;

    for (let z = 0; z < side; z += 1) for (let x = 0; x < side; x += 1) {
      const worldX = (coordinate.x + x / (side - 1)) * CHUNK_SIZE;
      const worldZ = (coordinate.z + z / (side - 1)) * CHUNK_SIZE;
      expect(chunk.terrainHeights[z * side + x])
        .toBe(sampleTerrainHeight(seed, worldX, worldZ));
    }
  });

  it.each([-CHUNK_SIZE, 0, CHUNK_SIZE])("is continuous around the x=%s chunk boundary", (boundaryX) => {
    const epsilon = 1e-7;
    const z = -5.375;
    expect(sampleTerrainHeight(73, boundaryX - epsilon, z))
      .toBeCloseTo(sampleTerrainHeight(73, boundaryX + epsilon, z), 6);
  });

  it("keeps river collision classification stable across a north-south boundary", () => {
    const seed = "river-boundary";
    const north = generateChunk(seed, { x: 0, z: -1 });
    const riverX = north.river!.exit.x;
    const epsilon = 1e-7;

    expect(isRiverAt(seed, riverX, -epsilon)).toBe(true);
    expect(isRiverAt(seed, riverX, epsilon)).toBe(true);
    expect(sampleTerrain(seed, riverX, -epsilon).surface)
      .toBe(sampleTerrain(seed, riverX, epsilon).surface);
  });

  it("retains the legacy water depth constant while world carving is authoritative", () => {
    expect(RIVER_BED_DEPTH).toBeGreaterThanOrEqual(1.5 * 0.2);
    expect(RIVER_BED_DEPTH).toBeLessThanOrEqual(1.5 * 0.4);
  });

  it("keeps legacy collision in column zero while world terrain can carve elsewhere", () => {
    const seed = "column-zero-only";
    for (const worldX of [-CHUNK_SIZE / 2, CHUNK_SIZE * 1.5]) {
      expect(isRiverAt(seed, worldX, 3)).toBe(false);
      expect(sampleTerrain(seed, worldX, 3).surface).not.toBe("river");
    }
    for (const latticeX of [-4, 20]) {
      const worldX = latticeX * CHUNK_SIZE / TERRAIN_SEGMENTS;
      const worldZ = 2 * CHUNK_SIZE / TERRAIN_SEGMENTS;
      if (!isLakeAt(41, worldX, worldZ)) {
        expect(Number.isFinite(sampleChannelTerrainLatticeHeight(41, latticeX, 2))).toBe(true);
      }
    }
  });

  it("uses the shared cross-section for collision at the rendered water edges", () => {
    const seed = "cross-section-agreement";
    const section = sampleRiverCrossSection(seed, 6.5, CHUNK_SIZE / 2)!;
    const halfWidth = section.waterWidth / 2;

    expect(isRiverAt(seed, section.centerX - halfWidth, CHUNK_SIZE / 2)).toBe(true);
    expect(isRiverAt(seed, section.centerX + halfWidth, CHUNK_SIZE / 2)).toBe(true);
    expect(isRiverAt(seed, section.centerX - halfWidth - 1e-6, CHUNK_SIZE / 2)).toBe(false);
    expect(isRiverAt(seed, section.centerX + halfWidth + 1e-6, CHUNK_SIZE / 2)).toBe(false);
  });

  it("does not invent a collision jump at negative east-west boundaries", () => {
    const seed = "river-boundary";
    const epsilon = 1e-7;
    for (const boundaryX of [-CHUNK_SIZE, 0]) {
      expect(isRiverAt(seed, boundaryX - epsilon, -3.25)).toBe(false);
      expect(isRiverAt(seed, boundaryX + epsilon, -3.25)).toBe(false);
    }
  });

  it("raises broad mountain terrain into tall, cohesive snow-level summits", () => {
    const seed = "snow-capped-mountains";
    const mountainHeights: number[] = [];
    for (let z = -160; z <= 160; z += 8) for (let x = -160; x <= 160; x += 8) {
      const sample = sampleTerrain(seed, x, z);
      if (sample.biome === "mountain") mountainHeights.push(sample.height);
    }

    expect(mountainHeights.length).toBeGreaterThan(0);
    expect(Math.max(...mountainHeights)).toBeGreaterThan(MOUNTAIN_SNOW_LINE);
    expect(mountainHeights.filter((height) => height >= MOUNTAIN_SNOW_LINE).length)
      .toBeLessThan(mountainHeights.length / 4);
    expect(Math.max(...mountainHeights) - Math.min(...mountainHeights)).toBeLessThan(9);
  });

  it("limits summit snow to the mountain biome", () => {
    const weights = (dominant: "highlands" | "mountain") => ({
      plains: 0,
      forest: 0,
      wetland: 0,
      lake: 0,
      highlands: dominant === "highlands" ? 1 : 0,
      mountain: dominant === "mountain" ? 1 : 0,
    });

    expect(mountainSnowCoverage(MOUNTAIN_SNOW_LINE + 10, weights("highlands"))).toBe(0);
    expect(mountainSnowCoverage(MOUNTAIN_SNOW_LINE - 1, weights("mountain"))).toBe(0);
    expect(mountainSnowCoverage(MOUNTAIN_SNOW_LINE, weights("mountain"))).toBe(1);
  });
});
