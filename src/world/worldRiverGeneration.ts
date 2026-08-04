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
}

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
  readonly usedFallback: boolean;
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

function resample(spine: RiverSpine, spacing: number): readonly RiverControlPoint[] {
  const count = Math.ceil(spine.totalLength / spacing);
  return Object.freeze(Array.from({ length: count + 1 }, (_, index) => Object.freeze(spine.samplePosition(index / count))));
}

const smoothstep = (value: number): number => { const t = Math.min(1, Math.max(0, value)); return t * t * (3 - 2 * t); };

/** R8 is an explicit arc-length normal displacement of the retained R7 product. */
export function generateMeanderedControlPoints(
  macroSpine: RiverSpine,
  config: RiverGenerationConfig,
  amplitudeScale = 1,
): readonly RiverControlPoint[] {
  const seed = normalizeSeed(config.worldSeed) ^ config.generationVersion;
  const amplitude = config.meanderAmplitudeRange[0] + hashFloat(seed, 8101)
    * (config.meanderAmplitudeRange[1] - config.meanderAmplitudeRange[0]);
  const wavelength = config.meanderWavelengthRange[0] + hashFloat(seed, 8102)
    * (config.meanderWavelengthRange[1] - config.meanderWavelengthRange[0]);
  const phase = hashFloat(seed, 8103) * Math.PI * 2;
  const count = Math.ceil(macroSpine.totalLength / Math.max(4, config.resamplingSpacing * 4));
  return Object.freeze(Array.from({ length: count + 1 }, (_, index) => {
    const distance = macroSpine.totalLength * index / count;
    const frame = macroSpine.sampleFrame(macroSpine.progressAtDistance(distance));
    const endpoint = Math.min(distance, macroSpine.totalLength - distance) / config.endpointProtectionDistance;
    const envelope = smoothstep(endpoint);
    const primary = Math.sin(Math.PI * 2 * distance / wavelength + phase);
    const secondary = .22 * Math.sin(Math.PI * 4 * distance / wavelength + phase * .61);
    const displacement = amplitude * amplitudeScale * envelope * (primary + secondary) / 1.22;
    return Object.freeze({ x: frame.position.x + frame.normal.x * displacement,
      z: frame.position.z + frame.normal.z * displacement });
  }));
}

export function getWorldRiverGeneration(config: RiverGenerationConfig = DEFAULT_RIVER_GENERATION_CONFIG): MacroRiverGeneration {
  const cacheKey = stableConfigKey(config);
  const retained = cache.get(cacheKey);
  if (retained) return retained;
  const macroControlPoints = config.mode === "authored-r6" ? authoredR6RiverSpine.controlPoints : generateMacroControlPoints(config);
  const macroSpine = config.mode === "authored-r6" ? authoredR6RiverSpine : new RiverSpine(macroControlPoints);
  // Bounded correction: monotonically reduce the complete band-limited signal.
  // Conservative configured amplitude/corridor currently accepts the first pass.
  let scale = 1, correctionApplied = false;
  let meanderedControlPoints = config.mode === "procedural-meandered"
    ? generateMeanderedControlPoints(macroSpine, config, scale) : macroControlPoints;
  let meanderedSpine = config.mode === "procedural-meandered" ? new RiverSpine(meanderedControlPoints) : macroSpine;
  while ((meanderedSpine.bounds.minX < config.bounds.minX || meanderedSpine.bounds.maxX > config.bounds.maxX
    || meanderedSpine.bounds.minZ < config.bounds.minZ - .01 || meanderedSpine.bounds.maxZ > config.bounds.maxZ + .01) && scale > .25) {
    correctionApplied = true; scale *= .75;
    meanderedControlPoints = generateMeanderedControlPoints(macroSpine, config, scale);
    meanderedSpine = new RiverSpine(meanderedControlPoints);
  }
  const seed = normalizeSeed(config.worldSeed) ^ config.generationVersion;
  const meanderAmplitude = (config.meanderAmplitudeRange[0] + hashFloat(seed, 8101)
    * (config.meanderAmplitudeRange[1] - config.meanderAmplitudeRange[0])) * scale;
  const meanderWavelength = config.meanderWavelengthRange[0] + hashFloat(seed, 8102)
    * (config.meanderWavelengthRange[1] - config.meanderWavelengthRange[0]);
  const result = Object.freeze({ cacheKey, config: Object.freeze(config), macroControlPoints,
    macroResampledPoints: resample(macroSpine, config.resamplingSpacing), macroSpine,
    meanderedControlPoints, meanderedResampledPoints: resample(meanderedSpine, config.resamplingSpacing), meanderedSpine,
    sourceMacroCacheKey: cacheKey, meanderAmplitude, meanderWavelength, correctionApplied, usedFallback: false });
  cache.set(cacheKey, result);
  return result;
}

/** Diagnostic/test reset. Production uses immutable, fully geometry-keyed entries. */
export function resetWorldRiverGenerationCaches(): void { cache.clear(); }
export function worldRiverGenerationCacheSize(): number { return cache.size; }

/** R7 production ownership; R8 changes only the final alias. */
export const worldRiverGeneration = getWorldRiverGeneration();
export const worldRiverMacroSpine = worldRiverGeneration.macroSpine;
export const worldRiverSpine = worldRiverGeneration.meanderedSpine;
export const WORLD_RIVER_CONTROL_POINTS = worldRiverSpine.controlPoints;
export { authoredR6RiverSpine };
