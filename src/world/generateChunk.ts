import { CHUNK_SIZE, type ChunkCoordinate } from "./chunkCoordinates";
import { chunkId, type ChunkId } from "./chunkId";
import { sampleBiome, type BiomeWeights } from "./biomes";
import { generateTrees, type TreePlacement } from "./forest";
import { normalizeSeed } from "./random";
import { isRiverColumn, sampleRiverBoundary, sampleRiverSpine, type RiverBoundary, type RiverPoint } from "./river";
import {
  RIVER_BANK_WIDTH,
  RIVER_BED_DEPTH,
  RIVER_TRANSITION_WIDTH,
  sampleChannelTerrainHeight,
  sampleChannelTerrainHeightInContext,
  sampleNaturalTerrainHeight,
  sampleRiverCrossSection,
  TERRAIN_SEGMENTS,
} from "./terrainSampling";
import { createWorldRiverCarvingContext } from "./worldRiverCarving";
import { sampleWorldRiverCarving, WORLD_RIVER_MAX_CARVING_RADIUS } from "./worldRiverCarving";
import { generateVegetation, type GeneratedVegetation } from "./vegetation";
import { generatePois, isVegetationExcluded, type GeneratedPoi, type PoiDebugCandidate } from "./poi";
import { generateWetlandPools, type WetlandPoolPlacement } from "./wetlands";
import { placeCollectibles, type CollectiblePlacement } from "./collectibles";
import { generateBridges, type BridgeCrossingCandidate, type GeneratedBridge } from "./bridges";
import { validateStructureDefinition } from "./structureTypes";
import {
  DEFAULT_TERRAIN_OCCLUSION_OPTIONS,
  sampleTerrainOcclusion,
  type TerrainOcclusionOptions,
} from "./terrainOcclusion";

export { TERRAIN_SEGMENTS } from "./terrainSampling";

export interface RiverChannelSection {
  readonly z: number;
  readonly centerX: number;
  readonly waterHalfWidth: number;
  readonly bankWidth: number;
  readonly surfaceElevation: number;
  readonly westShoulderHeight: number;
  readonly eastShoulderHeight: number;
  /** Terrain presentation inputs for the six channel cross-section vertices. */
  readonly terrainVertices: readonly Pick<IrregularTerrainVertex, "biomeWeights" | "occlusion">[];
}

export interface IrregularTerrainVertex {
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly biomeWeights: BiomeWeights;
  readonly occlusion: number;
}

export interface GeneratedChunkData {
  readonly seed: number;
  readonly id: ChunkId;
  readonly coordinate: ChunkCoordinate;
  readonly size: number;
  readonly terrainHeights: readonly number[];
  /** Biome blend at each terrain vertex, using the same row-major layout as terrainHeights. */
  readonly terrainBiomeWeights: readonly BiomeWeights[];
  /** Worker-baked, global sunlight obstruction in the range [0, 1]. */
  readonly terrainOcclusion: readonly number[];
  /** Presentation-neutral buffers baked off-thread and transferred without cloning. */
  readonly terrainMesh: { readonly positions: Float32Array; readonly indices: Uint16Array; readonly normals: Float32Array };
  readonly terrainMaximumDarkening: number;
  readonly terrainVerticesPerSide: number;
  /** Explicit coarse regions used when a rectangular grid would overlap the river channel. */
  readonly irregularTerrain?: {
    readonly vertices: readonly IrregularTerrainVertex[];
    readonly indices: readonly number[];
  };
  readonly pines: readonly TreePlacement[];
  readonly pois: readonly GeneratedPoi[];
  /** Span POIs have their own crossing-oriented contract rather than pretending to be point POIs. */
  readonly bridges: readonly GeneratedBridge[];
  readonly poiCandidates?: readonly PoiDebugCandidate[];
  readonly bridgeCandidates?: readonly BridgeCrossingCandidate[];
  readonly collectibles: readonly CollectiblePlacement[];
  readonly vegetation: GeneratedVegetation;
  readonly wetlandPools: readonly WetlandPoolPlacement[];
  readonly river?: {
    readonly entry: RiverBoundary;
    readonly exit: RiverBoundary;
    readonly spine: readonly RiverPoint[];
    readonly channelSections: readonly RiverChannelSection[];
  };
}

