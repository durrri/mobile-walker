import { describe, expect, it } from "vitest";
import { ChunkMeshFactory } from "./chunkMeshes";
import { generateChunk, type ChunkGenerationStageTimings, type GeneratedChunkData } from "./generateChunk";
import { RIVER_R6_FIXTURES } from "./riverR6Fixtures";
import { findSafeRestoredTransformFromCanonicalWorld } from "./safePlayerPosition";
import { resetWorldGenerationCachesForDiagnostics } from "./worldGenerationDiagnostics";
import { sampleWorldRiverGameplay } from "./worldRiverGameplay";

const SAMPLE_COUNT = 10;
const rounded = (value: number) => +value.toFixed(3);
const summarize = (samples: readonly number[], includeSamples = true) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (fraction: number) => sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]!;
  return { ...(includeSamples ? { samplesMs: samples.map(rounded) } : {}), medianMs: rounded((sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.ceil((sorted.length - 1) / 2)]!) / 2), p95Ms: rounded(rank(.95)) };
};
const sampleOperation = (runs: number, operation: () => unknown): number[] => Array.from({ length: runs }, () => {
  const start = performance.now(); operation(); return performance.now() - start;
});
const stageSummary = (samples: readonly ChunkGenerationStageTimings[]) => Object.fromEntries(
  (["terrainFieldMs", "poiAndBridgeMs", "terrainTriangulationMs", "objectPlacementMs", "totalMs"] as const)
    .map(stage => [stage, summarize(samples.map(sample => sample[stage]))]),
);

describe("R6 reproducible performance diagnostic", () => {
  it("reports cache-cleared cold, cached lookup, stage, mesh, and Node heap diagnostics", () => {
    const heapStartMb = process.memoryUsage().heapUsed / 1_048_576;
    const named = ["dry-far", "diagonal", "canyon", "bridge", "poi-adjacent"];
    const chunks = Object.fromEntries(named.map(name => {
      const fixture = RIVER_R6_FIXTURES.find(candidate => candidate.name === name)!;
      // Untimed warm-up isolates module/JIT startup; it is discarded before all cold samples.
      generateChunk("r6-baseline", fixture.chunk);
      const coldSamples: number[] = [], stages: ChunkGenerationStageTimings[] = [];
      let data!: GeneratedChunkData;
      for (let run = 0; run < SAMPLE_COUNT; run += 1) {
        resetWorldGenerationCachesForDiagnostics();
        const start = performance.now();
        data = generateChunk("r6-baseline", fixture.chunk, undefined, false, { record: timing => stages.push({ ...timing }) });
        coldSamples.push(performance.now() - start);
      }
      // This models the runtime data-cache hit accurately: streaming returns the
      // retained plain object and does not invoke generateChunk on a cache hit.
      const runtimeDataCache = new Map([[data.id, data]]);
      const cachedLookup = sampleOperation(SAMPLE_COUNT, () => runtimeDataCache.get(data.id));
      const meshCreation = sampleOperation(SAMPLE_COUNT, () => {
        const factory = new ChunkMeshFactory(); const group = factory.create(data); factory.disposeChunk(group); factory.dispose();
      });
      const stagesByName = stageSummary(stages);
      const synchronousStages = Object.entries(stagesByName).filter(([stage]) => stage !== "totalMs");
      const largestStage = synchronousStages.sort((a, b) => b[1].medianMs - a[1].medianMs)[0]!;
      return [name, { coldGeneration: summarize(coldSamples), cachedDataLookup: summarize(cachedLookup),
        stages: stagesByName, largestSynchronousStage: { name: largestStage[0], medianMs: largestStage[1].medianMs },
        meshCreation: summarize(meshCreation), vertices: data.terrainMesh.positions.length / 3,
        triangles: data.terrainMesh.indices.length / 3, objects: data.pines.length + data.collectibles.length
          + data.vegetation.leafTrees.length + data.vegetation.bushes.length + data.vegetation.flowers.length,
        bridges: data.bridges.length, pois: data.pois.length }];
    }));
    const hotPoint = RIVER_R6_FIXTURES.find(f => f.name === "strongest-bend")!.position;
    const gameplay = summarize(sampleOperation(2_000, () => sampleWorldRiverGameplay("r6-baseline", hotPoint.x, hotPoint.z)), false);
    const safePosition = summarize(sampleOperation(30, () => findSafeRestoredTransformFromCanonicalWorld(
      "r6-baseline", { ...hotPoint, y: 0, yaw: 0 }, .76, .3,
    )), false);
    const heapEndMb = process.memoryUsage().heapUsed / 1_048_576;
    const nodeProcessHeap = { startMb: rounded(heapStartMb), endMb: rounded(heapEndMb), deltaMb: rounded(heapEndMb - heapStartMb) };
    console.info("R6_BASELINE", JSON.stringify({ sampleCount: SAMPLE_COUNT, percentileMethod: "nearest-rank ceil(p*n), median=mean of ranks 5 and 6", chunks, gameplay, safePosition, nodeProcessHeap }));
    expect(Object.values(chunks).every(result => result.triangles > 0 && result.coldGeneration.samplesMs?.length === SAMPLE_COUNT)).toBe(true);
  }, 180_000);
});
