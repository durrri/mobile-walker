import { normalizeSeed } from "./random";
import {
  DEFAULT_RIVER_GENERATION_CONFIG,
  getWorldRiverGeneration,
  type MacroRiverGeneration,
  type RiverGenerationConfig,
  type RiverGenerationMode,
} from "./worldRiverGeneration";
import type { WorldBounds2D } from "./riverSpineGeometry";

/** Session-owned, immutable river product. Construct this once beside the world seed. */
export interface WorldRiverOwner {
  readonly seed: number;
  readonly generation: MacroRiverGeneration;
  readonly macroSpine: MacroRiverGeneration["macroSpine"];
  readonly spine: MacroRiverGeneration["meanderedSpine"];
  readonly identity: string;
  context(bounds: WorldBounds2D): Readonly<{ owner: WorldRiverOwner; bounds: WorldBounds2D }>;
}

const owners = new Map<string, WorldRiverOwner>();

export function riverConfigForWorldSeed(
  seedInput: number | string,
  mode: RiverGenerationMode = "procedural-meandered",
  overrides: Partial<RiverGenerationConfig> = {},
): Readonly<RiverGenerationConfig> {
  return Object.freeze({ ...DEFAULT_RIVER_GENERATION_CONFIG, ...overrides,
    worldSeed: normalizeSeed(seedInput), mode });
}

export function getWorldRiverOwner(seedInput: number | string,
  mode: RiverGenerationMode = "procedural-meandered"): WorldRiverOwner {
  const sessionKey = `${normalizeSeed(seedInput)}:${mode}`;
  const active = owners.get(sessionKey); if (active) return active;
  const config = riverConfigForWorldSeed(seedInput, mode);
  const generation = getWorldRiverGeneration(config);
  let owner!: WorldRiverOwner;
  owner = Object.freeze({ seed: normalizeSeed(seedInput), generation,
    macroSpine: generation.macroSpine, spine: generation.meanderedSpine,
    identity: generation.cacheKey,
    context: (bounds: WorldBounds2D) => Object.freeze({ owner, bounds: Object.freeze({ ...bounds }) }),
  });
  owners.set(sessionKey, owner);
  return owner;
}

/** Tests/benchmarks only. Ordinary sessions retain their owner for their lifetime. */
export function resetWorldRiverOwners(): void { owners.clear(); }
export function worldRiverOwnerCacheSize(): number { return owners.size; }
