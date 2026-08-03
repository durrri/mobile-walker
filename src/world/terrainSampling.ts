import { CHUNK_SIZE, worldToChunk } from "./chunkCoordinates";
import { sampleBiome, type BiomeId, type BiomeWeights } from "./biomes";
import { hashFloat, normalizeSeed } from "./random";
import { isRiverColumn, sampleRiverSpine } from "./river";
import {
  applyWorldRiverCarving,
  sampleWorldRiverCarving,
  type WorldRiverCarvingContext,
} from "./worldRiverCarving";

export type TerrainSurface = "land" | "river" | "lake";
/** Default chunk resolution; dry chunks retain the original generation cost. */
export const TERRAIN_SEGMENTS = 8;

export interface TerrainSample {
  readonly height: number;
  readonly surface: TerrainSurface;
  readonly biome: BiomeId;
  readonly biomeWeights: BiomeWeights;
}

const LATTICE_SPACING = CHUNK_SIZE / TERRAIN_SEGMENTS;
/**
 * Vertical distance from the water surface to the walkable river bed.
 *
 * The player is approximately 1.5 world units tall, so this submerges them by
 * roughly 30% of their height while they cross a river.
 */
export const RIVER_BED_DEPTH = 0.45;
/** Shared level and depth for the broad lake basin. */
export const LAKE_SURFACE_ELEVATION = -0.08;
export const LAKE_BED_DEPTH = 0.72;
export const LAKE_WATER_WEIGHT = 0.34;
const LAKE_BANK_WEIGHT = 0.18;
/** Horizontal distances beyond the water edge occupied by each bank region. */
export const RIVER_BANK_WIDTH = 0.75;
export const RIVER_TRANSITION_WIDTH = 1.25;
/** Only the highest mountain summits reach the permanent snow line. */
export const MOUNTAIN_SNOW_LINE = 12.5;
export const MOUNTAIN_SNOW_BLEND_DEPTH = 0.65;

/**
 * Snow is a mountain-biome surface rather than a global elevation effect.
 * The short blend below the permanent snow line softens the edge of the cap.
 */
export function mountainSnowCoverage(height: number, biomeWeights: BiomeWeights): number {
  let dominant: BiomeId = "plains";
  for (const id of Object.keys(biomeWeights) as BiomeId[]) {
    if (biomeWeights[id] > biomeWeights[dominant]) dominant = id;
  }
  if (dominant !== "mountain") return 0;
  return Math.max(0, Math.min(
    1,
    (height - (MOUNTAIN_SNOW_LINE - MOUNTAIN_SNOW_BLEND_DEPTH)) / MOUNTAIN_SNOW_BLEND_DEPTH,
  ));
}

export interface RiverCrossSectionSample {
  readonly centerX: number;
  readonly waterWidth: number;
  readonly surfaceElevation: number;
  /** Absolute lateral distance, where 1 is exactly the rendered water edge. */
  readonly normalizedLateralDistance: number;
}

/**
 * Samples the authoritative river cross-section at an arbitrary world point.
 * Keeping interpolation here prevents water geometry, collision, and terrain
 * carving from independently interpreting the river spine.
 */
export function sampleRiverCrossSection(
  seedInput: number | string,
  worldX: number,
  worldZ: number,
): RiverCrossSectionSample | undefined {
  const seed = normalizeSeed(seedInput);
  const coordinate = worldToChunk(worldX, worldZ);
  if (!isRiverColumn(coordinate)) return undefined;
  const spine = sampleRiverSpine(seed, coordinate);
  const local = (worldZ - coordinate.z * CHUNK_SIZE) / CHUNK_SIZE;
  const segmentPosition = Math.max(0, Math.min(1, local)) * (spine.length - 1);
  const index = Math.min(spine.length - 2, Math.floor(segmentPosition));
  const fraction = segmentPosition - index;
  const start = spine[index];
  const end = spine[index + 1];
  if (!start || !end) return undefined;

  const centerX = start.x + (end.x - start.x) * fraction;
  const waterWidth = start.width + (end.width - start.width) * fraction;
  return {
    centerX,
    waterWidth,
    surfaceElevation: start.surfaceElevation
      + (end.surfaceElevation - start.surfaceElevation) * fraction,
    normalizedLateralDistance: Math.abs(worldX - centerX) / (waterWidth / 2),
  };
}

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

