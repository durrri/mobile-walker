import { describe, expect, it } from "vitest";

import { CHUNK_SIZE } from "./chunkCoordinates";
import { generateChunk, WORLD_RIVER_TERRAIN_STRIP_SAMPLE_SPACING } from "./generateChunk";
import { sampleTerrainHeight } from "./terrainSampling";
import { WORLD_RIVER_CARVING } from "./worldRiverCarving";
import { dryChunkOutsideRiverInfluence, riverChunkAtProgress, riverSeamCrossing, strongestCurvatureProgress } from "./riverProceduralFixtures";
import { getWorldRiverOwner } from "./worldRiverOwner";

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-8;

describe("world-river terrain landmark strips", () => {
  it("contains authoritative water, lip, inner-bank, and falloff vertices", () => {
    const owner=getWorldRiverOwner("strip-landmarks");
    const landmarks = [0,WORLD_RIVER_CARVING.shoreTransitionWidth,WORLD_RIVER_CARVING.bankWidth,
      WORLD_RIVER_CARVING.bankWidth+WORLD_RIVER_CARVING.falloffWidth];
    const count=(vertices:NonNullable<ReturnType<typeof generateChunk>["irregularTerrain"]>["vertices"],magnitude:number)=>vertices.filter(vertex=>{const nearest=owner.spine.nearestPointToRiver(vertex.x,vertex.z);return Math.abs(Math.abs(vertex.riverStripOffset??Infinity)-owner.widthProfile.sampleAtDistance(nearest.distanceAlongRiver).halfWidth-magnitude)<WORLD_RIVER_TERRAIN_STRIP_SAMPLE_SPACING*.35}).length;
    const frame=owner.spine.sampleFrame(.5);
    const centre={x:Math.floor(frame.position.x/CHUNK_SIZE),z:Math.floor(frame.position.z/CHUNK_SIZE)};
    const coordinates=Array.from({length:9},(_,i)=>({x:centre.x+(i%3)-1,z:centre.z+Math.floor(i/3)-1}));
    const chunks=coordinates.map(coordinate=>generateChunk("strip-landmarks",coordinate));
    const vertices=chunks.flatMap(chunk=>chunk.irregularTerrain?.vertices??[]);
    expect(landmarks.every(magnitude=>count(vertices,magnitude)>2),"derived fixture must contain every variable-width transition").toBe(true);
    const relative=(vertex:typeof vertices[number])=>Math.abs(vertex.riverStripOffset??Infinity)-owner.widthProfile.sampleAtDistance(owner.spine.nearestPointToRiver(vertex.x,vertex.z).distanceAlongRiver).halfWidth;
    for (const magnitude of landmarks) {
      const strip = vertices.filter(vertex => Math.abs(relative(vertex)-magnitude)<WORLD_RIVER_TERRAIN_STRIP_SAMPLE_SPACING*.35);
      expect(strip.length,`relative landmark ${magnitude}`).toBeGreaterThan(2);
      strip.forEach(vertex => expect(vertex.height)
        .toBeCloseTo(sampleTerrainHeight(chunks[0]!.seed, vertex.x, vertex.z), 12));
    }
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

  it("keeps representative rendered triangle interiors on the movement field", () => {
    const riverChunk = riverChunkAtProgress(.5, "strip-interiors");
    const chunk = generateChunk("strip-interiors", riverChunk);
    expect(chunk.irregularTerrain).toBeDefined();
    const { vertices, indices } = chunk.irregularTerrain!;
    const owner=getWorldRiverOwner("strip-interiors");
    let checked = 0;
    for (let index = 0; index < indices.length; index += 3) {
      const triangle = [vertices[indices[index]!]!, vertices[indices[index + 1]!]!, vertices[indices[index + 2]!]!];
      if (!triangle.every(vertex => {if(vertex.riverStripOffset===undefined)return false;const nearest=owner.spine.nearestPointToRiver(vertex.x,vertex.z),relative=Math.abs(vertex.riverStripOffset)-owner.widthProfile.sampleAtDistance(nearest.distanceAlongRiver).halfWidth;return relative>=-1e-8&&relative<=WORLD_RIVER_CARVING.shoreTransitionWidth+1e-8})) continue;
      const x = triangle.reduce((sum, vertex) => sum + vertex.x, 0) / 3;
      const z = triangle.reduce((sum, vertex) => sum + vertex.z, 0) / 3;
      const renderedHeight = triangle.reduce((sum, vertex) => sum + vertex.height, 0) / 3;
      expect(Math.abs(renderedHeight - sampleTerrainHeight(chunk.seed, x, z))).toBeLessThan(0.04);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

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
      const [a, b, c] = ids.map(id => vertices[id]!);
      expect((b!.z - a!.z) * (c!.x - a!.x) - (b!.x - a!.x) * (c!.z - a!.z)).toBeGreaterThan(1e-10);
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
