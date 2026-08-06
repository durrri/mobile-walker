import { hashFloat, normalizeSeed } from "./random";
import { authoredR6RiverSpine, RiverSpine, type RiverControlPoint, type WorldBounds2D } from "./riverSpineGeometry";

export type RiverGenerationMode = "authored-r6" | "procedural-macro" | "procedural-meandered";

/** Every geometry-affecting R7/R8 value lives in this immutable, cache-keyed record. */
export interface RiverGenerationConfig {
  readonly generationVersion: number;
  readonly worldSeed: number | string;
  readonly mode: RiverGenerationMode;
  readonly bounds: WorldBounds2D;
  /** Nominal chord length used to sample the retained two-dimensional route plan. */
  readonly routeSegmentLength: number;
  /** Clearance reserved for smoothing, meanders, the widest channel and its banks. */
  readonly routeBoundaryMargin: number;
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

export const PROCEDURAL_RIVER_GENERATION_VERSION = 11;
/** R11 replaces fixed Z stations with a retained, seed-keyed two-dimensional route plan. */
const RIVER_SPINE_ALGORITHM_VERSION = 9;
export const DEFAULT_RIVER_GENERATION_CONFIG: Readonly<RiverGenerationConfig> = Object.freeze({
  generationVersion: PROCEDURAL_RIVER_GENERATION_VERSION,
  worldSeed: 0x52495645,
  mode: "procedural-meandered",
  bounds: Object.freeze({ minX: -2000, maxX: 2000, minZ: -10000, maxZ: 0 }),
  routeSegmentLength: 64,
  routeBoundaryMargin: 260,
  macroCurvatureLimit: 0.045,
  minSegmentLength: 42,
  maxSegmentLength: 82,
  selfSeparationDistance: 14,
  endpointProtectionDistance: 32,
  meanderWavelengthRange: Object.freeze([90, 180] as const),
  meanderAmplitudeRange: Object.freeze([3, 8] as const),
  curvatureGuard: 0.2,
  resamplingSpacing: 2,
  regionalSuitabilityId: "uniform-v1",
});

export interface MacroRiverGeneration {
  readonly cacheKey: string;
  readonly config: Readonly<RiverGenerationConfig>;
  readonly macroControlPoints: readonly RiverControlPoint[];
  readonly macroRoutePlan: MacroRoutePlan;
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

export type MacroRouteBehavior = "downstream" | "diagonal-southwest" | "traverse-east" | "diagonal-southeast" | "traverse-west";
export interface MacroRouteReach {
  readonly index: number;
  readonly behavior: MacroRouteBehavior;
  readonly start: RiverControlPoint;
  readonly end: RiverControlPoint;
  readonly length: number;
  readonly headingRadians: number;
}
export interface MacroRoutePlan {
  readonly algorithmVersion: number;
  readonly seed: number;
  readonly margin: number;
  readonly reaches: readonly MacroRouteReach[];
}

const cache = new Map<string, MacroRiverGeneration>();
const stableConfigKey = (config: RiverGenerationConfig): string => JSON.stringify(config);

/** Builds the immutable low-frequency route whose lateral traverses belong to R7, not R8. */
export function generateMacroRoutePlan(config: RiverGenerationConfig): MacroRoutePlan {
  const seed = normalizeSeed(config.worldSeed) ^ RIVER_SPINE_ALGORITHM_VERSION;
  const span = config.bounds.maxZ - config.bounds.minZ;
  const half = (config.bounds.maxX - config.bounds.minX) / 2 - config.routeBoundaryMargin;
  const centre = (config.bounds.minX + config.bounds.maxX) / 2;
  const mirror = hashFloat(seed, 7001) < .5 ? -1 : 1;
  // Keyed perturbations affect named plan nodes only; adding another decision cannot
  // shift a mutable PRNG stream. Small Z jitter never removes either long traverse.
  const template: readonly [number, number, MacroRouteBehavior][] = [
    [0, 0, "downstream"], [-.30, .12, "diagonal-southwest"], [-.82, .25, "diagonal-southwest"],
    [.78, .285, "traverse-east"], [.91, .40, "diagonal-southeast"], [.20, .52, "downstream"],
    [-.80, .62, "diagonal-southwest"], [.76, .655, "traverse-east"], [.88, .77, "diagonal-southeast"],
    [-.72, .81, "traverse-west"], [-.36, .91, "downstream"], [0, 1, "downstream"],
  ];
  const anchors = template.map(([unitX, progress], index) => Object.freeze({
    x: index === 0 || index === template.length - 1 ? centre : centre + mirror * half * Math.max(-.96, Math.min(.96,
      unitX + (hashFloat(seed, index, 7002) * 2 - 1) * .035)),
    z: index === 0 ? config.bounds.maxZ : index === template.length - 1 ? config.bounds.minZ
      : config.bounds.maxZ - span * Math.max(.01, Math.min(.99, progress + (hashFloat(seed, index, 7003) * 2 - 1) * .008)),
  }));
  const reaches = anchors.slice(1).map((end, index) => {
    const start = anchors[index]!, dx = end.x - start.x, dz = end.z - start.z;
    const rawBehavior = template[index + 1]![2];
    const behavior = mirror < 0
      ? rawBehavior === "traverse-east" ? "traverse-west" : rawBehavior === "traverse-west" ? "traverse-east"
        : rawBehavior === "diagonal-southeast" ? "diagonal-southwest" : rawBehavior === "diagonal-southwest" ? "diagonal-southeast" : rawBehavior
      : rawBehavior;
    return Object.freeze({ index, behavior, start, end, length: Math.hypot(dx, dz), headingRadians: Math.atan2(dz, dx) });
  });
  return Object.freeze({ algorithmVersion: RIVER_SPINE_ALGORITHM_VERSION, seed, margin: config.routeBoundaryMargin,
    reaches: Object.freeze(reaches) });
}

/** Samples bounded world-space segments from the retained two-dimensional plan. */
export function generateMacroControlPoints(config: RiverGenerationConfig, plan = generateMacroRoutePlan(config)): readonly RiverControlPoint[] {
  const anchors = [plan.reaches[0]!.start, ...plan.reaches.map(reach => reach.end)];
  // The plan's sparse behavior nodes are first joined by the same centripetal
  // interpolant as the published spine. Arc-length sampling that guide turns each
  // broad decision into a smoothly evolving sequence of bounded world segments.
  const guide = new RiverSpine(anchors);
  const count = Math.max(2, Math.round(guide.totalLength / config.routeSegmentLength));
  return Object.freeze(Array.from({ length: count + 1 }, (_, index) => Object.freeze(guide.samplePosition(index / count))));
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
  const seed = normalizeSeed(config.worldSeed) ^ RIVER_SPINE_ALGORITHM_VERSION;
  const protectedLength = config.endpointProtectionDistance;
  const available = Math.max(0, macroLength - protectedLength * 2);
  const desiredCount = available > 60 ? Math.max(1, Math.min(18, Math.round(available / 600))) : 0;
  const regions: MeanderRegion[] = [];
  for (let index = 0; index < desiredCount; index += 1) {
    const slotStart = protectedLength + available * (index + .12) / desiredCount;
    const slotEnd = protectedLength + available * (index + .58) / desiredCount;
    const slotSpan = slotEnd - slotStart;
    const length = Math.min(slotSpan * .58, 110 + hashFloat(seed, index, 8201) * 130);
    const startDistance = slotStart + hashFloat(seed, index, 8202) * Math.max(0, slotEnd - slotStart - length);
    const endDistance = startDistance + length;
    const centre = (startDistance + endDistance) * .5;
    const allowed = Math.min(1, Math.max(0, suitability(centre, macroLength)));
    if (allowed < .15) continue;
    const profile: MeanderRegionProfile = hashFloat(seed, index, 8203) > .90 ? "strong" : "gentle";
    const wavelength = config.meanderWavelengthRange[0] + hashFloat(seed, index, 8204)
      * (config.meanderWavelengthRange[1] - config.meanderWavelengthRange[0]);
    regions.push(Object.freeze({ startDistance, endDistance,
      fadeInDistance: Math.min(32, length * .28), fadeOutDistance: Math.min(32, length * .28),
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
  const seed = normalizeSeed(config.worldSeed) ^ RIVER_SPINE_ALGORITHM_VERSION;
  const amplitude = config.meanderAmplitudeRange[0] + hashFloat(seed, 8101)
    * (config.meanderAmplitudeRange[1] - config.meanderAmplitudeRange[0]);
  const phase = hashFloat(seed, 8103) * Math.PI * 2;
  const controlSpacing = macroSpine.totalLength < 1000 ? Math.max(4, config.resamplingSpacing * 4)
    : Math.max(24, config.resamplingSpacing * 8);
  const count = Math.ceil(macroSpine.totalLength / controlSpacing);
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

export function validateControlPolygonSeparation(points: readonly RiverControlPoint[], config: RiverGenerationConfig): boolean {
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

export interface SmoothedSeparationValidation {
  readonly valid: boolean;
  readonly minimumDistance: number;
  readonly sampleCount: number;
}

const pointSegmentDistance = (point: RiverControlPoint, a: RiverControlPoint, b: RiverControlPoint): number => {
  const dx=b.x-a.x,dz=b.z-a.z,lengthSquared=dx*dx+dz*dz;
  const t=lengthSquared ? Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.z-a.z)*dz)/lengthSquared)) : 0;
  return Math.hypot(point.x-a.x-dx*t,point.z-a.z-dz*t);
};

function segmentSeparation(a:RiverControlPoint,b:RiverControlPoint,c:RiverControlPoint,d:RiverControlPoint):number {
  const cross=(p:RiverControlPoint,q:RiverControlPoint,r:RiverControlPoint)=>(q.x-p.x)*(r.z-p.z)-(q.z-p.z)*(r.x-p.x);
  const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
  const boxesOverlap=Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))
    &&Math.max(Math.min(a.z,b.z),Math.min(c.z,d.z))<=Math.min(Math.max(a.z,b.z),Math.max(c.z,d.z));
  if (boxesOverlap&&((abC<=0&&abD>=0)||(abC>=0&&abD<=0))&&((cdA<=0&&cdB>=0)||(cdA>=0&&cdB<=0))) return 0;
  return Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b));
}

