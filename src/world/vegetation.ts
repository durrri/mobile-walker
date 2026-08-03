import { CHUNK_SIZE, type ChunkCoordinate } from "./chunkCoordinates";
import { sampleBiome, type BiomeId, type BiomeWeights } from "./biomes";
import { hashFloat, normalizeSeed } from "./random";
import { isLakeAt, mountainSnowCoverage, sampleTerrainHeight } from "./terrainSampling";
import { isVegetationExcluded, type PoiZone } from "./poi";
import {
  createWorldRiverEnvironmentContext,
  decideWorldRiverObjectPlacement,
  type RiverObjectCategory,
  type WorldRiverEnvironmentContext,
} from "./worldRiverEnvironment";

export type VegetationKind = "pine" | "leafTree" | "bush" | "flower";

export interface VegetationPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  readonly rotation: number;
  readonly shade: number;
}

export interface FlowerPlacement extends VegetationPlacement { readonly color: number; }

type FixedProbabilities = Readonly<Record<BiomeId, number>>;
type DensityProbabilities = Readonly<Record<BiomeId, Readonly<{
  sparse: number;
  dense: number;
  minScale: number;
  maxScale: number;
}>>>;

/** Everything the placement engine needs to place one species. */
export interface VegetationProfile {
  readonly cellSize: number;
  readonly salt: number;
  readonly probabilities: FixedProbabilities | DensityProbabilities;
  readonly scale: readonly [number, number];
  readonly dominantBiomes?: Readonly<{ allow?: readonly BiomeId[]; deny?: readonly BiomeId[] }>;
  readonly constraints: Readonly<{
    lake: boolean;
    snow: boolean;
    mountainRock: boolean;
  }>;
  readonly collision?: Readonly<{ radius: number }>;
  readonly densityField?: "forest";
  readonly candidateLayout: "centered" | "inset";
  readonly capChanceInPlains?: boolean;
}

const PINE_PROBABILITIES: DensityProbabilities = {
  plains: { sparse: 0.002, dense: 0.055, minScale: 0.68, maxScale: 0.98 },
  forest: { sparse: 0.12, dense: 0.76, minScale: 0.92, maxScale: 1.34 },
  wetland: { sparse: 0.005, dense: 0.07, minScale: 0.72, maxScale: 1.02 },
  lake: { sparse: 0, dense: 0, minScale: 0.7, maxScale: 0.9 },
  highlands: { sparse: 0.025, dense: 0.24, minScale: 0.58, maxScale: 0.88 },
  mountain: { sparse: 0.004, dense: 0.035, minScale: 0.55, maxScale: 0.78 },
};
const LEAF_TREE_CHANCE: FixedProbabilities = { plains: 0.025, forest: 0.23, wetland: 0.14, lake: 0, highlands: 0.015, mountain: 0 };
const BUSH_CHANCE: FixedProbabilities = { plains: 0.003, forest: 0.34, wetland: 0.28, lake: 0, highlands: 0.16, mountain: 0.1 };
const FLOWER_CHANCE: FixedProbabilities = { plains: 0.72, forest: 0.07, wetland: 0.22, lake: 0, highlands: 0.08, mountain: 0 };

/** Shared declarative definitions. Salts and layouts retain the previous generated world. */
export const VEGETATION_PROFILES: Readonly<Record<VegetationKind, VegetationProfile>> = {
  pine: {
    cellSize: 2, salt: 411, probabilities: PINE_PROBABILITIES, scale: [0.55, 1.34],
    dominantBiomes: { deny: ["plains", "wetland"] },
    constraints: { lake: true, snow: true, mountainRock: false },
    collision: { radius: 0.16 }, densityField: "forest", candidateLayout: "centered",
  },
  leafTree: {
    cellSize: 2.5, salt: 501, probabilities: LEAF_TREE_CHANCE, scale: [0.72, 1.18],
    dominantBiomes: { deny: ["mountain"] },
    constraints: { lake: true, snow: true, mountainRock: true },
    collision: { radius: 0.2 }, candidateLayout: "inset", capChanceInPlains: true,
  },
  bush: {
    cellSize: 1.6, salt: 521, probabilities: BUSH_CHANCE, scale: [0.62, 1.2],
    constraints: { lake: true, snow: true, mountainRock: false },
    candidateLayout: "inset", capChanceInPlains: true,
  },
  flower: {
    cellSize: 0.8, salt: 541, probabilities: FLOWER_CHANCE, scale: [0.72, 1.18],
    dominantBiomes: { deny: ["mountain"] },
    constraints: { lake: true, snow: true, mountainRock: true },
    candidateLayout: "inset", capChanceInPlains: true,
  },
};

