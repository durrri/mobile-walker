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
  const signedDistanceToEdge = nearest.distanceToRiver - WORLD_RIVER_CARVING.waterHalfWidth;
  return {
    inside: signedDistanceToEdge <= 0,
    signedDistanceToEdge,
    distanceToCentreline: nearest.distanceToRiver,
    signedSide: nearest.signedSide,
    surfaceElevation: WORLD_RIVER_CARVING.surfaceElevation,
    halfWidth: WORLD_RIVER_CARVING.waterHalfWidth,
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
  /** Diagnostics: strip intervals considered before exact clipping. */
  readonly candidateIntervalCount: number;
  readonly globalIntervalCount: number;
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

interface WaterFrame { readonly left: MutableVertex; readonly right: MutableVertex; readonly distance: number }
interface WaterInterval { readonly index: number; readonly a: WaterFrame; readonly b: WaterFrame; readonly bounds: WorldBounds2D }
interface WaterLattice {
  readonly frames: readonly WaterFrame[];
  readonly intervals: readonly WaterInterval[];
  readonly cells: ReadonlyMap<string, readonly WaterInterval[]>;
}

const WATER_INDEX_CELL_SIZE = CHUNK_SIZE;
let lattices = new WeakMap<RiverSpine, WaterLattice>();

/** Resets presentation-neutral water lattices for independent regeneration diagnostics. */
export function clearWorldRiverWaterCaches(): void { lattices = new WeakMap<RiverSpine, WaterLattice>(); }

/** Builds the immutable global distance lattice and interval index once per spine. */
function waterLattice(spine: RiverSpine): WaterLattice {
  const existing = lattices.get(spine); if (existing) return existing;
  const spacing = WORLD_RIVER_WATER_SAMPLE_SPACING;
  const count = Math.ceil(spine.totalLength / spacing);
  const frames: WaterFrame[] = [];
  for (let index = 0; index <= count; index += 1) {
    const distance = Math.min(index * spacing, spine.totalLength);
    const frame = spine.sampleFrame(spine.progressAtDistance(distance));
    const half = WORLD_RIVER_CARVING.waterHalfWidth, y = WORLD_RIVER_CARVING.surfaceElevation;
    frames.push({ distance,
      left: { x: frame.position.x + frame.normal.x * half, y, z: frame.position.z + frame.normal.z * half, u: distance, v: 0 },
      right: { x: frame.position.x - frame.normal.x * half, y, z: frame.position.z - frame.normal.z * half, u: distance, v: 1 },
    });
  }
  const intervals: WaterInterval[] = [];
  const mutableCells = new Map<string, WaterInterval[]>();
  for (let index = 0; index < frames.length - 1; index += 1) {
    const a = frames[index]!, b = frames[index + 1]!;
    const xs = [a.left.x, a.right.x, b.left.x, b.right.x], zs = [a.left.z, a.right.z, b.left.z, b.right.z];
    const interval = { index, a, b, bounds: { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) } };
    intervals.push(interval);
    for (let x = Math.floor(interval.bounds.minX / WATER_INDEX_CELL_SIZE); x <= Math.floor(interval.bounds.maxX / WATER_INDEX_CELL_SIZE); x += 1) {
      for (let z = Math.floor(interval.bounds.minZ / WATER_INDEX_CELL_SIZE); z <= Math.floor(interval.bounds.maxZ / WATER_INDEX_CELL_SIZE); z += 1) {
        const key = `${x},${z}`, cell = mutableCells.get(key) ?? []; cell.push(interval); mutableCells.set(key, cell);
      }
    }
  }
  const lattice = { frames, intervals, cells: new Map([...mutableCells].map(([key, value]) => [key, Object.freeze(value)])) };
  lattices.set(spine, lattice); return lattice;
}

const intersects = (a: WorldBounds2D, b: WorldBounds2D): boolean =>
  a.maxX >= b.minX && a.minX <= b.maxX && a.maxZ >= b.minZ && a.minZ <= b.maxZ;

function queryWaterIntervals(lattice: WaterLattice, bounds?: WorldBounds2D): readonly WaterInterval[] {
  if (!bounds) return lattice.intervals;
  const found = new Map<number, WaterInterval>();
  for (let x = Math.floor(bounds.minX / WATER_INDEX_CELL_SIZE); x <= Math.floor(bounds.maxX / WATER_INDEX_CELL_SIZE); x += 1) {
    for (let z = Math.floor(bounds.minZ / WATER_INDEX_CELL_SIZE); z <= Math.floor(bounds.maxZ / WATER_INDEX_CELL_SIZE); z += 1) {
      for (const interval of lattice.cells.get(`${x},${z}`) ?? []) if (intersects(interval.bounds, bounds)) found.set(interval.index, interval);
    }
  }
  return [...found.values()].sort((a, b) => a.index - b.index);
}

export function tessellateWorldRiverWater(bounds?: WorldBounds2D, spine: RiverSpine = worldRiverSpine): WorldRiverWaterGeometry {
  const lattice = waterLattice(spine);
  const candidates = queryWaterIntervals(lattice, bounds);
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
  for (const { a, b } of candidates) {
    // Clockwise in XZ produces an upward-facing Three.js front face.
    emit([a.left, b.left, a.right]);
    emit([a.right, b.left, b.right]);
  }
  const sampleDistances = candidates.length
    ? [candidates[0]!.a.distance, ...candidates.map(interval => interval.b.distance)]
    : [];
  return { vertices, indices, sampleDistances, candidateIntervalCount: candidates.length, globalIntervalCount: lattice.intervals.length };
}

export function tessellateWorldRiverWaterChunk(coordinate: ChunkCoordinate, spine: RiverSpine = worldRiverSpine): WorldRiverWaterGeometry {
  const minX = coordinate.x * CHUNK_SIZE, minZ = coordinate.z * CHUNK_SIZE;
  const bounds = { minX, maxX: minX + CHUNK_SIZE, minZ, maxZ: minZ + CHUNK_SIZE };
  return tessellateWorldRiverWater(bounds, spine);
}
