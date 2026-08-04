import { describe, expect, it } from "vitest";
import { generateChunk } from "./generateChunk";
import { RIVER_R6_FIXTURES } from "./riverR6Fixtures";
import { findSafeRestoredTransformFromCanonicalWorld } from "./safePlayerPosition";
import { sampleWorldRiverGameplay } from "./worldRiverGameplay";

const percentile = (values: readonly number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.ceil((values.length - 1) * fraction)]!;
const measure = (runs: number, operation: () => unknown) => {
  const samples: number[] = [];
  for (let run = 0; run < runs; run += 1) { const start = performance.now(); operation(); samples.push(performance.now() - start); }
  return { medianMs: +percentile(samples, .5).toFixed(3), p95Ms: +percentile(samples, .95).toFixed(3) };
};

describe("R6 reproducible performance diagnostic", () => {
  it("reports the pre-procedural authored-river baseline", () => {
    const named = ["dry-far", "diagonal", "canyon", "bridge", "poi-adjacent"];
    const chunks = Object.fromEntries(named.map(name => {
      const fixture = RIVER_R6_FIXTURES.find(candidate => candidate.name === name)!;
      const timing = measure(3, () => generateChunk("r6-baseline", fixture.chunk));
      const data = generateChunk("r6-baseline", fixture.chunk);
      return [name, { ...timing, vertices: data.terrainMesh.positions.length / 3,
        triangles: data.terrainMesh.indices.length / 3, objects: data.pines.length + data.collectibles.length
          + data.vegetation.leafTrees.length + data.vegetation.bushes.length + data.vegetation.flowers.length,
        bridges: data.bridges.length, pois: data.pois.length }];
    }));
    const hotPoint = RIVER_R6_FIXTURES.find(f => f.name === "strongest-bend")!.position;
    const gameplay = measure(2_000, () => sampleWorldRiverGameplay("r6-baseline", hotPoint.x, hotPoint.z));
    const safePosition = measure(30, () => findSafeRestoredTransformFromCanonicalWorld(
      "r6-baseline", { ...hotPoint, y: 0, yaw: 0 }, .76, .3,
    ));
    const memoryMb = typeof process.memoryUsage === "function" ? +(process.memoryUsage().heapUsed / 1_048_576).toFixed(1) : undefined;
    console.info("R6_BASELINE", JSON.stringify({ chunks, gameplay, safePosition, heapUsedMb: memoryMb }));
    expect(Object.values(chunks).every(result => result.triangles > 0)).toBe(true);
  }, 120_000);
});
