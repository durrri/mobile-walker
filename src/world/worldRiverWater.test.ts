import { describe, expect, it } from "vitest";
import { CHUNK_SIZE, worldToChunk } from "./chunkCoordinates";
import { WORLD_RIVER_CARVING } from "./worldRiverCarving";
import { sampleChannelTerrainHeight } from "./terrainSampling";
import { worldRiverSpine } from "./worldRiverSpine";
import { cornerNearRiverSeamCrossing, riverSeamCrossing } from "./riverProceduralFixtures";
import {
  sampleWorldRiverWater, tessellateWorldRiverWater, tessellateWorldRiverWaterChunk,
  WORLD_RIVER_WATER_SAMPLE_SPACING,
} from "./worldRiverWater";

describe("world river water field", () => {
  for (const progress of [0.1, 0.35, 0.52, 0.8]) {
    it(`uses the symmetric authoritative footprint at ${progress}`, () => {
      const frame = worldRiverSpine.sampleFrame(progress), half = WORLD_RIVER_CARVING.waterHalfWidth;
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

  it("uses the reusable spatial index to process only a bounded local subset", () => {
    const point = worldRiverSpine.samplePosition(0.5), coordinate = worldToChunk(point.x, point.z);
    const local = tessellateWorldRiverWaterChunk(coordinate);
    expect(local.candidateIntervalCount).toBeGreaterThan(0);
    expect(local.candidateIntervalCount).toBeLessThan(30);
    expect(local.globalIntervalCount).toBeGreaterThan(250);
    expect(local.candidateIntervalCount).toBeLessThan(local.globalIntervalCount / 10);
    const dry = tessellateWorldRiverWaterChunk({ x: 100, z: 100 });
    expect(dry.candidateIntervalCount).toBe(0);
    expect(dry.vertices).toHaveLength(0);
  });
});

const triangleArea = (geometry: ReturnType<typeof tessellateWorldRiverWater>): number => {
  let area = 0;
  for (let index = 0; index < geometry.indices.length; index += 3) {
    const a = geometry.vertices[geometry.indices[index]!]!, b = geometry.vertices[geometry.indices[index + 1]!]!, c = geometry.vertices[geometry.indices[index + 2]!]!;
    area += Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
  }
  return area;
};

function sharedEdgeValues(geometry: ReturnType<typeof tessellateWorldRiverWater>, axis: "x" | "z", value: number): string[] {
  return geometry.vertices.filter(vertex => Math.abs(vertex[axis] - value) < 1e-8)
    .map(vertex => `${vertex.x.toFixed(8)},${vertex.z.toFixed(8)},${vertex.y.toFixed(8)},${vertex.u.toFixed(8)},${vertex.v.toFixed(8)}`)
    .filter((entry, index, all) => all.indexOf(entry) === index).sort();
}

describe("direct chunk seam coverage", () => {
  const cases = [riverSeamCrossing("x"), riverSeamCrossing("z", 0), riverSeamCrossing("z", 1), cornerNearRiverSeamCrossing()];
  for (const seam of cases) it(seam.label, () => {
    const first = tessellateWorldRiverWaterChunk(seam.a), second = tessellateWorldRiverWaterChunk(seam.b);
    const reversed = [tessellateWorldRiverWaterChunk(seam.b), tessellateWorldRiverWaterChunk(seam.a)].reverse();
    expect([first, second]).toEqual(reversed);
    const left = sharedEdgeValues(first, seam.axis, seam.edge), right = sharedEdgeValues(second, seam.axis, seam.edge);
    expect(left.length).toBeGreaterThanOrEqual(2);
    expect(left).toEqual(right);
    const minX = Math.min(seam.a.x, seam.b.x) * CHUNK_SIZE, minZ = Math.min(seam.a.z, seam.b.z) * CHUNK_SIZE;
    const union = tessellateWorldRiverWater({ minX, maxX: (Math.max(seam.a.x, seam.b.x) + 1) * CHUNK_SIZE,
      minZ, maxZ: (Math.max(seam.a.z, seam.b.z) + 1) * CHUNK_SIZE });
    expect(triangleArea(first) + triangleArea(second)).toBeCloseTo(triangleArea(union), 7);
    [...first.vertices, ...second.vertices].forEach(vertex => expect(vertex.y).toBe(WORLD_RIVER_CARVING.surfaceElevation));
  });
});

describe("strongest bend geometry", () => {
  it("keeps offset edges ordered, simple, full-width and hole-free", () => {
    const start = worldRiverSpine.distanceAtProgress(0.32), end = worldRiverSpine.distanceAtProgress(0.55);
    const frames = [];
    for (let distance = Math.ceil(start); distance <= end; distance += WORLD_RIVER_WATER_SAMPLE_SPACING) {
      const frame = worldRiverSpine.sampleFrame(worldRiverSpine.progressAtDistance(distance));
      const half = WORLD_RIVER_CARVING.waterHalfWidth;
      frames.push({ left: { x: frame.position.x + frame.normal.x * half, z: frame.position.z + frame.normal.z * half },
        right: { x: frame.position.x - frame.normal.x * half, z: frame.position.z - frame.normal.z * half }, normal: frame.normal });
    }
    frames.forEach(frame => {
      expect(Math.hypot(frame.left.x - frame.right.x, frame.left.z - frame.right.z)).toBeCloseTo(4, 8);
      expect((frame.left.x - frame.right.x) * frame.normal.x + (frame.left.z - frame.right.z) * frame.normal.z).toBeGreaterThan(0);
    });
    const crosses = (a:{x:number;z:number},b:{x:number;z:number},c:{x:number;z:number},d:{x:number;z:number}): boolean => {
      const side=(p:{x:number;z:number},q:{x:number;z:number},r:{x:number;z:number})=>(q.x-p.x)*(r.z-p.z)-(q.z-p.z)*(r.x-p.x);
      return side(a,b,c)*side(a,b,d)<0 && side(c,d,a)*side(c,d,b)<0;
    };
    for (const edge of [frames.map(frame=>frame.left),frames.map(frame=>frame.right)]) {
      for(let first=0;first<edge.length-1;first+=1) for(let second=first+2;second<edge.length-1;second+=1) {
        if(crosses(edge[first]!,edge[first+1]!,edge[second]!,edge[second+1]!)) throw new Error(`cross ${first} ${second}`);
      }
    }
    const bend = tessellateWorldRiverWater();
    for (let index = 0; index < bend.indices.length; index += 3) {
      const a = bend.vertices[bend.indices[index]!]!, b = bend.vertices[bend.indices[index + 1]!]!, c = bend.vertices[bend.indices[index + 2]!]!;
      expect(Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x))/2).toBeGreaterThan(1e-6);
    }
    // Two triangles per interval exactly tile each quad: no duplicate triangle or omitted interval.
    expect(bend.indices.length / 3).toBe(bend.globalIntervalCount * 2);
    const keys = [] as string[];
    for (let i=0;i<bend.indices.length;i+=3) keys.push([0,1,2].map(j=>bend.vertices[bend.indices[i+j]!]!).map(v=>`${v.x},${v.z}`).sort().join("|"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps authoritative terrain below the water ribbon around the strongest bend", () => {
    const geometry = tessellateWorldRiverWater();
    const start = worldRiverSpine.distanceAtProgress(0.32);
    const end = worldRiverSpine.distanceAtProgress(0.55);
    let checked = 0;
    for (let index = 0; index < geometry.indices.length; index += 3) {
      const triangle = [0, 1, 2].map(offset => geometry.vertices[geometry.indices[index + offset]!]!);
      const distance = triangle.reduce((sum, vertex) => sum + vertex.u, 0) / 3;
      if (distance < start || distance > end) continue;
      const x = triangle.reduce((sum, vertex) => sum + vertex.x, 0) / 3;
      const z = triangle.reduce((sum, vertex) => sum + vertex.z, 0) / 3;
      expect(sampleChannelTerrainHeight(42, x, z)).toBeLessThan(WORLD_RIVER_CARVING.surfaceElevation);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });
});
