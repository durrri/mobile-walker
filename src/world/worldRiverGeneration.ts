import { hashFloat, normalizeSeed } from "./random";
import { authoredR6RiverSpine, RiverSpine, type RiverControlPoint, type WorldBounds2D } from "./riverSpineGeometry";

export type RiverGenerationMode = "authored-r6" | "procedural-macro" | "procedural-meandered";

/** Every geometry-affecting R7/R8 value lives in this immutable, cache-keyed record. */
export interface RiverGenerationConfig {
  readonly generationVersion: number;
  readonly worldSeed: number | string;
  readonly mode: RiverGenerationMode;
  readonly bounds: WorldBounds2D;
  readonly macroWaypointSpacing: number;
  readonly lateralMacroVariation: number;
  readonly macroCurvatureLimit: number;
  readonly minSegmentLength: number;
  readonly maxSegmentLength: number;
  readonly selfSeparationDistance: number;
  readonly endpointProtectionDistance: number;
  readonly meanderWavelengthRange: readonly [number, number];
  readonly meanderAmplitudeRange: readonly [number, number];
  readonly curvatureGuard: number;
  readonly resamplingSpacing: number;
  /** Stable identifier for an optional future terrain/biome suitability provider. */
  readonly regionalSuitabilityId: string;
}

export type MeanderRegionProfile = "gentle" | "strong";
export interface MeanderRegion {
  readonly startDistance: number;
  readonly endDistance: number;
  readonly fadeInDistance: number;
  readonly fadeOutDistance: number;
  readonly strength: number;
  readonly profile: MeanderRegionProfile;
  readonly targetWavelength: number;
  readonly targetBendRadius: number;
  readonly correctionApplied: boolean;
  readonly correctionReasons?: readonly RiverCorrectionReason[];
}
export type RiverCorrectionReason = "macro-segment-length" | "macro-curvature" | "outside-bounds" | "self-separation" | "final-curvature" | "non-finite-frame" | "fallback-straight";
export type RegionalSuitability = (macroDistance: number, macroLength: number) => number;

export const PROCEDURAL_RIVER_GENERATION_VERSION = 8;
export const DEFAULT_RIVER_GENERATION_CONFIG: Readonly<RiverGenerationConfig> = Object.freeze({
  generationVersion: PROCEDURAL_RIVER_GENERATION_VERSION,
  worldSeed: 0x52495645,
  mode: "procedural-meandered",
  bounds: Object.freeze({ minX: -96, maxX: 96, minZ: -128, maxZ: 128 }),
  macroWaypointSpacing: 32,
  lateralMacroVariation: 42,
  macroCurvatureLimit: 0.075,
  minSegmentLength: 24,
  maxSegmentLength: 48,
  selfSeparationDistance: 14,
  endpointProtectionDistance: 32,
  meanderWavelengthRange: Object.freeze([48, 80] as const),
  meanderAmplitudeRange: Object.freeze([3, 7] as const),
  curvatureGuard: 0.12,
  resamplingSpacing: 2,
  regionalSuitabilityId: "uniform-v1",
});

export interface MacroRiverGeneration {
  readonly cacheKey: string;
  readonly config: Readonly<RiverGenerationConfig>;
  readonly macroControlPoints: readonly RiverControlPoint[];
  readonly macroResampledPoints: readonly RiverControlPoint[];
  readonly macroSpine: RiverSpine;
  readonly meanderedControlPoints: readonly RiverControlPoint[];
  readonly meanderedResampledPoints: readonly RiverControlPoint[];
  readonly meanderedSpine: RiverSpine;
  readonly sourceMacroCacheKey: string;
  readonly meanderAmplitude: number;
  readonly meanderWavelength: number;
  readonly correctionApplied: boolean;
  readonly meanderRegions: readonly MeanderRegion[];
  readonly usedFallback: boolean;
  readonly correctionReasons: readonly RiverCorrectionReason[];
  readonly measuredMinimumBendRadius: number;
}

const cache = new Map<string, MacroRiverGeneration>();
const stableConfigKey = (config: RiverGenerationConfig): string => JSON.stringify(config);

/**
 * Corridor-constrained R7 path. Fixed forward Z stations enforce progress, separation,
 * clean boundary entry and termination. Seeded lateral targets are relaxed twice,
 * bounding heading changes without retries; the deterministic straight interpolation
 * is the documented fallback should validation ever reject the relaxed polygon.
 */
