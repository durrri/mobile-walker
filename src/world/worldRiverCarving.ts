import {
  worldRiverSpine,
  type RiverIndexedSegment,
  type RiverSpine,
  type WorldBounds2D,
} from "./worldRiverSpine";

/** Temporary constant-width R3 tuning. Width variation belongs to a later milestone. */
export const WORLD_RIVER_CARVING = Object.freeze({
  halfWidth: 2,
  bankWidth: 1.25,
  falloffWidth: 2.25,
  bedDepth: 0.55,
  floorCurvature: 0.08,
  upstreamBedElevation: -0.18,
  downstreamBedElevation: -0.92,
});

export const WORLD_RIVER_MAX_CARVING_RADIUS =
  WORLD_RIVER_CARVING.halfWidth + WORLD_RIVER_CARVING.bankWidth + WORLD_RIVER_CARVING.falloffWidth;

export interface WorldRiverCarvingContext {
  readonly spine: RiverSpine;
  readonly segments: readonly RiverIndexedSegment[];
  readonly hasRiver: boolean;
}

export interface WorldRiverCarvingSample {
  readonly nearestX: number;
  readonly nearestZ: number;
  readonly progress: number;
  readonly distanceAlongRiver: number;
  readonly distanceToCentreline: number;
  readonly signedSide: number;
  readonly tangentX: number;
  readonly tangentZ: number;
  readonly normalX: number;
  readonly normalZ: number;
  readonly halfWidth: number;
  readonly bankWidth: number;
  readonly falloffWidth: number;
  readonly channelInfluence: number;
  readonly bankInfluence: number;
  readonly targetBedHeight: number;
  readonly bedOffset: number;
  readonly finalCarveAmount: number;
  readonly insideChannel: boolean;
  readonly insideCarvingFalloff: boolean;
}

const smoothstep = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** One indexed query per terrain region; an empty result is an explicit fast path. */
export function createWorldRiverCarvingContext(
  bounds: WorldBounds2D,
  spine: RiverSpine = worldRiverSpine,
): WorldRiverCarvingContext {
  const segments = spine.queryRiverSegments(bounds, WORLD_RIVER_MAX_CARVING_RADIUS);
  return Object.freeze({ spine, segments, hasRiver: segments.length > 0 });
}

function nearestOnSegments(
  worldX: number,
  worldZ: number,
  context: WorldRiverCarvingContext,
): { segment: RiverIndexedSegment; t: number; squared: number } | undefined {
  let result: { segment: RiverIndexedSegment; t: number; squared: number } | undefined;
  for (const segment of context.segments) {
    const dx = segment.end.x - segment.start.x;
    const dz = segment.end.z - segment.start.z;
    const t = Math.max(0, Math.min(1,
      ((worldX - segment.start.x) * dx + (worldZ - segment.start.z) * dz) / (dx * dx + dz * dz || 1),
    ));
    const squared = (worldX - segment.start.x - dx * t) ** 2 + (worldZ - segment.start.z - dz * t) ** 2;
    if (!result || squared < result.squared || (squared === result.squared && segment.index < result.segment.index)) {
      result = { segment, t, squared };
    }
  }
  return result;
}

/**
 * Samples the presentation-neutral world field. The cross-section is a gently
 * curved floor, a smooth inner-bank transition, then a smooth outer falloff.
 */
export function sampleWorldRiverCarving(
  worldX: number,
  worldZ: number,
  context?: WorldRiverCarvingContext,
): WorldRiverCarvingSample | undefined {
  // Random-access gameplay/debug sampling uses the spatial index too. Chunk
  // generation supplies its reusable region context and avoids this allocation.
  context ??= createWorldRiverCarvingContext({ minX: worldX, maxX: worldX, minZ: worldZ, maxZ: worldZ });
  if (!context.hasRiver) return undefined;
  const nearest = nearestOnSegments(worldX, worldZ, context);
  if (!nearest) return undefined;
  const { segment, t } = nearest;
  const dx = segment.end.x - segment.start.x;
  const dz = segment.end.z - segment.start.z;
  const length = Math.hypot(dx, dz) || 1;
  const tangentX = dx / length, tangentZ = dz / length;
  const normalX = -tangentZ, normalZ = tangentX;
  const nearestX = segment.start.x + dx * t, nearestZ = segment.start.z + dz * t;
  const signedSide = (worldX - nearestX) * normalX + (worldZ - nearestZ) * normalZ;
  const distanceToCentreline = Math.sqrt(nearest.squared);
  const progress = segment.start.progress + (segment.end.progress - segment.start.progress) * t;
  const { halfWidth, bankWidth, falloffWidth, bedDepth, floorCurvature,
    upstreamBedElevation, downstreamBedElevation } = WORLD_RIVER_CARVING;
  const innerEnd = halfWidth + bankWidth;
  const outerEnd = innerEnd + falloffWidth;
  const channelInfluence = distanceToCentreline <= halfWidth
    ? 1
    : 1 - 0.65 * smoothstep((distanceToCentreline - halfWidth) / bankWidth);
  const bankInfluence = distanceToCentreline <= innerEnd
    ? 1
    : 1 - smoothstep((distanceToCentreline - innerEnd) / falloffWidth);
  const influence = distanceToCentreline <= outerEnd ? channelInfluence * bankInfluence : 0;
  // A single module-initialized, continuous downstream grade is deliberately
  // independent of chunks and seeds. R3 does not attempt physical hydrology.
  const centreBed = upstreamBedElevation + (downstreamBedElevation - upstreamBedElevation) * progress;
  const floorShape = floorCurvature * bedDepth * Math.min(1, distanceToCentreline / halfWidth) ** 2;
  const targetBedHeight = centreBed - bedDepth + floorShape;
  return {
    nearestX, nearestZ, progress, distanceAlongRiver: progress * context.spine.totalLength,
    distanceToCentreline, signedSide, tangentX, tangentZ, normalX, normalZ,
    halfWidth, bankWidth, falloffWidth, channelInfluence, bankInfluence,
    targetBedHeight, bedOffset: -bedDepth, finalCarveAmount: bedDepth * influence,
    insideChannel: distanceToCentreline <= halfWidth,
    insideCarvingFalloff: distanceToCentreline <= outerEnd,
  };
}

/** The sole R3 carving formula: never raises terrain, and is C1 at all profile boundaries. */
export function applyWorldRiverCarving(baseHeight: number, sample: WorldRiverCarvingSample | undefined): number {
  if (!sample || !sample.insideCarvingFalloff) return baseHeight;
  const influence = sample.insideCarvingFalloff ? sample.channelInfluence * sample.bankInfluence : 0;
  return baseHeight + (Math.min(baseHeight, sample.targetBedHeight) - baseHeight) * influence;
}
