import { describe, it } from "vitest";

import { generateChunk } from "./generateChunk";
import { riverChunkAtProgress, riverSeamCrossing, strongestCurvatureProgress } from "./riverProceduralFixtures";
import { sampleTerrainHeight } from "./terrainSampling";
import { createWorldRiverCarvingContext, sampleWorldRiverCarving, WORLD_RIVER_CARVING } from "./worldRiverCarving";
import { getWorldRiverOwner } from "./worldRiverOwner";

const fixtures = [
  { name: "ordinary", seed: "strip-interiors-ordinary", coordinate: riverChunkAtProgress(.5, "strip-interiors-ordinary") },
  { name: "low", seed: "wetland", coordinate: riverChunkAtProgress(.5, "wetland") },
  { name: "curved", seed: "strip-interiors-curved", coordinate: riverChunkAtProgress(strongestCurvatureProgress("strip-interiors-curved"), "strip-interiors-curved") },
  { name: "seam", seed: "strip-interiors-seam", coordinate: riverSeamCrossing("z", 32, "strip-interiors-seam").a },
  { name: "canyon", seed: "strip-interiors-canyon", coordinate: riverChunkAtProgress(.5, "strip-interiors-canyon") },
] as const;

const barycentricSamples = [[1 / 3, 1 / 3, 1 / 3], [.6, .2, .2], [.2, .6, .2], [.2, .2, .6]] as const;

const percentile = (values: readonly number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
};

describe("world-river terrain strip diagnostics", () => {
  it("reports bank topology geometry, timing, and mesh-authoritative error", () => {
    for (const fixture of fixtures) {
      const timings: { terrainTriangulationMs: number; totalMs: number }[] = [];
      const chunk = generateChunk(fixture.seed, fixture.coordinate, undefined, false, { record: timing => timings.push(timing) });
      const terrain = chunk.irregularTerrain;
      if (!terrain) throw new Error(`${fixture.name} fixture must cross irregular river terrain`);
      const owner = getWorldRiverOwner(fixture.seed);
      const context = createWorldRiverCarvingContext(owner.spine.bounds, owner.spine, owner.widthProfile);
      const regions = { innerTransition: [] as {
        readonly error: number;
        readonly barycentric: readonly [number, number, number];
        readonly edgeLengths: readonly [number, number, number];
        readonly area: number;
        readonly vertexKinds: readonly string[];
        readonly vertices: readonly { readonly x: number; readonly z: number }[];
      }[], outerFalloff: [] as {
        readonly error: number;
        readonly barycentric: readonly [number, number, number];
        readonly edgeLengths: readonly [number, number, number];
        readonly area: number;
        readonly vertexKinds: readonly string[];
        readonly vertices: readonly { readonly x: number; readonly z: number }[];
      }[] };
      let outerVertices = 0, outerTriangles = 0;
      for (const vertex of terrain.vertices) {
        const sample = sampleWorldRiverCarving(vertex.x, vertex.z, context);
        const landDistance = sample ? sample.distanceToCentreline - sample.halfWidth : Infinity;
        if (landDistance >= WORLD_RIVER_CARVING.bankWidth
          && landDistance <= WORLD_RIVER_CARVING.bankWidth + WORLD_RIVER_CARVING.falloffWidth) outerVertices++;
      }
      for (let index = 0; index < terrain.indices.length; index += 3) {
        const triangle = [
          terrain.vertices[terrain.indices[index]!]!,
          terrain.vertices[terrain.indices[index + 1]!]!,
          terrain.vertices[terrain.indices[index + 2]!]!,
        ] as const;
        const edgeLengths = [
          Math.hypot(triangle[0].x - triangle[1].x, triangle[0].z - triangle[1].z),
          Math.hypot(triangle[1].x - triangle[2].x, triangle[1].z - triangle[2].z),
          Math.hypot(triangle[2].x - triangle[0].x, triangle[2].z - triangle[0].z),
        ] as const;
        const area = Math.abs((triangle[1].z - triangle[0].z) * (triangle[2].x - triangle[0].x)
          - (triangle[1].x - triangle[0].x) * (triangle[2].z - triangle[0].z)) / 2;
        const vertexKinds = triangle.map(vertex => vertex.riverStripOffset === undefined ? "coarse-lattice" : "dense-strip");
        const centreX = (triangle[0].x + triangle[1].x + triangle[2].x) / 3;
        const centreZ = (triangle[0].z + triangle[1].z + triangle[2].z) / 3;
        const centre = sampleWorldRiverCarving(centreX, centreZ, context);
        const centreLandDistance = centre ? centre.distanceToCentreline - centre.halfWidth : Infinity;
        if (centreLandDistance >= WORLD_RIVER_CARVING.bankWidth
          && centreLandDistance <= WORLD_RIVER_CARVING.bankWidth + WORLD_RIVER_CARVING.falloffWidth) outerTriangles++;
        for (const weights of barycentricSamples) {
          const x = triangle[0].x * weights[0] + triangle[1].x * weights[1] + triangle[2].x * weights[2];
          const z = triangle[0].z * weights[0] + triangle[1].z * weights[1] + triangle[2].z * weights[2];
          const sample = sampleWorldRiverCarving(x, z, context);
          if (!sample) continue;
          const landDistance = sample.distanceToCentreline - sample.halfWidth;
          const region = landDistance >= (WORLD_RIVER_CARVING.shoreTransitionWidth + WORLD_RIVER_CARVING.bankWidth) / 2
            && landDistance <= WORLD_RIVER_CARVING.bankWidth ? "innerTransition"
            : landDistance >= WORLD_RIVER_CARVING.bankWidth
              && landDistance <= WORLD_RIVER_CARVING.bankWidth + WORLD_RIVER_CARVING.falloffWidth ? "outerFalloff"
              : undefined;
          if (!region) continue;
          const renderedHeight = triangle[0].height * weights[0] + triangle[1].height * weights[1] + triangle[2].height * weights[2];
          regions[region].push({
            error: Math.abs(renderedHeight - sampleTerrainHeight(chunk.seed, x, z)),
            barycentric: weights,
            edgeLengths,
            area,
            vertexKinds,
            vertices: triangle.map(vertex => ({ x: vertex.x, z: vertex.z })),
          });
        }
      }
      for (const [region, errors] of Object.entries(regions)) {
        const values = errors.map(error => error.error);
        const maxSample = errors.reduce((best, sample) => sample.error > (best?.error ?? -1) ? sample : best, undefined as typeof errors[number] | undefined);
        console.log(JSON.stringify({
          fixture: fixture.name,
          region,
          samples: errors.length,
          maxError: Math.max(...values),
          meanError: values.reduce((sum, error) => sum + error, 0) / values.length,
          p95Error: percentile(values, .95),
          maxSample,
          irregularVertices: terrain.vertices.length,
          irregularTriangles: terrain.indices.length / 3,
          outerFalloffVertices: outerVertices,
          outerFalloffTriangles: outerTriangles,
          terrainTriangulationMs: timings[0]?.terrainTriangulationMs,
          totalColdChunkMs: timings[0]?.totalMs,
        }));
      }
    }
  }, 120_000);
});