export function generateMacroControlPoints(config: RiverGenerationConfig): readonly RiverControlPoint[] {
  const seed = normalizeSeed(config.worldSeed) ^ config.generationVersion;
  const span = config.bounds.maxZ - config.bounds.minZ;
  const count = Math.max(2, Math.round(span / config.macroWaypointSpacing));
  const values = Array.from({ length: count + 1 }, (_, index) => {
    if (index === 0 || index === count) return 0;
    const envelope = Math.sin(Math.PI * index / count) ** 2;
    const phase = hashFloat(seed, 7108) * Math.PI * 2;
    const broadTurn = Math.sin(index / count * Math.PI * 2 + phase) * .65;
    const seeded = (hashFloat(seed, index, 7107) * 2 - 1) * .35;
    return (broadTurn + seeded) * config.lateralMacroVariation * envelope;
  });
  for (let pass = 0; pass < 2; pass += 1) {
    const before = [...values];
    for (let index = 2; index < count - 1; index += 1) values[index] = before[index - 1]! * .25 + before[index]! * .5 + before[index + 1]! * .25;
  }
  return Object.freeze(values.map((x, index) => Object.freeze({ x, z: config.bounds.maxZ - span * index / count })));
}

function segmentLengths(points: readonly RiverControlPoint[]): number[] {
  return points.slice(1).map((point, index) => Math.hypot(point.x - points[index]!.x, point.z - points[index]!.z));
}

function straightBoundaryControlPoints(config: RiverGenerationConfig): readonly RiverControlPoint[] {
  const span = config.bounds.maxZ - config.bounds.minZ;
  const count = Math.max(2, Math.ceil(span / config.maxSegmentLength));
  return Object.freeze(Array.from({ length: count + 1 }, (_, index) => Object.freeze({
    x: 0, z: config.bounds.maxZ - span * index / count,
  })));
}

/** Sampled planar curvature (turn radians per mean adjacent chord). */
export function measureMaximumCurvature(points: readonly RiverControlPoint[]): number {
  let maximum = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const a = points[index - 1]!, b = points[index]!, c = points[index + 1]!;
    const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z);
    if (ab < 1e-9 || bc < 1e-9) return Infinity;
    const dot = ((b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z)) / (ab * bc);
    maximum = Math.max(maximum, Math.acos(Math.max(-1, Math.min(1, dot))) / ((ab + bc) * .5));
  }
  return maximum;
}

function resample(spine: RiverSpine, spacing: number): readonly RiverControlPoint[] {
  const count = Math.ceil(spine.totalLength / spacing);
  return Object.freeze(Array.from({ length: count + 1 }, (_, index) => Object.freeze(spine.samplePosition(index / count))));
}

const smoothstep = (value: number): number => { const t = Math.min(1, Math.max(0, value)); return t * t * (3 - 2 * t); };

/** Deterministic low-frequency R8 activity plan. Gaps are intentionally first-class quiet reaches. */
export function generateMeanderRegions(
  macroLength: number,
  config: RiverGenerationConfig,
  suitability: RegionalSuitability = () => 1,
): readonly MeanderRegion[] {
  const seed = normalizeSeed(config.worldSeed) ^ config.generationVersion;
  const protectedLength = config.endpointProtectionDistance;
  const available = Math.max(0, macroLength - protectedLength * 2);
  const desiredCount = available > 150 ? 2 : available > 60 ? 1 : 0;
  const regions: MeanderRegion[] = [];
  for (let index = 0; index < desiredCount; index += 1) {
    const slotStart = protectedLength + available * (index + .16) / desiredCount;
    const slotEnd = protectedLength + available * (index + .72) / desiredCount;
    const length = Math.min(slotEnd - slotStart, 42 + hashFloat(seed, index, 8201) * 24);
    const startDistance = slotStart + hashFloat(seed, index, 8202) * Math.max(0, slotEnd - slotStart - length);
    const endDistance = startDistance + length;
    const centre = (startDistance + endDistance) * .5;
    const allowed = Math.min(1, Math.max(0, suitability(centre, macroLength)));
    if (allowed < .15) continue;
    const profile: MeanderRegionProfile = hashFloat(seed, index, 8203) > .76 ? "strong" : "gentle";
    const wavelength = config.meanderWavelengthRange[0] + hashFloat(seed, index, 8204)
      * (config.meanderWavelengthRange[1] - config.meanderWavelengthRange[0]);
    regions.push(Object.freeze({ startDistance, endDistance,
      fadeInDistance: Math.min(14, length * .28), fadeOutDistance: Math.min(14, length * .28),
      strength: allowed * (.55 + hashFloat(seed, index, 8205) * .45), profile,
      targetWavelength: profile === "strong" ? Math.max(length * .9, wavelength) : wavelength,
      targetBendRadius: profile === "strong" ? 4 : 18, correctionApplied: false,
      correctionReasons: Object.freeze([]) }));
  }
  return Object.freeze(regions);
}

