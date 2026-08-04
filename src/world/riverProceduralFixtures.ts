/** Stable progress/search-derived fixtures for the versioned production river. Test/diagnostic only. */
import { generateBridges } from "./bridges";
import { CHUNK_SIZE, worldToChunk, type ChunkCoordinate } from "./chunkCoordinates";
import { generatePois, type GeneratedPoi } from "./poi";
import { WORLD_RIVER_MAX_CARVING_RADIUS } from "./worldRiverCarving";
import { worldRiverSpine } from "./worldRiverSpine";

export interface RiverSeamFixture {
  readonly axis: "x" | "z"; readonly edge: number;
  readonly a: ChunkCoordinate; readonly b: ChunkCoordinate;
  readonly progress: number; readonly label: string;
}

const fail = (message: string): never => { throw new Error(`Procedural river fixture: ${message}`); };
export const riverPointAtProgress = (progress: number) => worldRiverSpine.samplePosition(progress);
export const riverChunkAtProgress = (progress: number): ChunkCoordinate => {
  const point = riverPointAtProgress(progress), chunk = worldToChunk(point.x, point.z);
  if (!worldRiverSpine.queryRiverSegments({ minX: chunk.x * CHUNK_SIZE, maxX: (chunk.x + 1) * CHUNK_SIZE,
    minZ: chunk.z * CHUNK_SIZE, maxZ: (chunk.z + 1) * CHUNK_SIZE }, WORLD_RIVER_MAX_CARVING_RADIUS).length) {
    fail(`progress ${progress} produced non-river chunk ${chunk.x},${chunk.z}`);
  }
  return chunk;
};

function seamCandidates(axis: "x" | "z"): RiverSeamFixture[] {
  const result: RiverSeamFixture[] = [];
  for (const segment of worldRiverSpine.indexedSegments) {
    const startChunk = worldToChunk(segment.start.x, segment.start.z), endChunk = worldToChunk(segment.end.x, segment.end.z);
    const start = axis === "x" ? startChunk.x : startChunk.z, end = axis === "x" ? endChunk.x : endChunk.z;
    if (start === end || Math.abs(start - end) !== 1) continue;
    const low = Math.min(start, end), edge = (low + 1) * CHUNK_SIZE;
    const other = axis === "x" ? Math.floor(((segment.start.z + segment.end.z) / 2) / CHUNK_SIZE)
      : Math.floor(((segment.start.x + segment.end.x) / 2) / CHUNK_SIZE);
    const a = axis === "x" ? { x: low, z: other } : { x: other, z: low };
    const b = axis === "x" ? { x: low + 1, z: other } : { x: other, z: low + 1 };
    const key = `${axis}:${edge}:${other}`;
    if (!result.some(item => `${item.axis}:${item.edge}:${axis === "x" ? item.a.z : item.a.x}` === key))
      result.push(Object.freeze({ axis, edge, a: Object.freeze(a), b: Object.freeze(b),
        progress: (segment.start.progress + segment.end.progress) / 2, label: `${axis}-seam@${edge}` }));
  }
  return result;
}

export function riverSeamCrossing(axis: "x" | "z", ordinal = 0): RiverSeamFixture {
  return seamCandidates(axis)[ordinal] ?? fail(`no ${axis}-axis seam crossing at ordinal ${ordinal}`);
}
export function cornerNearRiverSeamCrossing(): RiverSeamFixture {
  const all = [...seamCandidates("x"), ...seamCandidates("z")];
  const ranked = all.map(seam => {
    const point = riverPointAtProgress(seam.progress), other = seam.axis === "x" ? point.z : point.x;
    return { seam, distance: Math.abs(other / CHUNK_SIZE - Math.round(other / CHUNK_SIZE)) * CHUNK_SIZE };
  }).sort((a, b) => a.distance - b.distance || a.seam.progress - b.seam.progress);
  return ranked[0]?.seam ?? fail("no corner-near seam crossing");
}

export function strongestCurvatureProgress(): number {
  let best = { progress: .5, angle: -1 };
  for (let index = 2; index < 399; index += 1) {
    const progress = index / 400, before = worldRiverSpine.sampleTangent((index - 2) / 400), after = worldRiverSpine.sampleTangent((index + 2) / 400);
    const angle = Math.acos(Math.max(-1, Math.min(1, before.x * after.x + before.z * after.z)));
    if (angle > best.angle) best = { progress, angle };
  }
  return best.progress;
}

