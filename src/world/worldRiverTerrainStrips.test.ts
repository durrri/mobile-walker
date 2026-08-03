import { describe, expect, it } from "vitest";

import { CHUNK_SIZE } from "./chunkCoordinates";
import { generateChunk, WORLD_RIVER_TERRAIN_STRIP_SAMPLE_SPACING } from "./generateChunk";
import { sampleTerrainHeight } from "./terrainSampling";
import { WORLD_RIVER_CARVING, WORLD_RIVER_LIP_CREST_DISTANCE,
  WORLD_RIVER_MAX_CARVING_RADIUS } from "./worldRiverCarving";

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-8;

describe("world-river terrain landmark strips", () => {
  it("contains authoritative water, lip, inner-bank, and falloff vertices", () => {
    const chunk = generateChunk("strip-landmarks", { x: 3, z: 2 });
    const vertices = chunk.irregularTerrain!.vertices;
    const landmarks = [WORLD_RIVER_CARVING.waterHalfWidth, WORLD_RIVER_LIP_CREST_DISTANCE,
      WORLD_RIVER_CARVING.waterHalfWidth + WORLD_RIVER_CARVING.bankWidth,
      WORLD_RIVER_MAX_CARVING_RADIUS];
    for (const magnitude of landmarks) for (const offset of [-magnitude, magnitude]) {
      const strip = vertices.filter(vertex => close(vertex.riverStripOffset ?? Infinity, offset));
      expect(strip.length).toBeGreaterThan(2);
      strip.forEach(vertex => expect(vertex.height)
        .toBeCloseTo(sampleTerrainHeight(chunk.seed, vertex.x, vertex.z), 12));
    }
  });

  it("triangulates 0.05-wu shore spans without skipping the lip", () => {
    const chunk = generateChunk("strip-shore-bands", { x: 3, z: 2 });
    const { vertices, indices } = chunk.irregularTerrain!;
    const water = WORLD_RIVER_CARVING.waterHalfWidth;
    const shoreOffsets = Array.from({ length: 5 }, (_, index) =>
      water + WORLD_RIVER_CARVING.shoreTransitionWidth * index / 4);
    const expectedEdges = shoreOffsets.slice(1).map((offset, index) => [shoreOffsets[index]!, offset] as const);
    const foundEdges: [number, number][] = [];
    for (let index = 0; index < indices.length; index += 3) {
      const triangle = [vertices[indices[index]!]!, vertices[indices[index + 1]!]!, vertices[indices[index + 2]!]!];
      for (let edge = 0; edge < 3; edge++) {
        const a = Math.abs(triangle[edge]!.riverStripOffset ?? Infinity);
        const b = Math.abs(triangle[(edge + 1) % 3]!.riverStripOffset ?? Infinity);
        if (Number.isFinite(a) && Number.isFinite(b)) foundEdges.push([Math.min(a, b), Math.max(a, b)]);
      }
      const offsets = triangle.map(vertex => Math.abs(vertex.riverStripOffset ?? Infinity));
      if (offsets.every(Number.isFinite) && offsets.some(offset => offset < water - 1e-8)) {
        expect(offsets.some(offset => offset > WORLD_RIVER_LIP_CREST_DISTANCE + 1e-8)).toBe(false);
      }
    }
    expectedEdges.forEach(([a, b]) => expect(foundEdges.some(([foundA, foundB]) =>
      close(a, foundA) && close(b, foundB))).toBe(true));
  });

  it("keeps representative rendered triangle interiors on the movement field", () => {
    const chunk = generateChunk("strip-interiors", { x: 3, z: 2 });
    const { vertices, indices } = chunk.irregularTerrain!;
    let checked = 0;
    for (let index = 0; index < indices.length; index += 3) {
      const triangle = [vertices[indices[index]!]!, vertices[indices[index + 1]!]!, vertices[indices[index + 2]!]!];
      if (!triangle.every(vertex => vertex.riverStripOffset !== undefined
        && Math.abs(vertex.riverStripOffset) >= WORLD_RIVER_CARVING.waterHalfWidth
        && Math.abs(vertex.riverStripOffset) <= WORLD_RIVER_LIP_CREST_DISTANCE)) continue;
      const x = triangle.reduce((sum, vertex) => sum + vertex.x, 0) / 3;
      const z = triangle.reduce((sum, vertex) => sum + vertex.z, 0) / 3;
      const renderedHeight = triangle.reduce((sum, vertex) => sum + vertex.height, 0) / 3;
      expect(Math.abs(renderedHeight - sampleTerrainHeight(chunk.seed, x, z))).toBeLessThan(0.04);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("shares exact global-lattice strip vertices at chunk seams", () => {
    const left = generateChunk("strip-seams", { x: 3, z: 2 });
    const right = generateChunk("strip-seams", { x: 4, z: 2 });
    const boundary = 4 * CHUNK_SIZE;
    const atBoundary = (chunk: typeof left) => chunk.irregularTerrain!.vertices
      .filter(vertex => close(vertex.x, boundary) && vertex.riverStripOffset !== undefined)
      .map(vertex => `${vertex.x},${vertex.z},${vertex.height},${vertex.riverStripOffset}`).sort();
    expect(atBoundary(left).length).toBeGreaterThan(2);
    expect(atBoundary(left)).toEqual(atBoundary(right));
  });

  it("has upward unique strong-bend triangles and leaves dry chunks coarse", () => {
    const chunk = generateChunk("strip-bend", { x: 3, z: 2 });
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
    const onBoundary = (vertex: typeof vertices[number]) => close(vertex.x, 3 * CHUNK_SIZE)
      || close(vertex.x, 4 * CHUNK_SIZE) || close(vertex.z, 2 * CHUNK_SIZE)
      || close(vertex.z, 3 * CHUNK_SIZE);
    for (const edge of edgeUse.values()) {
      if (edge.count === 1 && onBoundary(vertices[edge.a]!) && onBoundary(vertices[edge.b]!)) continue;
      expect(edge.count, JSON.stringify({ a: vertices[edge.a], b: vertices[edge.b] })).toBe(2);
    }
    expect(WORLD_RIVER_TERRAIN_STRIP_SAMPLE_SPACING).toBe(0.5);
    expect(generateChunk("strip-dry", { x: 100, z: 100 }).irregularTerrain).toBeUndefined();
  });
});