export function sampleRegionalMeanderStrength(distance: number, region: MeanderRegion): number {
  if (distance <= region.startDistance || distance >= region.endDistance) return 0;
  const fadeIn = smoothstep((distance - region.startDistance) / region.fadeInDistance);
  const fadeOut = smoothstep((region.endDistance - distance) / region.fadeOutDistance);
  return region.strength * Math.min(fadeIn, fadeOut);
}

/** R8 is an explicit arc-length normal displacement of the retained R7 product. */
export function generateMeanderedControlPoints(
  macroSpine: RiverSpine,
  config: RiverGenerationConfig,
  regions: readonly MeanderRegion[] = generateMeanderRegions(macroSpine.totalLength, config),
  amplitudeScale = 1,
): readonly RiverControlPoint[] {
  const seed = normalizeSeed(config.worldSeed) ^ config.generationVersion;
  const amplitude = config.meanderAmplitudeRange[0] + hashFloat(seed, 8101)
    * (config.meanderAmplitudeRange[1] - config.meanderAmplitudeRange[0]);
  const phase = hashFloat(seed, 8103) * Math.PI * 2;
  const count = Math.ceil(macroSpine.totalLength / Math.max(4, config.resamplingSpacing * 4));
  return Object.freeze(Array.from({ length: count + 1 }, (_, index) => {
    const distance = macroSpine.totalLength * index / count;
    const frame = macroSpine.sampleFrame(macroSpine.progressAtDistance(distance));
    const region = regions.find(item => distance > item.startDistance && distance < item.endDistance);
    if (!region) return Object.freeze({ ...frame.position });
    const regionalStrength = sampleRegionalMeanderStrength(distance, region);
    const localDistance = distance - region.startDistance;
    const localProgress = localDistance / (region.endDistance - region.startDistance);
    const localPhase = Math.PI * 2 * localDistance / region.targetWavelength + phase;
    const primary = Math.sin(localPhase);
    const secondary = region.profile === "gentle" ? .16 * Math.sin(localPhase * 2 + phase * .31) : 0;
    const strongWindow = Math.sin(Math.PI * localProgress) ** 2;
    const displacement = amplitude * amplitudeScale * regionalStrength * (primary + secondary) / 1.16
      * (region.profile === "strong" ? 2.15 : 1);
    // Strong belts also reparameterize downstream travel locally. The zero-value,
    // zero-slope window reconnects smoothly while its middle derivative may reverse.
    const backtrack = region.profile === "strong"
      ? -(region.endDistance - region.startDistance) * .48 * regionalStrength
        * amplitudeScale * Math.sin(Math.PI * 2 * localProgress) * strongWindow : 0;
    const shifted = macroSpine.sampleFrame(macroSpine.progressAtDistance(Math.min(macroSpine.totalLength,
      Math.max(0, distance + backtrack))));
    return Object.freeze({ x: shifted.position.x + shifted.normal.x * displacement,
      z: shifted.position.z + shifted.normal.z * displacement });
  }));
}

function geometryIsValid(points: readonly RiverControlPoint[], config: RiverGenerationConfig): boolean {
  const segmentDistance = (a: RiverControlPoint, b: RiverControlPoint, c: RiverControlPoint, d: RiverControlPoint): number => {
    let best = Infinity;
    for (let step = 0; step <= 6; step += 1) {
      const t = step / 6, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const dx = d.x - c.x, dz = d.z - c.z;
      const u = Math.min(1, Math.max(0, ((x - c.x) * dx + (z - c.z) * dz) / (dx * dx + dz * dz || 1)));
      best = Math.min(best, Math.hypot(x - c.x - dx * u, z - c.z - dz * u));
    }
    return best;
  };
  for (let a = 0; a < points.length - 1; a += 1) for (let b = a + 3; b < points.length - 1; b += 1) {
    if (segmentDistance(points[a]!, points[a + 1]!, points[b]!, points[b + 1]!) < config.selfSeparationDistance) return false;
  }
  return true;
}

