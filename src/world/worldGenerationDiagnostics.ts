import { clearBridgeGenerationCache } from "./bridges";
import { clearWorldRiverTerrainStripCache } from "./generateChunk";
import { clearPoiGenerationCaches } from "./poi";
import { clearWetlandPoolCache } from "./wetlands";
import { clearWorldRiverWaterCaches } from "./worldRiverWater";

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
}
