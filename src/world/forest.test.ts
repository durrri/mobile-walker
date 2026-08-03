import { describe, expect, it } from "vitest";

import { CHUNK_SIZE } from "./chunkCoordinates";
import { generateTrees, sampleForestDensity, treeChance } from "./forest";
import { normalizeSeed } from "./random";
import { sampleTerrainHeight } from "./terrainSampling";
import { sampleWorldRiverEnvironment } from "./worldRiverEnvironment";

describe("forest generation", () => {
  it("is deterministic and keeps trees inside their owning chunk", () => {
    const coordinate = { x: -2, z: 3 };
    const trees = generateTrees("pine-country", coordinate);
    expect(trees).toEqual(generateTrees("pine-country", coordinate));
    for (const tree of trees) {
      expect(tree.x).toBeGreaterThanOrEqual(coordinate.x * CHUNK_SIZE);
      expect(tree.x).toBeLessThan((coordinate.x + 1) * CHUNK_SIZE);
      expect(tree.z).toBeGreaterThanOrEqual(coordinate.z * CHUNK_SIZE);
      expect(tree.z).toBeLessThan((coordinate.z + 1) * CHUNK_SIZE);
      expect(tree.y).toBe(sampleTerrainHeight("pine-country", tree.x, tree.z));
      expect(sampleWorldRiverEnvironment(tree.x, tree.z).withinWater).toBe(false);
    }
  });

  it("creates broad meadow, sparse, and dense regions", () => {
    const seed = normalizeSeed("forest-biomes");
    const densities: number[] = [];
    const counts: number[] = [];
    for (let z = -6; z <= 6; z += 1) for (let x = -6; x <= 6; x += 1) {
      densities.push(sampleForestDensity(seed, (x + 0.5) * CHUNK_SIZE, (z + 0.5) * CHUNK_SIZE));
      counts.push(generateTrees(seed, { x, z }).length);
    }

    expect(Math.min(...densities)).toBeLessThan(0.2);
    expect(Math.max(...densities)).toBeGreaterThan(0.8);
    expect(Math.min(...counts)).toBeLessThanOrEqual(2);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(25);
  });

  it("clears trees from the world-owned river", () => {
    const trees = generateTrees("river-forest", { x: 0, z: 0 });
    for (const tree of trees) expect(sampleWorldRiverEnvironment(tree.x, tree.z).withinWalkableBank).toBe(false);
  });

  it("gives meadow, forest, and highland different biome-level densities", () => {
    const oneHot = (id: "plains" | "forest" | "wetland" | "lake" | "highlands" | "mountain") => ({
      plains: 0,
      forest: 0,
      wetland: 0,
      lake: 0,
      highlands: 0,
      mountain: 0,
      [id]: 1,
    });

    const meadowChance = treeChance(0.7, oneHot("plains"));
    const forestChance = treeChance(0.7, oneHot("forest"));
    const highlandChance = treeChance(0.7, oneHot("highlands"));
    expect(meadowChance).toBeLessThan(0.05);
    expect(forestChance).toBeGreaterThan(highlandChance);
    expect(highlandChance).toBeGreaterThan(meadowChance);
  });
});
