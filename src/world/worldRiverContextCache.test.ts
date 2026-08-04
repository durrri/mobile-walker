import { beforeEach, describe, expect, it } from "vitest";
import { CHUNK_SIZE } from "./chunkCoordinates";
import { sampleWorldRiverCarving } from "./worldRiverCarving";
import {
  getCachedWorldRiverCarvingContext,
  resetWorldRiverContextCache,
  WORLD_RIVER_CONTEXT_CACHE_LIMIT,
  worldRiverContextCacheSize,
} from "./worldRiverContextCache";
import { getWorldRiverOwner } from "./worldRiverOwner";
import { sampleWorldRiverGameplay } from "./worldRiverGameplay";

describe("bounded world-river context cache", () => {
  beforeEach(resetWorldRiverContextCache);

  it("bounds LRU retention without making query output depend on eviction", () => {
    const owner = getWorldRiverOwner("context-cache-a"), point = owner.spine.samplePosition(.45);
    const firstContext = getCachedWorldRiverCarvingContext(owner, point.x, point.z);
    const first = sampleWorldRiverCarving(point.x, point.z, firstContext);
    for (let index = 0; index < WORLD_RIVER_CONTEXT_CACHE_LIMIT + 80; index += 1)
      getCachedWorldRiverCarvingContext(owner, (index + 1000) * CHUNK_SIZE, -index * CHUNK_SIZE);
    expect(worldRiverContextCacheSize()).toBe(WORLD_RIVER_CONTEXT_CACHE_LIMIT);
    const revisited = getCachedWorldRiverCarvingContext(owner, point.x, point.z);
    expect(revisited).not.toBe(firstContext);
    expect(sampleWorldRiverCarving(point.x, point.z, revisited)).toEqual(first);
  });

  it("keys entries by river identity as well as coordinate", () => {
    const a = getWorldRiverOwner("context-cache-a"), b = getWorldRiverOwner("context-cache-b");
    const aContext = getCachedWorldRiverCarvingContext(a, 0, 0);
    const bContext = getCachedWorldRiverCarvingContext(b, 0, 0);
    expect(aContext).not.toBe(bContext);
    expect(aContext.spine).toBe(a.spine); expect(bContext.spine).toBe(b.spine);
    expect(worldRiverContextCacheSize()).toBe(2);
  });

  it("makes convenience and explicitly reused gameplay contexts agree", () => {
    const owner = getWorldRiverOwner("context-agreement"), point = owner.spine.samplePosition(.6);
    const context = Object.freeze({ carving: getCachedWorldRiverCarvingContext(owner, point.x, point.z) });
    expect(sampleWorldRiverGameplay("context-agreement", point.x, point.z))
      .toEqual(sampleWorldRiverGameplay("context-agreement", point.x, point.z, context));
  });
});
