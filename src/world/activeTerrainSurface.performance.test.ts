import { describe, it } from "vitest";
import { CHUNK_SIZE } from "./chunkCoordinates";
import { generateChunk, type ChunkGenerationDiagnostics, type ChunkGenerationStageTimings } from "./generateChunk";
import { queryChunkTerrainSurface } from "./activeTerrainSurface";
import { riverChunkAtProgress } from "./riverProceduralFixtures";

function percentile(values: number[], p: number): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!; }
function run(label: string, seed: string, coordinate: { x: number; z: number }): void {
  let timings: Readonly<ChunkGenerationStageTimings> | undefined;
  const diagnostics: ChunkGenerationDiagnostics = { record: value => { timings = value; } };
  const chunk = generateChunk(seed, coordinate, undefined, false, diagnostics);
  const indexBuildMs = timings?.terrainQueryIndexMs ?? 0;
  const originX = coordinate.x * CHUNK_SIZE, originZ = coordinate.z * CHUNK_SIZE;
  const samples = Array.from({ length: 400 }, (_, n) => ({ x: originX + ((n * 17) % 997) / 997 * CHUNK_SIZE, z: originZ + ((n * 31) % 991) / 991 * CHUNK_SIZE }));
  const queryMs: number[] = [], candidates: number[] = [];
  for (const sample of samples) { const start = performance.now(); const hit = queryChunkTerrainSurface(chunk, sample.x, sample.z); queryMs.push(performance.now() - start); if (hit) candidates.push(hit.candidateCount); }
  console.info(`[terrain-query] ${label}: median=${percentile(queryMs, .5).toFixed(4)}ms p95=${percentile(queryMs, .95).toFixed(4)}ms candidatesMedian=${percentile(candidates, .5)} candidatesP95=${percentile(candidates, .95)} realIndexBuild=${indexBuildMs.toFixed(4)}ms coldGeneration=${timings?.totalMs.toFixed(3)}ms noCachedQueryRebuild=true vertices=${chunk.terrainMesh.positions.length / 3} triangles=${chunk.terrainMesh.indices.length / 3} estimatedCpuQueryBytes=${chunk.terrainSurfaceIndex.estimatedBytes}`);
}

describe("active terrain surface benchmark", () => {
  it("reports regular, river, canyon/seam, and cached query costs", () => {
    run("regular", "terrain-benchmark", { x: 8, z: 8 });
    run("irregular-river", "terrain-benchmark", riverChunkAtProgress(.45, "terrain-benchmark"));
    run("canyon", "terrain-benchmark-canyon", riverChunkAtProgress(.62, "terrain-benchmark-canyon"));
    run("seam", "terrain-benchmark", { x: 0, z: 0 });
    run("corner", "terrain-benchmark", { x: -1, z: -1 });
    run("bridge-adjacent", "terrain-benchmark", riverChunkAtProgress(.5, "terrain-benchmark"));
  }, 30_000);
});
