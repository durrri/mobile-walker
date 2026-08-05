import { describe, expect, it } from "vitest";

import { CHUNK_SIZE } from "./chunkCoordinates";
import {
  generateChunk,
  WORLD_RIVER_TERRAIN_STRIP_SAMPLE_SPACING,
  worldRiverTerrainStripOffsets,
} from "./generateChunk";
import { sampleNaturalTerrainHeight, sampleTerrainHeight } from "./terrainSampling";
import {
  createWorldRiverCarvingContext,
  sampleWorldRiverCarving,
  WORLD_RIVER_CARVING,
} from "./worldRiverCarving";
import { dryChunkOutsideRiverInfluence, riverChunkAtProgress, riverSeamCrossing, strongestCurvatureProgress } from "./riverProceduralFixtures";
import { getWorldRiverOwner } from "./worldRiverOwner";

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-8;

describe("world-river terrain landmark strips", () => {
  it("keeps dense guides through L1.1 and hands L2 through L3 to the coarse lattice", () => {
    const owner=getWorldRiverOwner("strip-landmarks");
    const l1 = WORLD_RIVER_CARVING.shoreTransitionWidth;
    const l11 = (WORLD_RIVER_CARVING.shoreTransitionWidth + WORLD_RIVER_CARVING.bankWidth) / 2;
    const l2 = WORLD_RIVER_CARVING.bankWidth;
    const l3 = WORLD_RIVER_CARVING.bankWidth + WORLD_RIVER_CARVING.falloffWidth;
    const denseLandmarks = [0, l1, l11];
    const retiredDenseLandmarks = [l2, l3];
    const configuredRelativeOffsets = [...worldRiverTerrainStripOffsets()]
      .map(offset => Math.max(0, Math.abs(offset) - WORLD_RIVER_CARVING.waterHalfWidth));
    for (const magnitude of denseLandmarks) expect(configuredRelativeOffsets.some(offset => close(offset, magnitude))).toBe(true);
    for (const magnitude of retiredDenseLandmarks) expect(configuredRelativeOffsets.some(offset => close(offset, magnitude))).toBe(false);
    const count=(vertices:NonNullable<ReturnType<typeof generateChunk>["irregularTerrain"]>["vertices"],magnitude:number)=>vertices.filter(vertex=>{const nearest=owner.spine.nearestPointToRiver(vertex.x,vertex.z);return Math.abs(Math.abs(vertex.riverStripOffset??Infinity)-owner.widthProfile.sampleAtDistance(nearest.distanceAlongRiver).halfWidth-magnitude)<WORLD_RIVER_TERRAIN_STRIP_SAMPLE_SPACING*.35}).length;
    const frame=owner.spine.sampleFrame(.5);
    const centre={x:Math.floor(frame.position.x/CHUNK_SIZE),z:Math.floor(frame.position.z/CHUNK_SIZE)};
    const coordinates=Array.from({length:9},(_,i)=>({x:centre.x+(i%3)-1,z:centre.z+Math.floor(i/3)-1}));
    const chunks=coordinates.map(coordinate=>generateChunk("strip-landmarks",coordinate));
    const vertices=chunks.flatMap(chunk=>chunk.irregularTerrain?.vertices??[]);
    expect(denseLandmarks.every(magnitude=>count(vertices,magnitude)>2),"derived fixture must contain retained dense transition rows").toBe(true);
    expect(retiredDenseLandmarks.every(magnitude=>count(vertices,magnitude)===0),"L2/L3 must not be full dense river strips").toBe(true);
    const relative=(vertex:typeof vertices[number])=>Math.abs(vertex.riverStripOffset??Infinity)-owner.widthProfile.sampleAtDistance(owner.spine.nearestPointToRiver(vertex.x,vertex.z).distanceAlongRiver).halfWidth;
    for (const magnitude of denseLandmarks) {
      const strip = vertices.filter(vertex => Math.abs(relative(vertex)-magnitude)<WORLD_RIVER_TERRAIN_STRIP_SAMPLE_SPACING*.35);
      expect(strip.length,`relative landmark ${magnitude}`).toBeGreaterThan(2);
      strip.forEach(vertex => expect(vertex.height)
        .toBeCloseTo(sampleTerrainHeight(chunks[0]!.seed, vertex.x, vertex.z), 12));
    }
    const carving = createWorldRiverCarvingContext(owner.spine.bounds, owner.spine, owner.widthProfile);
    const coarseOuterBankSupport = vertices.filter(vertex => {
      if (vertex.riverStripOffset !== undefined) return false;
      const sample = sampleWorldRiverCarving(vertex.x, vertex.z, carving);
      const landDistance = sample ? sample.distanceToCentreline - sample.halfWidth : Infinity;
      return landDistance >= l2 - 1e-8 && landDistance <= l3 + 1e-8;
    });
    expect(coarseOuterBankSupport.length).toBeGreaterThan(4);
  }, 20_000);

  it("triangulates 0.05-wu shore spans without skipping the lip", () => {
    const riverChunk = riverChunkAtProgress(.5, "strip-shore-bands");
    const chunk = generateChunk("strip-shore-bands", riverChunk);
    expect(chunk.irregularTerrain).toBeDefined();
    const { vertices, indices } = chunk.irregularTerrain!;
    const owner=getWorldRiverOwner("strip-shore-bands");
    const relative=(vertex:typeof vertices[number])=>Math.abs(vertex.riverStripOffset??Infinity)-owner.widthProfile.sampleAtDistance(owner.spine.nearestPointToRiver(vertex.x,vertex.z).distanceAlongRiver).halfWidth;
    const water = 0;
    const shoreOffsets = Array.from({ length: 5 }, (_, index) => WORLD_RIVER_CARVING.shoreTransitionWidth * index / 4);
    const expectedEdges = shoreOffsets.slice(1).map((offset, index) => [shoreOffsets[index]!, offset] as const);
    const foundEdges: [number, number][] = [];
    for (let index = 0; index < indices.length; index += 3) {
      const triangle = [vertices[indices[index]!]!, vertices[indices[index + 1]!]!, vertices[indices[index + 2]!]!];
      for (let edge = 0; edge < 3; edge++) {
        const a = relative(triangle[edge]!);
        const b = relative(triangle[(edge + 1) % 3]!);
        if (Number.isFinite(a) && Number.isFinite(b)) foundEdges.push([Math.min(a, b), Math.max(a, b)]);
      }
      const offsets = triangle.map(relative);
      if (offsets.every(Number.isFinite) && offsets.some(offset => offset < water - 1e-8)) {
        expect(offsets.some(offset => offset > WORLD_RIVER_CARVING.shoreTransitionWidth + 1e-8)).toBe(false);
      }
    }
    expectedEdges.forEach(([a, b]) => expect(foundEdges.some(([foundA, foundB]) =>
      close(a, foundA) && close(b, foundB))).toBe(true));
  });

  it("keeps coarser bank triangle interiors close to the authoritative movement field", () => {
    const fixtures = [
      { name: "ordinary", seed: "strip-interiors-ordinary", coordinate: riverChunkAtProgress(.5, "strip-interiors-ordinary") },
      { name: "low", seed: "wetland", coordinate: riverChunkAtProgress(.5, "wetland") },
      { name: "curved", seed: "strip-interiors-curved", coordinate: riverChunkAtProgress(strongestCurvatureProgress("strip-interiors-curved"), "strip-interiors-curved") },
      { name: "seam", seed: "strip-interiors-seam", coordinate: riverSeamCrossing("z", 32, "strip-interiors-seam").a },
      { name: "canyon", seed: "strip-interiors-canyon", coordinate: riverChunkAtProgress(.5, "strip-interiors-canyon") },
    ] as const;
    const barycentricSamples = [[1 / 3, 1 / 3, 1 / 3], [.6, .2, .2], [.2, .6, .2], [.2, .2, .6]] as const;
    // The handoff deliberately exposes the existing 2-wu coarse lattice in
    // L2-to-L3. Keep disagreement below the approximate 1.5-wu player height
    // so a rendered bank facet cannot visibly put the grounded/collision field
    // on the far side of the avatar. This is intentionally below the previous
    // observed-output tolerance and should catch material regressions.
    const tolerance = 1.5;
    for (const fixture of fixtures) {
      const chunk = generateChunk(fixture.seed, fixture.coordinate);
      expect(chunk.irregularTerrain, `${fixture.name} fixture must cross refined river terrain`).toBeDefined();
      const { vertices, indices } = chunk.irregularTerrain!;
      const owner = getWorldRiverOwner(fixture.seed);
      const context = createWorldRiverCarvingContext(owner.spine.bounds, owner.spine, owner.widthProfile);
      const regions = { innerTransition: [] as number[], outerFalloff: [] as number[] };
      let highTerrainSamples = 0, lowTerrainSamples = 0;
      for (let index = 0; index < indices.length; index += 3) {
        const triangle = [vertices[indices[index]!]!, vertices[indices[index + 1]!]!, vertices[indices[index + 2]!]!] as const;
        for (const weights of barycentricSamples) {
          const x = triangle[0].x * weights[0] + triangle[1].x * weights[1] + triangle[2].x * weights[2];
          const z = triangle[0].z * weights[0] + triangle[1].z * weights[1] + triangle[2].z * weights[2];
          const sample = sampleWorldRiverCarving(x, z, context);
          if (!sample) continue;
          const landDistance = sample.distanceToCentreline - sample.halfWidth;
          const renderedHeight = triangle[0].height * weights[0] + triangle[1].height * weights[1] + triangle[2].height * weights[2];
          const authoritative = sampleTerrainHeight(chunk.seed, x, z);
          const error = Math.abs(renderedHeight - authoritative);
          if (landDistance >= (WORLD_RIVER_CARVING.shoreTransitionWidth + WORLD_RIVER_CARVING.bankWidth) / 2
            && landDistance <= WORLD_RIVER_CARVING.bankWidth) regions.innerTransition.push(error);
          if (landDistance >= WORLD_RIVER_CARVING.bankWidth
            && landDistance <= WORLD_RIVER_CARVING.bankWidth + WORLD_RIVER_CARVING.falloffWidth) regions.outerFalloff.push(error);
          const natural = sampleNaturalTerrainHeight(chunk.seed, x, z);
          if (natural > sample.targetBankHeight + .5) highTerrainSamples++;
          if (natural < sample.targetBankHeight - .05) lowTerrainSamples++;
          if (landDistance >= (WORLD_RIVER_CARVING.shoreTransitionWidth + WORLD_RIVER_CARVING.bankWidth) / 2
            && landDistance <= WORLD_RIVER_CARVING.bankWidth + WORLD_RIVER_CARVING.falloffWidth) {
            expect(error, JSON.stringify({ fixture: fixture.name, x, z, landDistance, renderedHeight, authoritative }))
              .toBeLessThan(tolerance);
          }
        }
      }
      expect(regions.innerTransition.length, `${fixture.name} must sample L1.1-to-L2 interiors`).toBeGreaterThan(0);
      expect(regions.outerFalloff.length, `${fixture.name} must sample L2-to-L3 interiors`).toBeGreaterThan(0);
      expect(Math.max(...regions.innerTransition), `${fixture.name} L1.1-to-L2 max error`).toBeLessThan(tolerance);
      expect(Math.max(...regions.outerFalloff), `${fixture.name} L2-to-L3 max error`).toBeLessThan(tolerance);
      if (fixture.name === "canyon") expect(highTerrainSamples).toBeGreaterThan(0);
      if (fixture.name === "low") expect(lowTerrainSamples).toBeGreaterThan(0);
    }
  }, 60_000);

  it("shares exact global-lattice strip vertices at chunk seams", () => {
    const seam = riverSeamCrossing("x", 0, "strip-seams");
    const left = generateChunk("strip-seams", seam.a);
    const right = generateChunk("strip-seams", seam.b);
    const boundary = seam.edge;
    expect(left.irregularTerrain).toBeDefined(); expect(right.irregularTerrain).toBeDefined();
    const atBoundary = (chunk: typeof left) => chunk.irregularTerrain!.vertices
      .filter(vertex => close(vertex.x, boundary) && vertex.riverStripOffset !== undefined)
      .map(vertex => `${vertex.x},${vertex.z},${vertex.height},${vertex.riverStripOffset}`).sort();
    expect(atBoundary(left).length).toBeGreaterThan(2);
    expect(atBoundary(left)).toEqual(atBoundary(right));
  });

  it("has upward unique strong-bend triangles and leaves dry chunks coarse", () => {
    const bendChunk = riverChunkAtProgress(strongestCurvatureProgress("strip-bend"), "strip-bend");
    const chunk = generateChunk("strip-bend", bendChunk);
    expect(chunk.irregularTerrain).toBeDefined();
    const { vertices, indices } = chunk.irregularTerrain!;
    const triangles = new Set<string>();
    const edgeUse = new Map<string, { count: number; a: number; b: number }>();
    for (let index = 0; index < indices.length; index += 3) {
      const ids = [indices[index]!, indices[index + 1]!, indices[index + 2]!];
      ids.forEach(id => expect(id).toBeGreaterThanOrEqual(0));
      ids.forEach(id => expect(id).toBeLessThan(vertices.length));
      const [a, b, c] = ids.map(id => vertices[id]!);
      expect((b!.z - a!.z) * (c!.x - a!.x) - (b!.x - a!.x) * (c!.z - a!.z)).toBeGreaterThan(1e-10);
      const samples = [a, b, c].map(vertex => sampleWorldRiverCarving(vertex!.x, vertex!.z));
      const channelSides = samples.filter(sample => sample?.insideChannel).map(sample => sample!.signedSide);
      if (channelSides.length > 0) expect(Math.min(...channelSides) * Math.max(...channelSides)).toBeGreaterThanOrEqual(0);
      const key = [...ids].sort((first, second) => first - second).join(",");
      expect(triangles.has(key)).toBe(false);
      triangles.add(key);
      for (let edge = 0; edge < 3; edge++) {
        const a = ids[edge]!, b = ids[(edge + 1) % 3]!;
        const edgeKey = a < b ? `${a},${b}` : `${b},${a}`;
        const use = edgeUse.get(edgeKey) ?? { count: 0, a, b };
        use.count++; edgeUse.set(edgeKey, use);
      }
    }
    const onBoundary = (vertex: typeof vertices[number]) => close(vertex.x, bendChunk.x * CHUNK_SIZE)
      || close(vertex.x, (bendChunk.x + 1) * CHUNK_SIZE) || close(vertex.z, bendChunk.z * CHUNK_SIZE)
      || close(vertex.z, (bendChunk.z + 1) * CHUNK_SIZE);
    for (const edge of edgeUse.values()) {
      if (edge.count === 1 && onBoundary(vertices[edge.a]!) && onBoundary(vertices[edge.b]!)) continue;
      expect(edge.count, JSON.stringify({ a: vertices[edge.a], b: vertices[edge.b] })).toBe(2);
    }
    expect(WORLD_RIVER_TERRAIN_STRIP_SAMPLE_SPACING).toBe(0.5);
    expect(generateChunk("strip-dry", dryChunkOutsideRiverInfluence("strip-dry")).irregularTerrain).toBeUndefined();
  });
});
