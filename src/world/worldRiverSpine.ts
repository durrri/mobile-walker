/** Presentation-neutral, world-space river geometry. The legacy river in river.ts
 * still drives gameplay; this is the future authoritative river source. */

export interface RiverControlPoint { readonly x: number; readonly z: number }
export interface WorldBounds2D { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }
export interface RiverSpineSample extends RiverControlPoint { readonly progress: number; readonly distance: number }
export interface RiverFrame {
  readonly position: RiverControlPoint;
  readonly tangent: RiverControlPoint;
  /** Deterministic left normal: (-tangent.z, tangent.x). */
  readonly normal: RiverControlPoint;
  readonly progress: number;
}
export interface RiverIndexedSegment {
  readonly index: number;
  readonly start: RiverSpineSample;
  readonly end: RiverSpineSample;
  readonly bounds: WorldBounds2D;
}
export interface RiverNearestPoint extends RiverFrame {
  readonly distanceAlongRiver: number;
  readonly distanceToRiver: number;
  /** Dot product from the centreline to the query with the deterministic left normal. */
  readonly signedSide: number;
  readonly coarseDistanceToRiver: number;
}
export interface RiverSpineOptions { readonly lookupSamples?: number; readonly indexSamples?: number; readonly indexCellSize?: number }

interface RawSample extends RiverControlPoint { readonly rawProgress: number; readonly distance: number }
const finiteOr = (value: number, fallback: number): number => Number.isFinite(value) ? value : fallback;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, finiteOr(value, value === Infinity ? 1 : 0)));
const distance = (a: RiverControlPoint, b: RiverControlPoint): number => Math.hypot(b.x - a.x, b.z - a.z);

/**
 * A deterministic centripetal Catmull-Rom chain (knot spacing = chord length^0.5).
 * Endpoint knots are extrapolated, giving predictable endpoint interpolation.
 * Public progress is normalized approximate arc length, not the raw spline parameter.
 */
export class RiverSpine {
  readonly controlPoints: readonly RiverControlPoint[];
  readonly totalLength: number;
  readonly indexedSegments: readonly RiverIndexedSegment[];
  readonly lookupBuildCount = 1;
  private readonly knots: readonly number[];
  private readonly lookup: readonly RawSample[];
  private readonly cells = new Map<string, readonly RiverIndexedSegment[]>();
  private readonly cellSize: number;

