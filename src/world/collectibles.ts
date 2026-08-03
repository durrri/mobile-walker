import { CHUNK_SIZE, chunkOrigin, type ChunkCoordinate } from "./chunkCoordinates";
import { chunkId } from "./chunkId";
import { isVegetationExcluded, type PoiZone } from "./poi";
import { hashFloat, normalizeSeed } from "./random";
import { sampleTerrainHeight } from "./terrainSampling";
import { createWorldRiverEnvironmentContext, decideWorldRiverObjectPlacement, type WorldRiverEnvironmentContext } from "./worldRiverEnvironment";

export interface CollectiblePlacement { readonly id: string; readonly chunkId: string; readonly x: number; readonly y: number; readonly z: number; }
const COLLECTIBLES_PER_CHUNK = 2;

export function placeCollectibles(seedInput: number | string, coordinate: ChunkCoordinate, poiZones: readonly PoiZone[] = [], riverContext?: WorldRiverEnvironmentContext): readonly CollectiblePlacement[] {
  const seed = normalizeSeed(seedInput), origin = chunkOrigin(coordinate), owner = chunkId(coordinate);
  riverContext ??= createWorldRiverEnvironmentContext({ minX: origin.x, maxX: origin.x + CHUNK_SIZE, minZ: origin.z, maxZ: origin.z + CHUNK_SIZE });
  return Array.from({ length: COLLECTIBLES_PER_CHUNK }, (_, index) => {
    const x = origin.x + 2 + hashFloat(seed, coordinate.x, coordinate.z, index, 101) * (CHUNK_SIZE - 4);
    const z = origin.z + 2 + hashFloat(seed, coordinate.x, coordinate.z, index, 211) * (CHUNK_SIZE - 4);
    return { id: `${owner}:waypoint:${index}`, chunkId: owner, x, y: sampleTerrainHeight(seed, x, z), z };
  }).filter((placement, index) => decideWorldRiverObjectPlacement({
    seed, category: "collectible", worldX: placement.x, worldZ: placement.z,
    identityX: coordinate.x * 16 + index, identityZ: coordinate.z,
    structureExcluded: isVegetationExcluded(placement.x, placement.z, poiZones), context: riverContext,
  }).accepted);
}
