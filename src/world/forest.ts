import type { ChunkCoordinate } from "./chunkCoordinates";
import type { PoiZone } from "./poi";
import type { WorldRiverEnvironmentContext } from "./worldRiverEnvironment";
import {
  generateVegetationKind,
  sampleForestDensity,
  treeChance,
  TREE_TRUNK_RADIUS,
  type VegetationPlacement,
} from "./vegetation";

/** @deprecated Prefer VegetationPlacement and generateVegetationKind("pine", ...). */
export type TreePlacement = VegetationPlacement;

/** Compatibility wrapper for callers that render pines separately. */
export function generateTrees(seed: number | string, coordinate: ChunkCoordinate, exclusions: readonly PoiZone[] = [], riverContext?: WorldRiverEnvironmentContext): readonly TreePlacement[] {
  return generateVegetationKind("pine", seed, coordinate, exclusions, riverContext);
}

export { sampleForestDensity, treeChance, TREE_TRUNK_RADIUS };
