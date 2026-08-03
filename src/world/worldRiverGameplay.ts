import { sampleChannelTerrainHeightInContext, sampleTerrainHeight } from "./terrainSampling";
import {
  createWorldRiverCarvingContext,
  sampleWorldRiverCarving,
  WORLD_RIVER_CARVING,
  type WorldRiverCarvingContext,
} from "./worldRiverCarving";
import { sampleWorldRiverEnvironment, type WorldRiverPlacementZone } from "./worldRiverEnvironment";
import { worldRiverSpine, type RiverSpine, type WorldBounds2D } from "./worldRiverSpine";
import { normalizeSeed } from "./random";

export interface WorldRiverGameplayContext { readonly carving: WorldRiverCarvingContext }

export interface WorldRiverGameplaySample {
  readonly zone: WorldRiverPlacementZone;
  readonly insideWater: boolean;
  readonly insideSubmergedChannel: boolean;
  readonly insideShoreTransition: boolean;
  readonly insideWalkableBank: boolean;
  readonly outsideRiverInfluence: boolean;
  readonly signedDistanceToWaterEdge: number;
  readonly terrainElevation: number;
  readonly waterSurfaceElevation: number;
  readonly waterDepth: number;
  readonly riverProgress: number;
  readonly distanceAlongRiver: number;
  readonly nearestRiverPoint: Readonly<{ x: number; z: number }> | undefined;
  readonly tangent: Readonly<{ x: number; z: number }> | undefined;
  readonly normal: Readonly<{ x: number; z: number }> | undefined;
}

/** Builds a reusable indexed context for hot movement or bounded safety scans. */
export function createWorldRiverGameplayContext(bounds: WorldBounds2D, spine: RiverSpine = worldRiverSpine): WorldRiverGameplayContext {
  return Object.freeze({ carving: createWorldRiverCarvingContext(bounds, spine) });
}

/** Pure gameplay view of the same indexed relationship and carved terrain used by rendering/generation. */
export function sampleWorldRiverGameplay(seed: number | string, x: number, z: number, context?: WorldRiverGameplayContext): WorldRiverGameplaySample {
  const carving = sampleWorldRiverCarving(x, z, context?.carving);
  const environment = sampleWorldRiverEnvironment(x, z, context && { carving: context.carving, hasRiver: context.carving.hasRiver });
  const terrainElevation = context && carving?.insideCarvingFalloff
    ? sampleChannelTerrainHeightInContext(normalizeSeed(seed), x, z, context.carving)
    : sampleTerrainHeight(seed, x, z);
  const surface = carving?.surfaceElevation ?? WORLD_RIVER_CARVING.surfaceElevation;
  return {
    zone: environment.zone,
    insideWater: environment.withinWater,
    insideSubmergedChannel: carving?.insideChannel ?? false,
    insideShoreTransition: environment.zone === "shoreTransition",
    insideWalkableBank: environment.withinWalkableBank,
    outsideRiverInfluence: environment.zone === "outsideRiverInfluence",
    signedDistanceToWaterEdge: environment.signedDistanceToWaterEdge,
    terrainElevation,
    waterSurfaceElevation: surface,
    waterDepth: environment.withinWater ? Math.max(0, surface - terrainElevation) : 0,
    riverProgress: carving?.progress ?? 0,
    distanceAlongRiver: carving?.distanceAlongRiver ?? 0,
    nearestRiverPoint: carving ? { x: carving.nearestX, z: carving.nearestZ } : undefined,
    tangent: carving ? { x: carving.tangentX, z: carving.tangentZ } : undefined,
    normal: carving ? { x: carving.normalX, z: carving.normalZ } : undefined,
  };
}

export function isInsideWorldRiverWater(x: number, z: number, context?: WorldRiverGameplayContext): boolean {
  return sampleWorldRiverEnvironment(x, z, context && { carving: context.carving, hasRiver: context.carving.hasRiver }).withinWater;
}
