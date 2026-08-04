import { hashFloat, normalizeSeed } from "./random";
import {
  createWorldRiverCarvingContext,
  sampleWorldRiverCarving,
  WORLD_RIVER_CARVING,
  WORLD_RIVER_LIP_CREST_DISTANCE,
  WORLD_RIVER_MAX_CARVING_RADIUS,
  type WorldRiverCarvingContext,
} from "./worldRiverCarving";
import { referenceWorldRiverSpine, type RiverSpine, type WorldBounds2D } from "./worldRiverSpine";

/** Ecological placement bands. Outer falloff deliberately delegates to biome rules. */
export type WorldRiverPlacementZone =
  | "water"
  | "shoreTransition"
  | "walkableBank"
  | "outerFalloff"
  | "outsideRiverInfluence";

export interface WorldRiverEnvironmentSample {
  readonly zone: WorldRiverPlacementZone;
  readonly distanceToCentreline: number;
  readonly signedSide: number;
  readonly signedDistanceToWaterEdge: number;
  readonly distanceToLipCrest: number;
  readonly distanceToInnerBankEnd: number;
  readonly progress: number;
  readonly distanceAlongRiver: number;
  readonly withinWater: boolean;
  readonly withinMostlyClearShoreline: boolean;
  readonly withinWalkableBank: boolean;
}

export interface WorldRiverEnvironmentContext {
  readonly carving: WorldRiverCarvingContext;
  readonly hasRiver: boolean;
}

export type RiverObjectCategory =
  | "tree"
  | "largeShrub"
  | "largeRock"
  | "smallRock"
  | "tinyVegetation"
  | "collectible"
  | "wetlandPool"
  | "decorativeProp";

export const RIVER_PLACEMENT_TUNING = Object.freeze({
  shoreTinyVegetationSurvival: 0.1,
  walkableBankSmallRockSurvival: 0.22,
});

/** Modest physical/visual clearance; trees use neither a point nor the full canopy. */
export const RIVER_OBJECT_CLEARANCE: Readonly<Record<RiverObjectCategory, number>> = Object.freeze({
  tree: 0.65,
  largeShrub: 0.4,
  largeRock: 0.55,
  smallRock: 0.18,
  tinyVegetation: 0,
  collectible: 0.2,
  wetlandPool: 0.7,
  decorativeProp: 0.35,
});

export const MAX_RIVER_OBJECT_CLEARANCE = Math.max(...Object.values(RIVER_OBJECT_CLEARANCE));

export function createWorldRiverEnvironmentContext(
  bounds: WorldBounds2D,
  spine: RiverSpine = referenceWorldRiverSpine,
): WorldRiverEnvironmentContext {
  const padding = MAX_RIVER_OBJECT_CLEARANCE;
  const carving = createWorldRiverCarvingContext({
    minX: bounds.minX - padding, maxX: bounds.maxX + padding,
    minZ: bounds.minZ - padding, maxZ: bounds.maxZ + padding,
  }, spine);
  return Object.freeze({ carving, hasRiver: carving.hasRiver });
}

/** Pure, presentation-neutral classification derived only from carving landmarks. */
export function sampleWorldRiverEnvironment(
  worldX: number,
  worldZ: number,
  context?: WorldRiverEnvironmentContext,
): WorldRiverEnvironmentSample {
  const carving = sampleWorldRiverCarving(worldX, worldZ, context?.carving);
  const distance = carving?.distanceToCentreline ?? Infinity;
  const innerBankEnd = WORLD_RIVER_CARVING.waterHalfWidth + WORLD_RIVER_CARVING.bankWidth;
  let zone: WorldRiverPlacementZone = "outsideRiverInfluence";
  if (distance <= WORLD_RIVER_CARVING.waterHalfWidth) zone = "water";
  else if (distance <= WORLD_RIVER_LIP_CREST_DISTANCE) zone = "shoreTransition";
  else if (distance <= innerBankEnd) zone = "walkableBank";
  else if (distance <= WORLD_RIVER_MAX_CARVING_RADIUS) zone = "outerFalloff";
  return {
    zone,
    distanceToCentreline: distance,
    signedSide: carving?.signedSide ?? 0,
    signedDistanceToWaterEdge: distance - WORLD_RIVER_CARVING.waterHalfWidth,
    distanceToLipCrest: distance - WORLD_RIVER_LIP_CREST_DISTANCE,
    distanceToInnerBankEnd: distance - innerBankEnd,
    progress: carving?.progress ?? 0,
    distanceAlongRiver: carving?.distanceAlongRiver ?? 0,
    withinWater: zone === "water",
    withinMostlyClearShoreline: zone === "shoreTransition",
    withinWalkableBank: zone === "walkableBank",
  };
}