const ELEVATION_PROFILES: Readonly<Record<BiomeId, {
  readonly base: number;
  readonly broad: number;
  readonly detail: number;
}>> = {
  plains: { base: -0.04, broad: 0.42, detail: 0.1 },
  forest: { base: 0.04, broad: 0.68, detail: 0.18 },
  wetland: { base: -0.12, broad: 0.25, detail: 0.07 },
  lake: { base: -0.16, broad: 0.22, detail: 0.05 },
  // Highlands deliberately have enough relief for tall hills and locally
  // steep faces, while biome blending still eases the transition into them.
  highlands: { base: 0.5, broad: 2.35, detail: 0.78 },
  // Keep the mountain's silhouette driven by its broad biome envelope rather
  // than per-vertex noise. A taller base creates a pronounced summit, while
  // restrained variation prevents holes and dips from breaking up the massif.
  mountain: { base: 22, broad: 1.4, detail: 0.18 },
};

/** Height at one vertex of the infinite, seeded terrain lattice. */
export function sampleTerrainLatticeHeight(seed: number, latticeX: number, latticeZ: number): number {
  const broad = hashFloat(seed, Math.floor(latticeX / 2), Math.floor(latticeZ / 2), 13);
  const detail = hashFloat(seed, latticeX, latticeZ, 29);
  const worldX = latticeX * LATTICE_SPACING;
  const worldZ = latticeZ * LATTICE_SPACING;
  const weights = sampleBiome(seed, worldX, worldZ).weights;

  let base = 0;
  let broadAmplitude = 0;
  let detailAmplitude = 0;
  for (const id of Object.keys(ELEVATION_PROFILES) as BiomeId[]) {
    const profile = ELEVATION_PROFILES[id];
    base += weights[id] * profile.base;
    broadAmplitude += weights[id] * profile.broad;
    detailAmplitude += weights[id] * profile.detail;
  }

  return base + (broad - 0.5) * broadAmplitude + (detail - 0.5) * detailAmplitude;
}

export function sampleNaturalTerrainHeight(seed: number, worldX: number, worldZ: number): number {
  const latticeX = worldX / LATTICE_SPACING;
  const latticeZ = worldZ / LATTICE_SPACING;
  const x0 = Math.floor(latticeX);
  const z0 = Math.floor(latticeZ);
  const x = latticeX - x0;
  const z = latticeZ - z0;
  const topLeft = sampleTerrainLatticeHeight(seed, x0, z0);
  const topRight = sampleTerrainLatticeHeight(seed, x0 + 1, z0);
  const bottomLeft = sampleTerrainLatticeHeight(seed, x0, z0 + 1);
  if (x + z <= 1) return topLeft + (topRight - topLeft) * x + (bottomLeft - topLeft) * z;
  const bottomRight = sampleTerrainLatticeHeight(seed, x0 + 1, z0 + 1);
  return bottomRight + (bottomLeft - bottomRight) * (1 - x) + (topRight - bottomRight) * (1 - z);
}

/**
 * Height of a rendered terrain-lattice vertex after carving the river channel.
 * The channel has a gently shaped submerged bed, a distinct sloping bank, and
 * a smooth shoulder that returns to untouched natural terrain.
 */
export function sampleChannelTerrainLatticeHeight(
  seed: number,
  latticeX: number,
  latticeZ: number,
): number {
  const worldX = latticeX * LATTICE_SPACING;
  const worldZ = latticeZ * LATTICE_SPACING;
  return sampleChannelTerrainHeight(seed, worldX, worldZ);
}