  constructor(points: readonly RiverControlPoint[], options: RiverSpineOptions = {}) {
    if (points.length < 2 || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.z))) {
      throw new Error("A river spine needs at least two finite world-space control points.");
    }
    this.controlPoints = points.map(point => Object.freeze({ ...point }));
    const knots = [0];
    for (let index = 1; index < points.length; index += 1) {
      knots.push(knots[index - 1]! + Math.sqrt(Math.max(1e-6, distance(points[index - 1]!, points[index]!))));
    }
    this.knots = knots;
    const count = Math.max(points.length * 16, Math.floor(options.lookupSamples ?? 2048));
    const lookup: RawSample[] = [];
    let cumulative = 0;
    for (let index = 0; index <= count; index += 1) {
      const rawProgress = index / count;
      const position = this.evaluateRaw(rawProgress);
      if (index) cumulative += distance(lookup[index - 1]!, position);
      lookup.push({ ...position, rawProgress, distance: cumulative });
    }
    this.lookup = lookup;
    this.totalLength = cumulative;
    const segmentCount = Math.max(points.length * 8, Math.floor(options.indexSamples ?? 512));
    const segments: RiverIndexedSegment[] = [];
    for (let index = 0; index < segmentCount; index += 1) {
      const start = this.sampleAtDistance(this.totalLength * index / segmentCount);
      const end = this.sampleAtDistance(this.totalLength * (index + 1) / segmentCount);
      segments.push(Object.freeze({ index, start, end, bounds: {
        minX: Math.min(start.x, end.x), maxX: Math.max(start.x, end.x),
        minZ: Math.min(start.z, end.z), maxZ: Math.max(start.z, end.z),
      } }));
    }
    this.indexedSegments = segments;
    this.cellSize = Math.max(1, finiteOr(options.indexCellSize ?? 16, 16));
    const mutableCells = new Map<string, RiverIndexedSegment[]>();
    for (const segment of segments) {
      const minX = Math.floor(segment.bounds.minX / this.cellSize), maxX = Math.floor(segment.bounds.maxX / this.cellSize);
      const minZ = Math.floor(segment.bounds.minZ / this.cellSize), maxZ = Math.floor(segment.bounds.maxZ / this.cellSize);
      for (let x = minX; x <= maxX; x += 1) for (let z = minZ; z <= maxZ; z += 1) {
        const key = `${x},${z}`, cell = mutableCells.get(key) ?? [];
        cell.push(segment); mutableCells.set(key, cell);
      }
    }
    for (const [key, value] of mutableCells) this.cells.set(key, Object.freeze(value));
  }

  samplePosition(progress: number): RiverControlPoint { return this.evaluateRaw(this.rawAtProgress(progress)); }

  sampleTangent(progress: number): RiverControlPoint {
    const raw = this.rawAtProgress(progress), epsilon = 1e-5;
    const before = this.evaluateRaw(Math.max(0, raw - epsilon)), after = this.evaluateRaw(Math.min(1, raw + epsilon));
    const length = Math.hypot(after.x - before.x, after.z - before.z) || 1;
    return { x: (after.x - before.x) / length, z: (after.z - before.z) / length };
  }

  sampleFrame(progress: number): RiverFrame {
    const safe = clamp01(progress), tangent = this.sampleTangent(safe);
    return { position: this.samplePosition(safe), tangent, normal: { x: -tangent.z, z: tangent.x }, progress: safe };
  }

  distanceAtProgress(progress: number): number { return clamp01(progress) * this.totalLength; }
  progressAtDistance(value: number): number { return clamp01(finiteOr(value, value === Infinity ? this.totalLength : 0) / this.totalLength); }
  sampleAtDistance(value: number): RiverSpineSample {
    const progress = this.progressAtDistance(value), position = this.samplePosition(progress);
    return { ...position, progress, distance: progress * this.totalLength };
  }

  queryRiverSegments(bounds: WorldBounds2D, margin = 0): readonly RiverIndexedSegment[] {
    if (![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every(Number.isFinite)) return [];
    const grow = Math.max(0, finiteOr(margin, 0));
    const query = { minX: Math.min(bounds.minX, bounds.maxX) - grow, maxX: Math.max(bounds.minX, bounds.maxX) + grow,
      minZ: Math.min(bounds.minZ, bounds.maxZ) - grow, maxZ: Math.max(bounds.minZ, bounds.maxZ) + grow };
    const found = new Map<number, RiverIndexedSegment>();
    for (let x = Math.floor(query.minX / this.cellSize); x <= Math.floor(query.maxX / this.cellSize); x += 1) {
      for (let z = Math.floor(query.minZ / this.cellSize); z <= Math.floor(query.maxZ / this.cellSize); z += 1) {
        for (const segment of this.cells.get(`${x},${z}`) ?? []) if (this.intersects(segment.bounds, query)) found.set(segment.index, segment);
      }
    }
    return [...found.values()].sort((a, b) => a.index - b.index);
  }

  nearestPointToRiver(xValue: number, zValue: number): RiverNearestPoint {
    const x = finiteOr(xValue, 0), z = finiteOr(zValue, 0);
    let candidates = this.queryRiverSegments({ minX: x, maxX: x, minZ: z, maxZ: z }, this.cellSize);
    // Outside the indexed corridor is an uncommon diagnostic query; fall back to the
    // finite coarse index, while ordinary terrain queries remain spatially bounded.
    if (!candidates.length) candidates = this.indexedSegments;
    let best = candidates[0]!, bestProgress = best.start.progress, coarseSquared = Infinity;
    for (const segment of candidates) {
      const dx = segment.end.x - segment.start.x, dz = segment.end.z - segment.start.z;
      const t = Math.min(1, Math.max(0, ((x - segment.start.x) * dx + (z - segment.start.z) * dz) / (dx * dx + dz * dz || 1)));
      const px = segment.start.x + dx * t, pz = segment.start.z + dz * t, squared = (x - px) ** 2 + (z - pz) ** 2;
      if (squared < coarseSquared) { coarseSquared = squared; best = segment; bestProgress = segment.start.progress + (segment.end.progress - segment.start.progress) * t; }
    }
    let low = best.start.progress, high = best.end.progress;
    const squaredAt = (progress: number): number => { const p = this.samplePosition(progress); return (x - p.x) ** 2 + (z - p.z) ** 2; };
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const third = (high - low) / 3, a = low + third, b = high - third;
      if (squaredAt(a) <= squaredAt(b)) high = b; else low = a;
    }
    const refinedProgress = (low + high) / 2;
    if (squaredAt(bestProgress) < squaredAt(refinedProgress)) low = high = bestProgress;
    const frame = this.sampleFrame((low + high) / 2), ox = x - frame.position.x, oz = z - frame.position.z;
    return { ...frame, distanceAlongRiver: frame.progress * this.totalLength,
      distanceToRiver: Math.hypot(ox, oz), signedSide: ox * frame.normal.x + oz * frame.normal.z,
      coarseDistanceToRiver: Math.sqrt(coarseSquared) };
  }

  private rawAtProgress(progress: number): number {
    const target = clamp01(progress) * this.totalLength;
    let low = 0, high = this.lookup.length - 1;
    while (low + 1 < high) { const middle = (low + high) >>> 1; if (this.lookup[middle]!.distance < target) low = middle; else high = middle; }
    const a = this.lookup[low]!, b = this.lookup[high]!, fraction = (target - a.distance) / (b.distance - a.distance || 1);
    return a.rawProgress + (b.rawProgress - a.rawProgress) * fraction;
  }

  private evaluateRaw(rawValue: number): RiverControlPoint {
    const scaled = clamp01(rawValue) * (this.controlPoints.length - 1), index = Math.min(this.controlPoints.length - 2, Math.floor(scaled));
    const p0 = this.controlPoints[index]!, p1 = this.controlPoints[index + 1]!, t0 = this.knots[index]!, t1 = this.knots[index + 1]!;
    const previous = this.controlPoints[index - 1] ?? { x: 2 * p0.x - p1.x, z: 2 * p0.z - p1.z };
    const next = this.controlPoints[index + 2] ?? { x: 2 * p1.x - p0.x, z: 2 * p1.z - p0.z };
    const previousKnot = index ? this.knots[index - 1]! : t0 - (t1 - t0);
    const nextKnot = index + 2 < this.knots.length ? this.knots[index + 2]! : t1 + (t1 - t0);
    const m0 = { x: (p1.x - previous.x) / (t1 - previousKnot), z: (p1.z - previous.z) / (t1 - previousKnot) };
    const m1 = { x: (next.x - p0.x) / (nextKnot - t0), z: (next.z - p0.z) / (nextKnot - t0) };
    const u = scaled - index, u2 = u * u, u3 = u2 * u, span = t1 - t0;
    return { x: (2*u3-3*u2+1)*p0.x + (u3-2*u2+u)*span*m0.x + (-2*u3+3*u2)*p1.x + (u3-u2)*span*m1.x,
      z: (2*u3-3*u2+1)*p0.z + (u3-2*u2+u)*span*m0.z + (-2*u3+3*u2)*p1.z + (u3-u2)*span*m1.z };
  }

  private intersects(a: WorldBounds2D, b: WorldBounds2D): boolean {
    return a.maxX >= b.minX && a.minX <= b.maxX && a.maxZ >= b.minZ && a.minZ <= b.maxZ;
  }
}

/** Editable architectural test fixture in ordinary world units, not chunk offsets. */
export const WORLD_RIVER_CONTROL_POINTS: readonly RiverControlPoint[] = Object.freeze([
  { x: -24, z: 96 }, { x: -8, z: 70 }, { x: 20, z: 48 }, { x: 48, z: 38 },
  { x: 65, z: 36 }, { x: 45, z: 12 }, { x: 12, z: -8 }, { x: -25, z: -22 },
  { x: -52, z: -45 }, { x: -44, z: -72 }, { x: -12, z: -112 },
]);

/** Built exactly once at module initialization and independent of world seed/chunk state. */
export const worldRiverSpine = new RiverSpine(WORLD_RIVER_CONTROL_POINTS);
