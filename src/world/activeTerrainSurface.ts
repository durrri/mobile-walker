import { CHUNK_SIZE } from "./chunkCoordinates";
import { chunkId, type ChunkId } from "./chunkId";
import type { GeneratedChunkData } from "./generateChunk";

export interface ActiveTerrainSurfaceHit {
  readonly height: number;
  readonly normal: Readonly<{ x: number; y: number; z: number }>;
  readonly chunkId: ChunkId;
  readonly triangleIndex: number;
  readonly candidateCount: number;
  readonly barycentric: readonly [number, number, number];
}
export interface ActiveTerrainSurfaceIndex {
  readonly positions: Float32Array;
  readonly indices: Uint16Array;
  readonly cellsPerSide: number;
  readonly buckets: readonly (readonly number[])[];
  readonly estimatedBytes: number;
  readonly buildMilliseconds?: number;
}
export interface ActiveTerrainSurfaceDiagnostics extends ActiveTerrainSurfaceHit { readonly proceduralHeight?: number; readonly proceduralDifference?: number; }

const EPS = 1e-7;
const TIE_EPS = 1e-9;

/**
 * Builds the immutable presentation-neutral terrain query index from the exact
 * CPU-side vertex and index buffers also handed to rendering. Buckets are a
 * deterministic 2D grid over chunk-local x/z bounds; triangles touching a cell
 * are stored by triangle ordinal and query ties are resolved by the lowest
 * ordinal, then the canonical chunk id selected from floor(world/chunkSize).
 */
export function createActiveTerrainSurfaceIndex(data: GeneratedChunkData): ActiveTerrainSurfaceIndex {
  const triangleCount = data.terrainMesh.indices.length / 3;
  const cellsPerSide = Math.max(4, Math.ceil(Math.sqrt(triangleCount) / 4));
  const buckets: number[][] = Array.from({ length: cellsPerSide * cellsPerSide }, () => []);
  const originX = data.coordinate.x * data.size, originZ = data.coordinate.z * data.size;
  const cellSize = data.size / cellsPerSide;
  const clampCell = (value: number) => Math.max(0, Math.min(cellsPerSide - 1, Math.floor(value)));
  for (let tri = 0; tri < triangleCount; tri++) {
    const ia = data.terrainMesh.indices[tri * 3]! * 3, ib = data.terrainMesh.indices[tri * 3 + 1]! * 3, ic = data.terrainMesh.indices[tri * 3 + 2]! * 3;
    const minX = Math.min(data.terrainMesh.positions[ia]!, data.terrainMesh.positions[ib]!, data.terrainMesh.positions[ic]!);
    const maxX = Math.max(data.terrainMesh.positions[ia]!, data.terrainMesh.positions[ib]!, data.terrainMesh.positions[ic]!);
    const minZ = Math.min(data.terrainMesh.positions[ia + 2]!, data.terrainMesh.positions[ib + 2]!, data.terrainMesh.positions[ic + 2]!);
    const maxZ = Math.max(data.terrainMesh.positions[ia + 2]!, data.terrainMesh.positions[ib + 2]!, data.terrainMesh.positions[ic + 2]!);
    for (let z = clampCell((minZ - originZ) / cellSize); z <= clampCell((maxZ - originZ) / cellSize); z++)
      for (let x = clampCell((minX - originX) / cellSize); x <= clampCell((maxX - originX) / cellSize); x++) buckets[z * cellsPerSide + x]!.push(tri);
  }
  buckets.forEach(bucket => bucket.sort((a, b) => a - b));
  const entries = buckets.reduce((sum, bucket) => sum + bucket.length, 0);
  return Object.freeze({ positions: data.terrainMesh.positions, indices: data.terrainMesh.indices, cellsPerSide, buckets: buckets.map(bucket => Object.freeze([...bucket])), estimatedBytes: entries * 4 + buckets.length * 16 });
}

export function queryChunkTerrainSurface(data: GeneratedChunkData, worldX: number, worldZ: number): ActiveTerrainSurfaceHit | undefined {
  const index = data.terrainSurfaceIndex;
  const originX = data.coordinate.x * data.size, originZ = data.coordinate.z * data.size;
  if (worldX < originX - EPS || worldX > originX + data.size + EPS || worldZ < originZ - EPS || worldZ > originZ + data.size + EPS) return undefined;
  const cellSize = data.size / index.cellsPerSide;
  const cx = Math.max(0, Math.min(index.cellsPerSide - 1, Math.floor((worldX - originX) / cellSize)));
  const cz = Math.max(0, Math.min(index.cellsPerSide - 1, Math.floor((worldZ - originZ) / cellSize)));
  const candidates = index.buckets[cz * index.cellsPerSide + cx]!;
  let best: ActiveTerrainSurfaceHit | undefined;
  for (const tri of candidates) {
    const hit = queryTriangle(data, tri, worldX, worldZ, candidates.length);
    if (hit && (!best || tri < best.triangleIndex)) best = hit;
  }
  return best;
}

function queryTriangle(data: GeneratedChunkData, tri: number, x: number, z: number, candidateCount: number): ActiveTerrainSurfaceHit | undefined {
  const p = data.terrainMesh.positions, i = data.terrainMesh.indices;
  const a = i[tri * 3]! * 3, b = i[tri * 3 + 1]! * 3, c = i[tri * 3 + 2]! * 3;
  const ax = p[a]!, az = p[a + 2]!, bx = p[b]!, bz = p[b + 2]!, cx = p[c]!, cz = p[c + 2]!;
  const denom = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(denom) < 1e-12) return undefined;
  const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denom;
  const w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denom;
  const w2 = 1 - w0 - w1;
  if (w0 < -TIE_EPS || w1 < -TIE_EPS || w2 < -TIE_EPS) return undefined;
  const ay = p[a + 1]!, by = p[b + 1]!, cy = p[c + 1]!;
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  let nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
  const length = Math.hypot(nx, ny, nz) || 1; nx /= length; ny /= length; nz /= length; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  return { height: ay * w0 + by * w1 + cy * w2, normal: { x: nx, y: ny, z: nz }, chunkId: data.id, triangleIndex: tri, candidateCount, barycentric: [w0, w1, w2] };
}

export function canonicalTerrainChunkId(worldX: number, worldZ: number): ChunkId { return chunkId({ x: Math.floor(worldX / CHUNK_SIZE), z: Math.floor(worldZ / CHUNK_SIZE) }); }
