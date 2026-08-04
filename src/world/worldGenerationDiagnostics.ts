import { clearBridgeGenerationCache } from "./bridges";
import { clearWorldRiverTerrainStripCache } from "./generateChunk";
import { clearPoiGenerationCaches } from "./poi";
import { clearWetlandPoolCache } from "./wetlands";
import { clearWorldRiverWaterCaches } from "./worldRiverWater";
import { resetWorldRiverGenerationCaches } from "./worldRiverGeneration";
import { resetWorldRiverOwners } from "./worldRiverOwner";
import { resetWorldRiverContextCache } from "./worldRiverContextCache";

/**
 * Clears every module-level memo used by chunk or world-river generation.
 * This supported boundary exists for deterministic tests and diagnostics only;
 * runtime streaming owns its separate resident/data cache.
 */
export function resetWorldGenerationCachesForDiagnostics(): void {
  clearPoiGenerationCaches();
  clearBridgeGenerationCache();
  clearWetlandPoolCache();
  clearWorldRiverTerrainStripCache();
  clearWorldRiverWaterCaches();
  resetWorldRiverContextCache();
}

/** Stronger reset used when byte-equivalent spine regeneration itself is under test. */
export function resetAllWorldGenerationCachesForDiagnostics(): void {
  resetWorldGenerationCachesForDiagnostics();
  resetWorldRiverOwners();
  resetWorldRiverGenerationCaches();
}