export const TREE_TRUNK_RADIUS = VEGETATION_PROFILES.pine.collision!.radius;
export const LEAF_TREE_TRUNK_RADIUS = VEGETATION_PROFILES.leafTree.collision!.radius;
const FLOWER_COLORS = [0xf1d36b, 0xf0eee4, 0xd99ab3, 0x9cadd8, 0xd97862] as const;
const FOREST_CELL_SIZE = 32;
const BIOMES: readonly BiomeId[] = ["plains", "forest", "wetland", "lake", "highlands", "mountain"];

function smoothstep(value: number): number { return value * value * (3 - 2 * value); }

/** A broad continuous field forming meadow gaps and forest stands. */
export function sampleForestDensity(seed: number, worldX: number, worldZ: number): number {
  const latticeX = worldX / FOREST_CELL_SIZE;
  const latticeZ = worldZ / FOREST_CELL_SIZE;
  const x0 = Math.floor(latticeX), z0 = Math.floor(latticeZ);
  const x = smoothstep(latticeX - x0), z = smoothstep(latticeZ - z0);
  const top = hashFloat(seed, x0, z0, 401) * (1 - x) + hashFloat(seed, x0 + 1, z0, 401) * x;
  const bottom = hashFloat(seed, x0, z0 + 1, 401) * (1 - x) + hashFloat(seed, x0 + 1, z0 + 1, 401) * x;
  return top * (1 - z) + bottom * z;
}

function isDensityProfile(value: VegetationProfile["probabilities"]): value is DensityProbabilities {
  return typeof value.plains === "object";
}

export function treeChance(density: number, weights: BiomeWeights): number {
  const shaped = smoothstep(Math.max(0, Math.min(1, density)));
  return BIOMES.reduce((sum, biome) => {
    const value = PINE_PROBABILITIES[biome];
    return sum + weights[biome] * (value.sparse + (value.dense - value.sparse) * shaped);
  }, 0);
}

function blendedFixed(weights: BiomeWeights, probabilities: FixedProbabilities): number {
  return BIOMES.reduce((sum, biome) => sum + weights[biome] * probabilities[biome], 0);
}