function generateRiverChannel(
  seed: number,
  coordinate: ChunkCoordinate,
  occlusionOptions: Readonly<TerrainOcclusionOptions>,
): {
  spine: readonly RiverPoint[];
  sections: readonly RiverChannelSection[];
} {
  // Eight longitudinal spans match the surrounding coarse terrain. The points
  // are only one-dimensional; no refined river-column terrain lattice is created.
  const sourceSpine = sampleRiverSpine(seed, coordinate, TERRAIN_SEGMENTS);
  const points: RiverPoint[] = [];
  const sections: RiverChannelSection[] = [];
  for (const { z } of sourceSpine) {
    // Any x in column zero selects the same cross-section; centerX is returned by
    // the sampler and becomes the actual ribbon position.
    const section = sampleRiverCrossSection(seed, CHUNK_SIZE / 2, z);
    if (!section) continue;
    const waterHalfWidth = section.waterWidth / 2;
    const bankWidth = RIVER_BANK_WIDTH + RIVER_TRANSITION_WIDTH;
    const westShoulderHeight = sampleNaturalTerrainHeight(seed, section.centerX - waterHalfWidth - bankWidth, z);
    const eastShoulderHeight = sampleNaturalTerrainHeight(seed, section.centerX + waterHalfWidth + bankWidth, z);
    points.push({ x: section.centerX, z, width: section.waterWidth, surfaceElevation: section.surfaceElevation });
    const crossSection = [
      [section.centerX - waterHalfWidth - bankWidth, westShoulderHeight],
      [section.centerX - waterHalfWidth, section.surfaceElevation + 0.04],
      [section.centerX - waterHalfWidth + waterHalfWidth * 0.1, section.surfaceElevation - RIVER_BED_DEPTH],
      [section.centerX + waterHalfWidth - waterHalfWidth * 0.1, section.surfaceElevation - RIVER_BED_DEPTH],
      [section.centerX + waterHalfWidth, section.surfaceElevation + 0.04],
      [section.centerX + waterHalfWidth + bankWidth, eastShoulderHeight],
    ] as const;
    sections.push({
      z,
      centerX: section.centerX,
      waterHalfWidth,
      bankWidth,
      surfaceElevation: section.surfaceElevation,
      westShoulderHeight,
      eastShoulderHeight,
      terrainVertices: crossSection.map(([x, height]) => ({
        biomeWeights: sampleBiome(seed, x, z).weights,
        occlusion: sampleTerrainOcclusion(
          x, z, height,
          (sampleX, sampleZ) => sampleChannelTerrainHeight(seed, sampleX, sampleZ),
          occlusionOptions,
        ),
      })),
    });
  }
  return { spine: points, sections };
}

