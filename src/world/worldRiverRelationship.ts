import {
  WORLD_RIVER_CARVING,
  WORLD_RIVER_MAX_CARVING_RADIUS,
  createWorldRiverCarvingContext,
  sampleWorldRiverCarving,
  type WorldRiverCarvingContext,
} from "./worldRiverCarving";
import { worldRiverSpine, type RiverSpine, type WorldBounds2D } from "./worldRiverSpine";

export interface WorldRiverRelationshipContext {
  readonly carving: WorldRiverCarvingContext;
  readonly bounds: WorldBounds2D;
  readonly queryRadius: number;
  readonly hasRiver: boolean;
}

/** Plain-data local frame shared by placement, navigation, and diagnostics. */
export interface WorldRiverRelationship {
  readonly nearest: Readonly<{ x: number; z: number }>;
  readonly progress: number;
  readonly distanceAlongRiver: number;
  readonly distanceToCentreline: number;
  /** Positive is deterministic river-left, using normal=(-tangent.z,tangent.x). */
  readonly signedSide: number;
  readonly tangent: Readonly<{ x: number; z: number }>;
  readonly normal: Readonly<{ x: number; z: number }>;
  readonly waterHalfWidth: number;
  readonly shorelineExtent: number;
  readonly walkableBankExtent: number;
  readonly outerInfluenceExtent: number;
  readonly distanceToWaterEdge: number;
  readonly distanceToWalkableBank: number;
  readonly landingPoint: Readonly<{ x: number; z: number }>;
  readonly segmentIndex: number;
  readonly nearEndpoint: boolean;
  readonly curvatureRadians: number;
  readonly curvatureExceedsThreshold: boolean;
}

export interface WorldRiverRelationshipOptions {
  readonly curvatureThresholdRadians?: number;
  readonly endpointDistance?: number;
}

/** One spatial-index lookup for a bounded generation region; candidates reuse it. */
export function createWorldRiverRelationshipContext(
  bounds: WorldBounds2D,
  queryRadius = WORLD_RIVER_MAX_CARVING_RADIUS,
  spine: RiverSpine = worldRiverSpine,
): WorldRiverRelationshipContext {
  const radius = Math.max(0, queryRadius);
  const segments = spine.queryRiverSegments(bounds, radius);
  const carving = spine === worldRiverSpine && radius === WORLD_RIVER_MAX_CARVING_RADIUS
    ? createWorldRiverCarvingContext(bounds, spine)
    : Object.freeze({ spine, segments, hasRiver: segments.length > 0 });
  return Object.freeze({ carving, bounds: Object.freeze({ ...bounds }), queryRadius: radius, hasRiver: carving.hasRiver });
}

export function queryWorldRiverRelationship(
  x: number,
  z: number,
  context?: WorldRiverRelationshipContext,
  options: WorldRiverRelationshipOptions = {},
): WorldRiverRelationship | undefined {
  context ??= createWorldRiverRelationshipContext({ minX: x, maxX: x, minZ: z, maxZ: z });
  if (!context.hasRiver) return undefined;
  const sample = sampleWorldRiverCarving(x, z, context.carving);
  if (!sample || sample.distanceToCentreline > context.queryRadius) return undefined;
  const spine = context.carving.spine;
  const delta = Math.min(8, spine.totalLength * 0.02);
  const before = spine.sampleFrame(spine.progressAtDistance(sample.distanceAlongRiver - delta)).tangent;
  const after = spine.sampleFrame(spine.progressAtDistance(sample.distanceAlongRiver + delta)).tangent;
  const curvatureRadians = Math.acos(Math.max(-1, Math.min(1, before.x * after.x + before.z * after.z)));
  const side = sample.signedSide >= 0 ? 1 : -1;
  const shorelineExtent = sample.lipCrestDistance;
  const walkableBankExtent = sample.waterHalfWidth + sample.bankWidth;
  const outerInfluenceExtent = walkableBankExtent + sample.falloffWidth;
  const segment = context.carving.segments.reduce((best, candidate) => {
    const contains = sample.progress >= candidate.start.progress && sample.progress <= candidate.end.progress;
    return contains && (!best || candidate.index < best.index) ? candidate : best;
  }, undefined as (typeof context.carving.segments)[number] | undefined);
  return Object.freeze({
    nearest: Object.freeze({ x: sample.nearestX, z: sample.nearestZ }),
    progress: sample.progress,
    distanceAlongRiver: sample.distanceAlongRiver,
    distanceToCentreline: sample.distanceToCentreline,
    signedSide: sample.signedSide,
    tangent: Object.freeze({ x: sample.tangentX, z: sample.tangentZ }),
    normal: Object.freeze({ x: sample.normalX, z: sample.normalZ }),
    waterHalfWidth: sample.waterHalfWidth,
    shorelineExtent,
    walkableBankExtent,
    outerInfluenceExtent,
    distanceToWaterEdge: sample.distanceToCentreline - sample.waterHalfWidth,
    distanceToWalkableBank: sample.distanceToCentreline - walkableBankExtent,
    landingPoint: Object.freeze({
      x: sample.nearestX + sample.normalX * side * shorelineExtent,
      z: sample.nearestZ + sample.normalZ * side * shorelineExtent,
    }),
    segmentIndex: segment?.index ?? -1,
    nearEndpoint: sample.distanceAlongRiver <= (options.endpointDistance ?? 10)
      || spine.totalLength - sample.distanceAlongRiver <= (options.endpointDistance ?? 10),
    curvatureRadians,
    curvatureExceedsThreshold: curvatureRadians > (options.curvatureThresholdRadians ?? Number.POSITIVE_INFINITY),
  });
}

/** Largest controlled river extent, useful for explicit POI footprint clearances. */
export const WORLD_RIVER_POI_ENVIRONMENT = Object.freeze({
  water: WORLD_RIVER_CARVING.waterHalfWidth,
  shoreline: WORLD_RIVER_CARVING.waterHalfWidth + WORLD_RIVER_CARVING.shoreTransitionWidth,
  walkableBank: WORLD_RIVER_CARVING.waterHalfWidth + WORLD_RIVER_CARVING.bankWidth,
  outerInfluence: WORLD_RIVER_MAX_CARVING_RADIUS,
});
