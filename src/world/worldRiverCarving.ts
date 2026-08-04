import {
  referenceWorldRiverSpine,
  type RiverIndexedSegment,
  type RiverSpine,
  type WorldBounds2D,
} from "./worldRiverSpine";
import { createRiverWidthProfile, RIVER_WIDTH_CONFIG, sampleRiverWidth, type RiverWidthProfile } from "./worldRiverWidth";
import { DEFAULT_RIVER_GENERATION_CONFIG } from "./worldRiverGeneration";

/** One shared footprint consumed by water tessellation, terrain, queries, and debug guides. */
export const WORLD_RIVER_WATER_HALF_WIDTH = 2;

/** Constant-width R4.5 cross-section tuning. */
export const WORLD_RIVER_CARVING = Object.freeze({
  waterHalfWidth: WORLD_RIVER_WATER_HALF_WIDTH,
  /** @deprecated Compatibility alias; new code should name the rendered water footprint explicitly. */
  halfWidth: WORLD_RIVER_WATER_HALF_WIDTH,
  bankWidth: 1.25,
  falloffWidth: 2.25,
  /** One world-space datum for the entire R3 river. */
  surfaceElevation: -0.18,
  nominalBedDepth: 0.55,
  floorCurvature: 0.08,
  /** Bed clearance at the rendered water edge; all channel terrain stays submerged. */
  shoreClearance: 0.05,
  /** Land-side rise between the rendered water edge and raised lip crest. */
  shoreTransitionWidth: 0.2,
  /** Authoritative dry-ground crest outside the rendered water boundary. */
  lipHeight: 0.12,
  /** Gentle rise across the walkable inner bank before natural terrain resumes. */
  innerBankRise: 0.28,
});

export const WORLD_RIVER_MAX_CARVING_RADIUS =
  RIVER_WIDTH_CONFIG.maximumWidth / 2 + WORLD_RIVER_CARVING.bankWidth + WORLD_RIVER_CARVING.falloffWidth;

export const WORLD_RIVER_LIP_CREST_DISTANCE =
  WORLD_RIVER_CARVING.waterHalfWidth + WORLD_RIVER_CARVING.shoreTransitionWidth;
export const WORLD_RIVER_INNER_BANK_WIDTH =
  WORLD_RIVER_CARVING.bankWidth - WORLD_RIVER_CARVING.shoreTransitionWidth;

/** Nominal average rises; smoothstep has zero slope at every controlled boundary. */
export const WORLD_RIVER_NOMINAL_SLOPES = Object.freeze({
  submergedShore: (
    WORLD_RIVER_CARVING.nominalBedDepth - WORLD_RIVER_CARVING.shoreClearance
    - WORLD_RIVER_CARVING.floorCurvature * WORLD_RIVER_CARVING.nominalBedDepth * 0.55 ** 2
  ) / (WORLD_RIVER_CARVING.waterHalfWidth * 0.45),
  landSideShore: (WORLD_RIVER_CARVING.lipHeight + WORLD_RIVER_CARVING.shoreClearance)
    / WORLD_RIVER_CARVING.shoreTransitionWidth,
  innerBank: WORLD_RIVER_CARVING.innerBankRise / WORLD_RIVER_INNER_BANK_WIDTH,
});

/** Authoritative profile for the exported reference world used by compatibility fixtures. */
let retainedReferenceWidthProfile:RiverWidthProfile|undefined;
export function getReferenceRiverWidthProfile():RiverWidthProfile{
  return retainedReferenceWidthProfile??=createRiverWidthProfile(DEFAULT_RIVER_GENERATION_CONFIG.worldSeed,referenceWorldRiverSpine);
}