/** One-time topology check over deterministic arc-length samples of the actual smoothed curve. */
export function validateSmoothedSpineSeparation(spine:RiverSpine,config:RiverGenerationConfig):SmoothedSeparationValidation {
  const spacing=Math.min(2,config.resamplingSpacing),points=resample(spine,spacing),cellSize=config.selfSeparationDistance;
  const cells=new Map<string,number[]>(),segments=points.length-1;
  const localReachDistance=config.selfSeparationDistance*2,checked=new Set<string>();let minimumDistance=Infinity;
  for(let index=0;index<segments;index+=1){
    const a=points[index]!,b=points[index+1]!,minX=Math.min(a.x,b.x),maxX=Math.max(a.x,b.x),minZ=Math.min(a.z,b.z),maxZ=Math.max(a.z,b.z);
    const candidates=new Set<number>();
    for(let z=Math.floor((minZ-cellSize)/cellSize);z<=Math.floor((maxZ+cellSize)/cellSize);z++)
      for(let x=Math.floor((minX-cellSize)/cellSize);x<=Math.floor((maxX+cellSize)/cellSize);x++)
        for(const candidate of cells.get(`${x},${z}`)??[])candidates.add(candidate);
    for(const candidate of candidates){
      if((index-candidate)*spacing<=localReachDistance)continue;
      const key=`${candidate}:${index}`;if(checked.has(key))continue;checked.add(key);
      const distance=segmentSeparation(points[candidate]!,points[candidate+1]!,a,b);minimumDistance=Math.min(minimumDistance,distance);
      if(distance<config.selfSeparationDistance)return Object.freeze({valid:false,minimumDistance:distance,sampleCount:points.length});
    }
    for(let z=Math.floor(minZ/cellSize);z<=Math.floor(maxZ/cellSize);z++)for(let x=Math.floor(minX/cellSize);x<=Math.floor(maxX/cellSize);x++){
      const key=`${x},${z}`,bucket=cells.get(key)??[];bucket.push(index);cells.set(key,bucket);
    }
  }
  return Object.freeze({valid:true,minimumDistance,sampleCount:points.length});
}

