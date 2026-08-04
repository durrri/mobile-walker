import { CHUNK_SIZE } from "./chunkCoordinates";
import { createWorldRiverCarvingContext, type WorldRiverCarvingContext } from "./worldRiverCarving";
import type { WorldRiverOwner } from "./worldRiverOwner";

/** One bounded, process-wide owner for convenience point-query contexts. */
export const WORLD_RIVER_CONTEXT_CACHE_LIMIT = 256;
const contexts = new Map<string, WorldRiverCarvingContext>();

export function getCachedWorldRiverCarvingContext(
  owner: WorldRiverOwner,
  worldX: number,
  worldZ: number,
): WorldRiverCarvingContext {
  const chunkX = Math.floor(worldX / CHUNK_SIZE), chunkZ = Math.floor(worldZ / CHUNK_SIZE);
  const key = `${owner.identity}:${chunkX},${chunkZ}`;
  const retained = contexts.get(key);
  if (retained) {
    contexts.delete(key); contexts.set(key, retained);
    return retained;
  }
  const context = createWorldRiverCarvingContext({
    minX: chunkX * CHUNK_SIZE, maxX: (chunkX + 1) * CHUNK_SIZE,
    minZ: chunkZ * CHUNK_SIZE, maxZ: (chunkZ + 1) * CHUNK_SIZE,
  }, owner.spine);
  contexts.set(key, context);
  while (contexts.size > WORLD_RIVER_CONTEXT_CACHE_LIMIT) contexts.delete(contexts.keys().next().value!);
  return context;
}

export function worldRiverContextCacheSize(): number { return contexts.size; }
export function resetWorldRiverContextCache(): void { contexts.clear(); }