export interface WorldRiverCarvingContext {
  readonly spine: RiverSpine;
  readonly widthProfile: RiverWidthProfile;
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
  readonly waterHalfWidth: number;
  readonly lipCrestDistance: number;
  readonly bankWidth: number;
  readonly falloffWidth: number;
  readonly channelInfluence: number;
  readonly bankInfluence: number;
  readonly targetBedHeight: number;
  readonly targetBankHeight: number;
  readonly surfaceElevation: number;
  readonly nominalBedDepth: number;
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
  spine: RiverSpine = referenceWorldRiverSpine,
  widthProfile?: RiverWidthProfile,
): WorldRiverCarvingContext {
  widthProfile ??= spine === referenceWorldRiverSpine ? getReferenceRiverWidthProfile() : undefined;
  if (!widthProfile) throw new Error("Authoritative river width profile is required for a non-reference spine");
  if (widthProfile.spine !== spine) throw new Error("River carving context width profile/spine identity mismatch");
  const segments = spine.queryRiverSegments(bounds, WORLD_RIVER_MAX_CARVING_RADIUS);
  return Object.freeze({ spine, widthProfile, segments, hasRiver: segments.length > 0 });
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
  const coarseProgress = segment.start.progress + (segment.end.progress - segment.start.progress) * t;
  let low = segment.start.progress, high = segment.end.progress;
  const squaredAt = (candidate: number): number => {
    const point = context.spine.samplePosition(candidate);
    return (worldX - point.x) ** 2 + (worldZ - point.z) ** 2;
  };
  for (let iteration = 0; iteration < 6; iteration++) {
    const third = (high - low) / 3, a = low + third, b = high - third;
    if (squaredAt(a) <= squaredAt(b)) high = b; else low = a;
  }
  let progress = (low + high) / 2;
  if (squaredAt(coarseProgress) < squaredAt(progress)) progress = coarseProgress;
  const frame = context.spine.sampleFrame(progress);
  const tangentX = frame.tangent.x, tangentZ = frame.tangent.z;
  const normalX = -tangentZ, normalZ = tangentX;
  const nearestX = frame.position.x, nearestZ = frame.position.z;
  const signedSide = (worldX - nearestX) * normalX + (worldZ - nearestZ) * normalZ;
  const distanceToCentreline = Math.hypot(worldX - nearestX, worldZ - nearestZ);
  const { bankWidth, falloffWidth, surfaceElevation, nominalBedDepth, floorCurvature,
    shoreClearance, shoreTransitionWidth, lipHeight, innerBankRise } =
    WORLD_RIVER_CARVING;
  const waterHalfWidth = sampleRiverWidth(context.widthProfile, progress * context.spine.totalLength, context.spine).halfWidth;
  const halfWidth = waterHalfWidth;
  const lipCrestDistance = waterHalfWidth + shoreTransitionWidth;
  const innerBankWidth = bankWidth - shoreTransitionWidth;
  const innerEnd = waterHalfWidth + bankWidth;
  const outerEnd = innerEnd + falloffWidth;
  const channelInfluence = distanceToCentreline <= halfWidth ? 1 : 0;
  const bankInfluence = distanceToCentreline <= innerEnd
    ? 1
    : 1 - smoothstep((distanceToCentreline - innerEnd) / falloffWidth);
  // R3 intentionally uses one absolute world datum rather than a downstream
  // grade, which currently adds little gameplay value: elevated terrain can
  // become a deep canyon, while low terrain is never raised. Future waterfalls
  // may split the river into explicit
  // constant-elevation reaches, but multiple reaches are outside this scope.
  const centreBedElevation = surfaceElevation - nominalBedDepth;
  const floorShape = floorCurvature * nominalBedDepth * Math.min(1, distanceToCentreline / halfWidth) ** 2;
  const deepBedHeight = centreBedElevation + floorShape;
  // The submerged rise ends below the rendered ribbon. Nominal average slopes
  // are ~0.54 submerged, 0.85 across dry shore, and 0.27 on the inner bank.
  const submergedBank = smoothstep(Math.max(0,
    (distanceToCentreline / waterHalfWidth - 0.55) / 0.45));
  const waterEdgeBedHeight = surfaceElevation - shoreClearance;
  const targetBedHeight = deepBedHeight
    + (waterEdgeBedHeight - deepBedHeight) * submergedBank;
  const landDistance = Math.max(0, distanceToCentreline - waterHalfWidth);
  const lipHeightAbsolute = surfaceElevation + lipHeight;
  const targetBankHeight = landDistance <= shoreTransitionWidth
    ? waterEdgeBedHeight + (lipHeightAbsolute - waterEdgeBedHeight)
      * smoothstep(landDistance / shoreTransitionWidth)
    : lipHeightAbsolute + innerBankRise
      * smoothstep((landDistance - shoreTransitionWidth) / innerBankWidth);
  return {
    nearestX, nearestZ, progress, distanceAlongRiver: progress * context.spine.totalLength,
    distanceToCentreline, signedSide, tangentX, tangentZ, normalX, normalZ,
    halfWidth, waterHalfWidth, lipCrestDistance, bankWidth, falloffWidth, channelInfluence, bankInfluence,
    targetBedHeight, targetBankHeight, surfaceElevation, nominalBedDepth,
    insideChannel: distanceToCentreline <= halfWidth,
    insideCarvingFalloff: distanceToCentreline <= outerEnd,
  };
}

/** R4.5 authoritative bed, raised lip, walkable bank, and C1 natural-terrain blend. */
export function applyWorldRiverCarving(baseHeight: number, sample: WorldRiverCarvingSample | undefined): number {
  if (!sample || !sample.insideCarvingFalloff) return baseHeight;
  if (sample.insideChannel) return sample.targetBedHeight;
  const landDistance = sample.distanceToCentreline - sample.halfWidth;
  if (landDistance <= sample.bankWidth) return sample.targetBankHeight;
  return baseHeight + (sample.targetBankHeight - baseHeight) * sample.bankInfluence;
}