/** Deterministically runs the common candidate, terrain and constraint pipeline. */
export function generateVegetationKind(kind: VegetationKind, seedInput: number | string, coordinate: ChunkCoordinate, exclusions: readonly PoiZone[] = [], riverContext?: WorldRiverEnvironmentContext): readonly VegetationPlacement[] {
  const seed = normalizeSeed(seedInput), profile = VEGETATION_PROFILES[kind];
  const cellsPerSide = Math.ceil(CHUNK_SIZE / profile.cellSize);
  const startX = coordinate.x * CHUNK_SIZE, startZ = coordinate.z * CHUNK_SIZE;
  riverContext ??= createWorldRiverEnvironmentContext({
    minX: startX, maxX: startX + CHUNK_SIZE, minZ: startZ, maxZ: startZ + CHUNK_SIZE,
  });
  const riverCategory: RiverObjectCategory = kind === "flower" ? "tinyVegetation"
    : kind === "bush" ? "largeShrub" : "tree";
  const placements: VegetationPlacement[] = [];
  for (let localZ = 0; localZ < cellsPerSide; localZ += 1) for (let localX = 0; localX < cellsPerSide; localX += 1) {
    const cellX = coordinate.x * cellsPerSide + localX, cellZ = coordinate.z * cellsPerSide + localZ;
    const centered = profile.candidateLayout === "centered";
    const x = centered
      ? (cellX + 0.5) * profile.cellSize + (hashFloat(seed, cellX, cellZ, profile.salt) - 0.5) * 1.3
      : startX + (localX + 0.15 + hashFloat(seed, cellX, cellZ, profile.salt) * 0.7) * profile.cellSize;
    const z = centered
      ? (cellZ + 0.5) * profile.cellSize + (hashFloat(seed, cellX, cellZ, profile.salt + 1) - 0.5) * 1.3
      : startZ + (localZ + 0.15 + hashFloat(seed, cellX, cellZ, profile.salt + 1) * 0.7) * profile.cellSize;
    if (x < startX || z < startZ || x >= startX + CHUNK_SIZE || z >= startZ + CHUNK_SIZE) continue;
    const structureExcluded = isVegetationExcluded(x, z, exclusions);
    const riverDecision = decideWorldRiverObjectPlacement({
      seed, category: riverCategory, worldX: x, worldZ: z, identityX: cellX, identityZ: cellZ,
      structureExcluded, context: riverContext,
    });
    if (!riverDecision.accepted) continue;
    const biome = sampleBiome(seed, x, z), rules = profile.dominantBiomes;
    if (rules?.deny?.includes(biome.dominant) || (rules?.allow && !rules.allow.includes(biome.dominant))) continue;
    if (profile.constraints.lake && isLakeAt(seed, x, z)) continue;
    const height = sampleTerrainHeight(seed, x, z);
    if (profile.constraints.snow && mountainSnowCoverage(height, biome.weights) >= 1) continue;
    if (profile.constraints.mountainRock && biome.dominant === "mountain") continue;
    let chance: number, minScale = profile.scale[0], maxScale = profile.scale[1];
    if (isDensityProfile(profile.probabilities)) {
      const probabilities = profile.probabilities;
      chance = treeChance(sampleForestDensity(seed, x, z), biome.weights);
      minScale = BIOMES.reduce((sum, id) => sum + biome.weights[id] * probabilities[id].minScale, 0);
      maxScale = BIOMES.reduce((sum, id) => sum + biome.weights[id] * probabilities[id].maxScale, 0);
    } else {
      chance = blendedFixed(biome.weights, profile.probabilities);
      if (profile.capChanceInPlains && biome.dominant === "plains") chance = Math.min(profile.probabilities.plains, chance);
    }
    if (hashFloat(seed, cellX, cellZ, profile.salt + 2) >= chance) continue;
    placements.push({ x, y: height, z,
      scale: minScale + hashFloat(seed, cellX, cellZ, profile.salt + 3) * (maxScale - minScale),
      rotation: hashFloat(seed, cellX, cellZ, profile.salt + 4) * Math.PI * 2,
      shade: hashFloat(seed, cellX, cellZ, profile.salt + 5),
    });
  }
  return placements;
}

export function generateLeafTrees(seed: number | string, coordinate: ChunkCoordinate): readonly VegetationPlacement[] {
  return generateVegetationKind("leafTree", seed, coordinate);
}

export interface GeneratedVegetation {
  readonly leafTrees: readonly VegetationPlacement[];
  readonly bushes: readonly VegetationPlacement[];
  readonly flowers: readonly FlowerPlacement[];
}

export function generateVegetation(seedInput: number | string, coordinate: ChunkCoordinate, exclusions: readonly PoiZone[] = [], riverContext?: WorldRiverEnvironmentContext): GeneratedVegetation {
  const seed = normalizeSeed(seedInput);
  return {
    leafTrees: generateVegetationKind("leafTree", seed, coordinate, exclusions, riverContext),
    bushes: generateVegetationKind("bush", seed, coordinate, exclusions, riverContext),
    flowers: generateVegetationKind("flower", seed, coordinate, exclusions, riverContext).map((placement) => ({
      ...placement,
      color: FLOWER_COLORS[Math.floor(hashFloat(seed, Math.floor(placement.x / 0.8), Math.floor(placement.z / 0.8), 547) * FLOWER_COLORS.length)]!,
    })),
  };
}