export type RiverPlacementReason = "structure" | "water" | "shoreTransition" | "walkableBank" | "thinned";
export interface RiverPlacementDecision {
  readonly accepted: boolean;
  readonly zone: WorldRiverPlacementZone;
  readonly reason?: RiverPlacementReason;
}

const categorySalt: Record<RiverObjectCategory, number> = {
  tree: 2601, largeShrub: 2611, largeRock: 2621, smallRock: 2631,
  tinyVegetation: 2641, collectible: 2651, wetlandPool: 2661, decorativeProp: 2671,
};

/**
 * Composable structure -> river policy. A footprint is represented by moving
 * its nearest edge toward the centreline; this is rotation and chunk agnostic.
 */
export function decideWorldRiverObjectPlacement(options: Readonly<{
  seed: number | string;
  category: RiverObjectCategory;
  worldX: number;
  worldZ: number;
  identityX?: number;
  identityZ?: number;
  footprintClearance?: number;
  structureExcluded?: boolean;
  context?: WorldRiverEnvironmentContext;
}>): RiverPlacementDecision {
  if (options.structureExcluded) return { accepted: false, zone: "outsideRiverInfluence", reason: "structure" };
  if (options.context && !options.context.hasRiver) return { accepted: true, zone: "outsideRiverInfluence" };
  const sample = sampleWorldRiverEnvironment(options.worldX, options.worldZ, options.context);
  const clearance = options.footprintClearance ?? RIVER_OBJECT_CLEARANCE[options.category];
  const effectiveDistance = Math.max(0, sample.distanceToCentreline - clearance);
  const innerEnd = WORLD_RIVER_CARVING.waterHalfWidth + WORLD_RIVER_CARVING.bankWidth;
  const zone: WorldRiverPlacementZone = effectiveDistance <= WORLD_RIVER_CARVING.waterHalfWidth ? "water"
    : effectiveDistance <= WORLD_RIVER_LIP_CREST_DISTANCE ? "shoreTransition"
      : effectiveDistance <= innerEnd ? "walkableBank"
        : effectiveDistance <= WORLD_RIVER_MAX_CARVING_RADIUS ? "outerFalloff" : "outsideRiverInfluence";
  if (zone === "outerFalloff" || zone === "outsideRiverInfluence") return { accepted: true, zone };
  if (zone === "water") return { accepted: false, zone, reason: "water" };
  const large = options.category === "tree" || options.category === "largeShrub"
    || options.category === "largeRock" || options.category === "decorativeProp";
  if (zone === "shoreTransition") {
    if (options.category !== "tinyVegetation") return { accepted: false, zone, reason: "shoreTransition" };
    const survives = hashFloat(normalizeSeed(options.seed), options.identityX ?? options.worldX,
      options.identityZ ?? options.worldZ, categorySalt[options.category]) < RIVER_PLACEMENT_TUNING.shoreTinyVegetationSurvival;
    return { accepted: survives, zone, reason: survives ? undefined : "thinned" };
  }
  if (large) return { accepted: false, zone, reason: "walkableBank" };
  if (options.category === "smallRock") {
    const survives = hashFloat(normalizeSeed(options.seed), options.identityX ?? options.worldX,
      options.identityZ ?? options.worldZ, categorySalt[options.category]) < RIVER_PLACEMENT_TUNING.walkableBankSmallRockSurvival;
    return { accepted: survives, zone, reason: survives ? undefined : "thinned" };
  }
  return { accepted: true, zone };
}