/** Pure, random-access generation: output is solely a function of seed and coordinate. */
export function generateChunk(
  seedInput: number | string,
  coordinate: ChunkCoordinate,
  occlusionOptions: Readonly<TerrainOcclusionOptions> = DEFAULT_TERRAIN_OCCLUSION_OPTIONS,
  includeDebugData = false,
): GeneratedChunkData {
  const seed = normalizeSeed(seedInput);
  const terrainSegments = TERRAIN_SEGMENTS;
  const verticesPerSide = terrainSegments + 1;
  const terrainHeights: number[] = [];
  const terrainBiomeWeights: BiomeWeights[] = [];
  const terrainOcclusion: number[] = [];
  const minX = coordinate.x * CHUNK_SIZE;
  const minZ = coordinate.z * CHUNK_SIZE;
  const riverCarvingContext = createWorldRiverCarvingContext({
    minX, maxX: minX + CHUNK_SIZE, minZ, maxZ: minZ + CHUNK_SIZE,
  });
  const sampleAuthoritativeHeight = (worldX: number, worldZ: number): number =>
    sampleChannelTerrainHeightInContext(seed, worldX, worldZ, riverCarvingContext);
  for (let z = 0; z < verticesPerSide; z += 1) {
    for (let x = 0; x < verticesPerSide; x += 1) {
      // Use global lattice coordinates so neighboring terrain edges also agree.
      const worldX = coordinate.x * CHUNK_SIZE + x * CHUNK_SIZE / terrainSegments;
      const worldZ = coordinate.z * CHUNK_SIZE + z * CHUNK_SIZE / terrainSegments;
      const height = sampleAuthoritativeHeight(worldX, worldZ);
      terrainHeights.push(height);
      terrainBiomeWeights.push(sampleBiome(seed, worldX, worldZ).weights);
      terrainOcclusion.push(sampleTerrainOcclusion(
        worldX, worldZ, height,
        sampleAuthoritativeHeight,
        occlusionOptions,
      ));
    }
  }

  const channel = isRiverColumn(coordinate) ? generateRiverChannel(seed, coordinate, occlusionOptions) : undefined;
  // POIs deliberately precede every placed-object pass. Their global zones may
  // cross this chunk even when the owning origin is in a neighbor.
  const poiNeighborhood = [] as GeneratedPoi[];
  let ownedCandidates: readonly PoiDebugCandidate[] = [];
  for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
    const generated = generatePois(seed, { x: coordinate.x + dx, z: coordinate.z + dz });
    poiNeighborhood.push(...generated.pois);
    if (dx === 0 && dz === 0) ownedCandidates = generated.candidates;
  }
  const pois = poiNeighborhood.filter(poi => poi.ownerChunk.x === coordinate.x && poi.ownerChunk.z === coordinate.z);
  const bridgeNeighborhood:GeneratedBridge[]=[];
  let ownedBridgeCandidates:readonly BridgeCrossingCandidate[]=[];
  for(let dz=-1;dz<=1;dz++){const generated=generateBridges(seed,{x:coordinate.x,z:coordinate.z+dz},poiNeighborhood);bridgeNeighborhood.push(...generated.bridges);if(dz===0)ownedBridgeCandidates=generated.candidates;}
  const bridges=bridgeNeighborhood.filter(bridge=>bridge.ownerChunk.x===coordinate.x&&bridge.ownerChunk.z===coordinate.z);
  // Structural parity is checked once as records enter the generated repository,
  // never during rendering or a movement query.
  for(const definition of [...pois.map(poi=>poi.structure),...bridges.map(bridge=>bridge.collision)])validateStructureDefinition(definition);
  const exclusionZones = [...poiNeighborhood.flatMap(poi => poi.zones),...bridgeNeighborhood.flatMap(bridge=>bridge.zones)];
  // R3 mixed state: the legacy river still supplies water/banks/bridges and
  // downstream data, but it no longer replaces or carves the terrain mesh.
  // R4/R5 will migrate those remaining systems to the world spine.
  let irregularTerrain: GeneratedChunkData["irregularTerrain"] = undefined;
  let meshVertices = terrainHeights.map((height, vertexIndex) => ({
    x: coordinate.x * CHUNK_SIZE + vertexIndex % verticesPerSide * CHUNK_SIZE / terrainSegments,
    z: coordinate.z * CHUNK_SIZE + Math.floor(vertexIndex / verticesPerSide) * CHUNK_SIZE / terrainSegments,
    height,
  }));
  let meshIndices: number[] = [];
  for (let z = 0; z < terrainSegments; z++) for (let x = 0; x < terrainSegments; x++) {
    const topLeft = z * verticesPerSide + x;
    meshIndices.push(topLeft, topLeft + verticesPerSide, topLeft + 1, topLeft + 1, topLeft + verticesPerSide, topLeft + verticesPerSide + 1);
  }
  if (riverCarvingContext.hasRiver) {
    // R4.5 refines only coarse cells in a narrow corridor. Keeping each cell
    // self-contained permits deterministic mixed resolution; the expanded
    // selection boundary lies beyond the bank falloff where fine edge samples
    // reduce exactly to the original piecewise-linear natural terrain.
    const vertices: IrregularTerrainVertex[] = [];
    const indices: number[] = [];
    const coarseStep = CHUNK_SIZE / terrainSegments;
    for (let cellZ = 0; cellZ < terrainSegments; cellZ++) for (let cellX = 0; cellX < terrainSegments; cellX++) {
      const cellMinX = minX + cellX * coarseStep, cellMinZ = minZ + cellZ * coarseStep;
      const centreSample = sampleWorldRiverCarving(
        cellMinX + coarseStep / 2, cellMinZ + coarseStep / 2, riverCarvingContext,
      );
      const refine = centreSample !== undefined
        && centreSample.distanceToCentreline <= WORLD_RIVER_MAX_CARVING_RADIUS + coarseStep * Math.SQRT1_2;
      const divisions = refine ? 4 : 1;
      const base = vertices.length;
      for (let localZ = 0; localZ <= divisions; localZ++) for (let localX = 0; localX <= divisions; localX++) {
        const worldX = cellMinX + coarseStep * localX / divisions;
        const worldZ = cellMinZ + coarseStep * localZ / divisions;
        const height = sampleAuthoritativeHeight(worldX, worldZ);
        vertices.push({
          x: worldX, z: worldZ, height,
          biomeWeights: sampleBiome(seed, worldX, worldZ).weights,
          occlusion: sampleTerrainOcclusion(worldX, worldZ, height, sampleAuthoritativeHeight, occlusionOptions),
        });
      }
      const row = divisions + 1;
      for (let localZ = 0; localZ < divisions; localZ++) for (let localX = 0; localX < divisions; localX++) {
        const topLeft = base + localZ * row + localX;
        indices.push(topLeft, topLeft + row, topLeft + 1, topLeft + 1, topLeft + row, topLeft + row + 1);
      }
    }
    irregularTerrain = { vertices, indices };
    meshVertices = vertices;
    meshIndices = indices;
  }
  const positions = new Float32Array(meshVertices.length * 3);
  meshVertices.forEach((vertex, index) => positions.set([vertex.x, vertex.height, vertex.z], index * 3));
  const indices = new Uint16Array(meshIndices);
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a=indices[i]!*3,b=indices[i+1]!*3,c=indices[i+2]!*3;
    const abx=positions[b]!-positions[a]!,aby=positions[b+1]!-positions[a+1]!,abz=positions[b+2]!-positions[a+2]!;
    const acx=positions[c]!-positions[a]!,acy=positions[c+1]!-positions[a+1]!,acz=positions[c+2]!-positions[a+2]!;
    const nx=aby*acz-abz*acy,ny=abz*acx-abx*acz,nz=abx*acy-aby*acx;
    for(const offset of [a,b,c]) { normals[offset]!+=nx;normals[offset+1]!+=ny;normals[offset+2]!+=nz; }
  }
  for(let i=0;i<normals.length;i+=3){const length=Math.hypot(normals[i]!,normals[i+1]!,normals[i+2]!)||1;normals[i]!/=length;normals[i+1]!/=length;normals[i+2]!/=length;}
  return {
    seed,
    id: chunkId(coordinate),
    coordinate: { ...coordinate },
    size: CHUNK_SIZE,
    terrainHeights,
    terrainBiomeWeights,
    terrainOcclusion,
    terrainMesh: { positions, indices, normals },
    terrainMaximumDarkening: occlusionOptions.maximumDarkening,
    terrainVerticesPerSide: verticesPerSide,
    irregularTerrain,
    pines: generateTrees(seed, coordinate).filter(tree => !isVegetationExcluded(tree.x, tree.z, exclusionZones)),
    pois,
    bridges,
    poiCandidates: includeDebugData ? ownedCandidates : undefined,
    bridgeCandidates:includeDebugData?ownedBridgeCandidates:undefined,
    collectibles: placeCollectibles(seed, coordinate, exclusionZones),
    vegetation: generateVegetation(seed, coordinate, exclusionZones),
    wetlandPools: generateWetlandPools(seed, coordinate).filter(pool => !isVegetationExcluded(pool.x, pool.z, exclusionZones)),
    river: channel ? {
      entry: sampleRiverBoundary(seed, coordinate, "north"),
      exit: sampleRiverBoundary(seed, coordinate, "south"),
      spine: channel.spine,
      channelSections: channel.sections,
    } : undefined,
  };
}