function finalAcceptanceFailures(spine: RiverSpine, config: RiverGenerationConfig): RiverCorrectionReason[] {
  const failures: RiverCorrectionReason[] = [];
  const bounds = spine.bounds;
  if (![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every(Number.isFinite)
    || bounds.minX < config.bounds.minX || bounds.maxX > config.bounds.maxX
    || bounds.minZ < config.bounds.minZ - .01 || bounds.maxZ > config.bounds.maxZ + .01) failures.push("outside-bounds");
  if (!validateSmoothedSpineSeparation(spine, config).valid) failures.push("self-separation");
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
  const macroRoutePlan = generateMacroRoutePlan(config);
  let macroControlPoints = config.mode === "authored-r6" ? authoredR6RiverSpine.controlPoints : generateMacroControlPoints(config, macroRoutePlan);
  if (config.mode !== "authored-r6") {
    const lengths = segmentLengths(macroControlPoints);
    if (lengths.some(length => length < config.minSegmentLength || length > config.maxSegmentLength)) correctionReasons.push("macro-segment-length");
    const candidateSpine = new RiverSpine(macroControlPoints);
    if (measureMaximumCurvature(resample(candidateSpine, Math.min(1, config.resamplingSpacing))) > config.macroCurvatureLimit)
      correctionReasons.push("macro-curvature");
    if (!validateSmoothedSpineSeparation(candidateSpine, config).valid) correctionReasons.push("self-separation");
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
  while (!validateSmoothedSpineSeparation(meanderedSpine, config).valid && scale > .02) {
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
    const failures = finalAcceptanceFailures(meanderedSpine, config);
    if (failures.length) {
      usedFallback = true; correctionApplied = true;
      for (const reason of failures) if (!correctionReasons.includes(reason)) correctionReasons.push(reason);
      if (!correctionReasons.includes("fallback-straight")) correctionReasons.push("fallback-straight");
      meanderedControlPoints = straightBoundaryControlPoints(config);
      meanderedSpine = new RiverSpine(meanderedControlPoints);
      const fallbackFailures = finalAcceptanceFailures(meanderedSpine, config);
      if (fallbackFailures.length) throw new Error(`Deterministic river fallback failed: ${fallbackFailures.join(",")}`);
    }
  }
  const measuredCurvature = measureMaximumCurvature(meanderedResampleForMeasurement(meanderedSpine, config.resamplingSpacing));
  const seed = normalizeSeed(config.worldSeed) ^ RIVER_SPINE_ALGORITHM_VERSION;
  const meanderAmplitude = (config.meanderAmplitudeRange[0] + hashFloat(seed, 8101)
    * (config.meanderAmplitudeRange[1] - config.meanderAmplitudeRange[0])) * scale;
  const meanderWavelength = config.meanderWavelengthRange[0] + hashFloat(seed, 8102)
    * (config.meanderWavelengthRange[1] - config.meanderWavelengthRange[0]);
  const result = Object.freeze({ cacheKey, config: Object.freeze(config), macroControlPoints, macroRoutePlan,
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
