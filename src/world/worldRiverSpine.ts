/** Public river ownership facade: geometry primitives plus explicit generated products. */
export * from "./riverSpineGeometry";
export * from "./worldRiverOwner";
export {
  DEFAULT_RIVER_GENERATION_CONFIG,
  PROCEDURAL_RIVER_GENERATION_VERSION,
  WORLD_RIVER_CONTROL_POINTS,
  authoredR6RiverSpine,
  generateMacroControlPoints,
  generateMeanderedControlPoints,
  generateMeanderRegions,
  sampleRegionalMeanderStrength,
  getWorldRiverGeneration,
  resetWorldRiverGenerationCaches,
  worldRiverGeneration,
  worldRiverGenerationCacheSize,
  worldRiverMacroSpine,
  worldRiverSpine,
  type MacroRiverGeneration,
  type RiverGenerationConfig,
  type RiverGenerationMode,
  type MeanderRegion,
  type MeanderRegionProfile,
  type RegionalSuitability,
} from "./worldRiverGeneration";