export function dryChunkOutsideRiverInfluence(): ChunkCoordinate {
  for (let radius = 4; radius < 40; radius += 1) for (let z = -radius; z <= radius; z += 1) for (const x of [-radius, radius]) {
    const bounds = { minX: x * CHUNK_SIZE, maxX: (x + 1) * CHUNK_SIZE, minZ: z * CHUNK_SIZE, maxZ: (z + 1) * CHUNK_SIZE };
    if (!worldRiverSpine.queryRiverSegments(bounds, WORLD_RIVER_MAX_CARVING_RADIUS).length) return Object.freeze({ x, z });
  }
  return fail("unable to locate a dry chunk");
}

export function riverReachOutsideLegacyColumn(): Readonly<{ progress: number; position: { x: number; z: number }; chunk: ChunkCoordinate }> {
  for (let index = 1; index < 200; index += 1) { const progress = index / 200, position = riverPointAtProgress(progress), chunk = worldToChunk(position.x, position.z);
    if (chunk.x !== 0) return Object.freeze({ progress, position: Object.freeze(position), chunk: Object.freeze(chunk) }); }
  return fail("active river never leaves legacy column zero");
}

export function bridgeFixture(seed: number | string, accepted = false): Readonly<{ chunk: ChunkCoordinate; candidateCount: number }> {
  const visited = new Set<string>();
  for (const segment of worldRiverSpine.indexedSegments) { const chunk = worldToChunk(segment.start.x, segment.start.z), key = `${chunk.x},${chunk.z}`;
    if (visited.has(key)) continue; visited.add(key); const generated = generateBridges(seed, chunk);
    if (generated.candidates.length && (!accepted || generated.bridges.length)) return Object.freeze({ chunk: Object.freeze(chunk), candidateCount: generated.candidates.length }); }
  return fail(`no ${accepted ? "accepted bridge" : "bridge candidate"} for seed ${String(seed)}`);
}

export function poiFixture(seed: number | string, predicate: (poi: GeneratedPoi) => boolean): Readonly<{ chunk: ChunkCoordinate; poi: GeneratedPoi }> {
  for (let radius = 0; radius <= 24; radius += 1) for (let z = -radius; z <= radius; z += 1) for (let x = -radius; x <= radius; x += 1) {
    if (Math.max(Math.abs(x), Math.abs(z)) !== radius) continue;
    const poi = generatePois(seed, { x, z }).pois.find(predicate); if (poi) return Object.freeze({ chunk: Object.freeze({ x, z }), poi });
  }
  return fail(`no matching POI for seed ${String(seed)}`);
}

export function poiAdjacentRiverFixture(seed: number | string): Readonly<{ chunk: ChunkCoordinate; poi: GeneratedPoi; riverDistance: number }> {
  const chunks = new Map<string, ChunkCoordinate>();
  for (const segment of worldRiverSpine.indexedSegments.filter(item => item.index % 16 === 0)) {
    const owner = worldToChunk(segment.start.x, segment.start.z);
    for (let dz = -6; dz <= 6; dz += 1) for (let dx = -6; dx <= 6; dx += 1) {
      const chunk = { x: owner.x + dx, z: owner.z + dz }; chunks.set(`${chunk.x},${chunk.z}`, chunk);
    }
  }
  let best: { chunk: ChunkCoordinate; poi: GeneratedPoi; riverDistance: number } | undefined;
  for (const chunk of [...chunks.values()].sort((a, b) => a.z - b.z || a.x - b.x)) for (const poi of generatePois(seed, chunk).pois) {
    const riverDistance = worldRiverSpine.nearestPointToRiver(poi.position.x, poi.position.z).distanceToRiver;
    if (!best || riverDistance < best.riverDistance || riverDistance === best.riverDistance && poi.id < best.poi.id)
      best = { chunk, poi, riverDistance };
  }
  return best ? Object.freeze({ ...best, chunk: Object.freeze(best.chunk) }) : fail(`no POI adjacent to the active river for seed ${String(seed)}`);
}
