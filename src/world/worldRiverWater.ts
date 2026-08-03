import { CHUNK_SIZE, type ChunkCoordinate } from "./chunkCoordinates";
import { WORLD_RIVER_CARVING } from "./worldRiverCarving";
import { worldRiverSpine, type RiverSpine, type WorldBounds2D } from "./worldRiverSpine";

/** Global arc-length lattice used by every chunk. It never restarts at a seam. */
export const WORLD_RIVER_WATER_SAMPLE_SPACING = 1;

export interface WorldRiverWaterSample {
  readonly inside: boolean;
  /** Negative inside the water, zero at its mathematical edge. */
  readonly signedDistanceToEdge: number;
  readonly distanceToCentreline: number;
  readonly signedSide: number;
  readonly surfaceElevation: number;
  readonly halfWidth: number;
  readonly progress: number;
  readonly distanceAlongRiver: number;
}

export function sampleWorldRiverWater(x: number, z: number, spine: RiverSpine = worldRiverSpine): WorldRiverWaterSample {
  const nearest = spine.nearestPointToRiver(x, z);
  const signedDistanceToEdge = nearest.distanceToRiver - WORLD_RIVER_CARVING.halfWidth;
  return {
    inside: signedDistanceToEdge <= 0,
    signedDistanceToEdge,
    distanceToCentreline: nearest.distanceToRiver,
    signedSide: nearest.signedSide,
    surfaceElevation: WORLD_RIVER_CARVING.surfaceElevation,
    halfWidth: WORLD_RIVER_CARVING.halfWidth,
    progress: nearest.progress,
    distanceAlongRiver: nearest.distanceAlongRiver,
  };
}

export const isInsideWorldRiverWater = (x: number, z: number, spine: RiverSpine = worldRiverSpine): boolean =>
  sampleWorldRiverWater(x, z, spine).inside;

export interface WaterVertex { readonly x: number; readonly y: number; readonly z: number; readonly u: number; readonly v: number }
export interface WorldRiverWaterGeometry {
  readonly vertices: readonly WaterVertex[];
  readonly indices: readonly number[];
  readonly sampleDistances: readonly number[];
}

type MutableVertex = { x: number; y: number; z: number; u: number; v: number };
const interpolate = (a: MutableVertex, b: MutableVertex, t: number): MutableVertex => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
  u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t,
});

function clipEdge(vertices: MutableVertex[], inside: (v: MutableVertex) => boolean, intersection: (a: MutableVertex, b: MutableVertex) => MutableVertex): MutableVertex[] {
  const output: MutableVertex[] = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index]!, b = vertices[(index + 1) % vertices.length]!;
    const aInside = inside(a), bInside = inside(b);
    if (aInside) output.push(a);
    if (aInside !== bInside) output.push(intersection(a, b));
  }
  return output;
}

/** Sutherland-Hodgman clipping gives each chunk an exact, deterministic half-open-area fragment. */
function clipTriangle(triangle: MutableVertex[], bounds: WorldBounds2D): MutableVertex[] {
  let polygon = triangle;
  const xAt = (value: number) => (a: MutableVertex, b: MutableVertex) => interpolate(a, b, (value - a.x) / (b.x - a.x));
  const zAt = (value: number) => (a: MutableVertex, b: MutableVertex) => interpolate(a, b, (value - a.z) / (b.z - a.z));
  polygon = clipEdge(polygon, vertex => vertex.x >= bounds.minX, xAt(bounds.minX));
  polygon = clipEdge(polygon, vertex => vertex.x <= bounds.maxX, xAt(bounds.maxX));
  polygon = clipEdge(polygon, vertex => vertex.z >= bounds.minZ, zAt(bounds.minZ));
  polygon = clipEdge(polygon, vertex => vertex.z <= bounds.maxZ, zAt(bounds.maxZ));
  return polygon;
}

export function tessellateWorldRiverWater(bounds?: WorldBounds2D, spine: RiverSpine = worldRiverSpine): WorldRiverWaterGeometry {
  const spacing = WORLD_RIVER_WATER_SAMPLE_SPACING;
  const count = Math.ceil(spine.totalLength / spacing);
  const frames: { left: MutableVertex; right: MutableVertex; distance: number }[] = [];
  for (let index = 0; index <= count; index += 1) {
    const distance = Math.min(index * spacing, spine.totalLength);
    const frame = spine.sampleFrame(spine.progressAtDistance(distance));
    const half = WORLD_RIVER_CARVING.halfWidth, y = WORLD_RIVER_CARVING.surfaceElevation;
    frames.push({ distance,
      left: { x: frame.position.x + frame.normal.x * half, y, z: frame.position.z + frame.normal.z * half, u: distance, v: 0 },
      right: { x: frame.position.x - frame.normal.x * half, y, z: frame.position.z - frame.normal.z * half, u: distance, v: 1 },
    });
  }
  const vertices: MutableVertex[] = [], indices: number[] = [];
  const emit = (triangle: MutableVertex[]): void => {
    let polygon = bounds ? clipTriangle(triangle, bounds) : triangle;
    if (polygon.length < 3) return;
    // At the authored hairpin an offset edge can advance less than its opposite
    // edge. Normalize every clipped polygon to the same upward winding rather
    // than allowing a back-facing/inverted water triangle.
    const [a, b, c] = polygon;
    const normalY = (b!.z - a!.z) * (c!.x - a!.x) - (b!.x - a!.x) * (c!.z - a!.z);
    if (normalY < 0) polygon = [...polygon].reverse();
    const base = vertices.length; vertices.push(...polygon);
    for (let index = 1; index < polygon.length - 1; index += 1) indices.push(base, base + index, base + index + 1);
  };
  for (let index = 0; index < frames.length - 1; index += 1) {
    const a = frames[index]!, b = frames[index + 1]!;
    // Clockwise in XZ produces an upward-facing Three.js front face.
    emit([a.left, b.left, a.right]);
    emit([a.right, b.left, b.right]);
  }
  return { vertices, indices, sampleDistances: frames.map(frame => frame.distance) };
}

export function tessellateWorldRiverWaterChunk(coordinate: ChunkCoordinate, spine: RiverSpine = worldRiverSpine): WorldRiverWaterGeometry {
  const minX = coordinate.x * CHUNK_SIZE, minZ = coordinate.z * CHUNK_SIZE;
  const bounds = { minX, maxX: minX + CHUNK_SIZE, minZ, maxZ: minZ + CHUNK_SIZE };
  // Avoid scanning/tessellating chunks outside the indexed corridor.
  if (!spine.queryRiverSegments(bounds, WORLD_RIVER_CARVING.halfWidth + WORLD_RIVER_WATER_SAMPLE_SPACING).length) {
    return { vertices: [], indices: [], sampleDistances: [] };
  }
  return tessellateWorldRiverWater(bounds, spine);
}