function finalAcceptanceFailures(spine: RiverSpine, points: readonly RiverControlPoint[], config: RiverGenerationConfig): RiverCorrectionReason[] {
  const failures: RiverCorrectionReason[] = [];
  const bounds = spine.bounds;
  if (![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every(Number.isFinite)
    || bounds.minX < config.bounds.minX || bounds.maxX > config.bounds.maxX
    || bounds.minZ < config.bounds.minZ - .01 || bounds.maxZ > config.bounds.maxZ + .01) failures.push("outside-bounds");
  if (!geometryIsValid(points, config)) failures.push("self-separation");
  if (measureMaximumCurvature(meanderedResampleForMeasurement(spine, config.resamplingSpacing)) > config.curvatureGuard)
    failures.push("final-curvature");
  for (let index = 0; index <= 100; index += 1) {
    const frame = spine.sampleFrame(index / 100);
    const values = [...Object.values(frame.position), ...Object.values(frame.tangent), ...Object.values(frame.normal)];
    if (!values.every(Number.isFinite) || Math.hypot(frame.tangent.x, frame.tangent.z) < 1e-8) {
      failures.push("non-finite-frame"); break;
    }
  }
  return failures;
}

export function getWorldRiverGeneration(config: RiverGenerationConfig = DEFAULT_RIVER_GENERATION_CONFIG): MacroRiverGeneration {
  const cacheKey = stableConfigKey(config);
  const retained = cache.get(cacheKey);
  if (retained) return retained;
  const correctionReasons: RiverCorrectionReason[] = [];
  let usedFallback = false;
  let macroControlPoints = config.mode === "authored-r6" ? authoredR6RiverSpine.controlPoints : generateMacroControlPoints(config);
  if (config.mode !== "authored-r6") {
    const lengths = segmentLengths(macroControlPoints);
    if (lengths.some(length => length < config.minSegmentLength || length > config.maxSegmentLength)) correctionReasons.push("macro-segment-length");
    const candidateSpine = new RiverSpine(macroControlPoints);
    if (measureMaximumCurvature(resample(candidateSpine, Math.min(1, config.resamplingSpacing))) > config.macroCurvatureLimit)
      correctionReasons.push("macro-curvature");
    // Deterministic bounded fallback: the boundary-to-boundary centre line satisfies
    // every macro guard when the configured waypoint polygon cannot.
    if (correctionReasons.length) {
      usedFallback = true; correctionReasons.push("fallback-straight");
      macroControlPoints = straightBoundaryControlPoints(config);
    }
  }
  const macroSpine = config.mode === "authored-r6" ? authoredR6RiverSpine : new RiverSpine(macroControlPoints);
  const meanderRegions = generateMeanderRegions(macroSpine.totalLength, config);
  // Bounded correction: monotonically reduce the complete band-limited signal.
  // Conservative configured amplitude/corridor currently accepts the first pass.
  let scale = 1, correctionApplied = false;
  let meanderedControlPoints = config.mode === "procedural-meandered"
    ? generateMeanderedControlPoints(macroSpine, config, meanderRegions, scale) : macroControlPoints;
  let meanderedSpine = config.mode === "procedural-meandered" ? new RiverSpine(meanderedControlPoints) : macroSpine;
  while ((meanderedSpine.bounds.minX < config.bounds.minX || meanderedSpine.bounds.maxX > config.bounds.maxX
    || meanderedSpine.bounds.minZ < config.bounds.minZ - .01 || meanderedSpine.bounds.maxZ > config.bounds.maxZ + .01) && scale > .02) {
    correctionApplied = true; if (!correctionReasons.includes("outside-bounds")) correctionReasons.push("outside-bounds"); scale *= .75;
    meanderedControlPoints = generateMeanderedControlPoints(macroSpine, config, meanderRegions, scale);
    meanderedSpine = new RiverSpine(meanderedControlPoints);
  }
  while (!geometryIsValid(meanderedControlPoints, config) && scale > .02) {
    correctionApplied = true; if (!correctionReasons.includes("self-separation")) correctionReasons.push("self-separation"); scale *= .75;
    meanderedControlPoints = generateMeanderedControlPoints(macroSpine, config, meanderRegions, scale);
    meanderedSpine = new RiverSpine(meanderedControlPoints);
  }
  while (measureMaximumCurvature(meanderedResampleForMeasurement(meanderedSpine, config.resamplingSpacing)) > config.curvatureGuard && scale > .02) {
    correctionApplied = true; if (!correctionReasons.includes("final-curvature")) correctionReasons.push("final-curvature"); scale *= .75;
    meanderedControlPoints = generateMeanderedControlPoints(macroSpine, config, meanderRegions, scale);
    meanderedSpine = new RiverSpine(meanderedControlPoints);
  }
  if (config.mode !== "authored-r6") {
    const failures = finalAcceptanceFailures(meanderedSpine, meanderedControlPoints, config);
    if (failures.length) {
      usedFallback = true; correctionApplied = true;
      for (const reason of failures) if (!correctionReasons.includes(reason)) correctionReasons.push(reason);
      if (!correctionReasons.includes("fallback-straight")) correctionReasons.push("fallback-straight");
      meanderedControlPoints = straightBoundaryControlPoints(config);
      meanderedSpine = new RiverSpine(meanderedControlPoints);
      const fallbackFailures = finalAcceptanceFailures(meanderedSpine, meanderedControlPoints, config);
      if (fallbackFailures.length) throw new Error(`Deterministic river fallback failed: ${fallbackFailures.join(",")}`);
    }
  }
  const measuredCurvature = measureMaximumCurvature(meanderedResampleForMeasurement(meanderedSpine, config.resamplingSpacing));
  const seed = normalizeSeed(config.worldSeed) ^ config.generationVersion;
  const meanderAmplitude = (config.meanderAmplitudeRange[0] + hashFloat(seed, 8101)
    * (config.meanderAmplitudeRange[1] - config.meanderAmplitudeRange[0])) * scale;
  const meanderWavelength = config.meanderWavelengthRange[0] + hashFloat(seed, 8102)
    * (config.meanderWavelengthRange[1] - config.meanderWavelengthRange[0]);
  const result = Object.freeze({ cacheKey, config: Object.freeze(config), macroControlPoints,
    macroResampledPoints: resample(macroSpine, config.resamplingSpacing), macroSpine,
    meanderedControlPoints, meanderedResampledPoints: resample(meanderedSpine, config.resamplingSpacing), meanderedSpine,
    sourceMacroCacheKey: cacheKey, meanderAmplitude, meanderWavelength, correctionApplied,
    meanderRegions: Object.freeze(meanderRegions.map(region => correctionApplied ? Object.freeze({ ...region, correctionApplied: true,
      correctionReasons: Object.freeze([...correctionReasons]) }) : region)), usedFallback,
    correctionReasons: Object.freeze([...correctionReasons]), measuredMinimumBendRadius: measuredCurvature > 0 ? 1 / measuredCurvature : Infinity });
  cache.set(cacheKey, result);
  return result;
}

function meanderedResampleForMeasurement(spine: RiverSpine, spacing: number): readonly RiverControlPoint[] {
  return resample(spine, Math.min(spacing, 1));
}

/** Diagnostic/test reset. Production uses immutable, fully geometry-keyed entries. */
export function resetWorldRiverGenerationCaches(): void { cache.clear(); }
export function worldRiverGenerationCacheSize(): number { return cache.size; }

/** R7 production ownership; R8 changes only the final alias. */
export const referenceWorldRiverGeneration = getWorldRiverGeneration();
export const referenceWorldRiverMacroSpine = referenceWorldRiverGeneration.macroSpine;
export const referenceWorldRiverSpine = referenceWorldRiverGeneration.meanderedSpine;
/** @deprecated Reference-fixture compatibility only; production must use WorldRiverOwner. */
export const worldRiverGeneration = referenceWorldRiverGeneration;
/** @deprecated Reference-fixture compatibility only; production must use WorldRiverOwner. */
export const worldRiverMacroSpine = referenceWorldRiverMacroSpine;
/** @deprecated Reference-fixture compatibility only; production must use WorldRiverOwner. */
export const worldRiverSpine = referenceWorldRiverSpine;
export const WORLD_RIVER_CONTROL_POINTS = referenceWorldRiverSpine.controlPoints;
export { authoredR6RiverSpine };