/** Height at any world position after applying the authoritative channel profile. */
export function sampleChannelTerrainHeight(seed: number, worldX: number, worldZ: number): number {
  const naturalHeight = sampleNaturalTerrainHeight(seed, worldX, worldZ);
  const lakeWeight = sampleBiome(seed, worldX, worldZ).weights.lake;
  let shapedHeight = naturalHeight;
  if (lakeWeight > LAKE_BANK_WEIGHT) {
    const basinBlend = smoothstep((lakeWeight - LAKE_BANK_WEIGHT) / (LAKE_WATER_WEIGHT - LAKE_BANK_WEIGHT));
    const bedHeight = LAKE_SURFACE_ELEVATION - LAKE_BED_DEPTH;
    shapedHeight = naturalHeight + (Math.min(naturalHeight, bedHeight) - naturalHeight) * basinBlend;
  }
  return applyWorldRiverCarving(shapedHeight, sampleWorldRiverCarving(worldX, worldZ));
}

/** Bounded variant used by chunk generation; it never invokes the global diagnostic scan. */
export function sampleChannelTerrainHeightInContext(
  seed: number,
  worldX: number,
  worldZ: number,
  riverContext: WorldRiverCarvingContext,
): number {
  const naturalHeight = sampleNaturalTerrainHeight(seed, worldX, worldZ);
  const lakeWeight = sampleBiome(seed, worldX, worldZ).weights.lake;
  const shapedHeight = lakeWeight > LAKE_BANK_WEIGHT
    ? naturalHeight + (Math.min(naturalHeight, LAKE_SURFACE_ELEVATION - LAKE_BED_DEPTH) - naturalHeight)
      * smoothstep((lakeWeight - LAKE_BANK_WEIGHT) / (LAKE_WATER_WEIGHT - LAKE_BANK_WEIGHT))
    : naturalHeight;
  return applyWorldRiverCarving(shapedHeight, sampleWorldRiverCarving(worldX, worldZ, riverContext));
}

/**
 * Pure random-access terrain query. The triangular interpolation matches the
 * terrain mesh and uses global lattice coordinates, including for negatives.
 */
export function sampleTerrainHeight(seedInput: number | string, worldX: number, worldZ: number): number {
  const seed = normalizeSeed(seedInput);
  const spacing = CHUNK_SIZE / TERRAIN_SEGMENTS;
  const latticeX = worldX / spacing;
  const latticeZ = worldZ / spacing;
  const x0 = Math.floor(latticeX);
  const z0 = Math.floor(latticeZ);
  const x = latticeX - x0;
  const z = latticeZ - z0;
  const sample = (xIndex: number, zIndex: number) =>
    sampleChannelTerrainHeight(seed, xIndex * spacing, zIndex * spacing);
  const topLeft = sample(x0, z0);
  const topRight = sample(x0 + 1, z0);
  const bottomLeft = sample(x0, z0 + 1);

  if (x + z <= 1) return topLeft + (topRight - topLeft) * x + (bottomLeft - topLeft) * z;
  const bottomRight = sample(x0 + 1, z0 + 1);
  return bottomRight + (bottomLeft - bottomRight) * (1 - x) + (topRight - bottomRight) * (1 - z);
}

/** Returns whether a point is inside the generated river ribbon. */
export function isRiverAt(seedInput: number | string, worldX: number, worldZ: number): boolean {
  const crossSection = sampleRiverCrossSection(seedInput, worldX, worldZ);
  // Include mathematically exact mesh-edge positions despite the final
  // subtraction/division accumulating a few floating-point ULPs.
  return crossSection !== undefined && crossSection.normalizedLateralDistance <= 1 + 1e-9;
}

/** Returns whether a point lies in the flooded center of a lake biome. */
export function isLakeAt(seedInput: number | string, worldX: number, worldZ: number): boolean {
  return sampleBiome(seedInput, worldX, worldZ).weights.lake >= LAKE_WATER_WEIGHT;
}

export function sampleTerrain(seed: number | string, worldX: number, worldZ: number): TerrainSample {
  const biome = sampleBiome(seed, worldX, worldZ);
  return {
    height: sampleTerrainHeight(seed, worldX, worldZ),
    surface: isRiverAt(seed, worldX, worldZ) ? "river" : isLakeAt(seed, worldX, worldZ) ? "lake" : "land",
    biome: biome.dominant,
    biomeWeights: biome.weights,
  };
}
