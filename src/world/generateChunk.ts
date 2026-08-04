import cdt2d from "cdt2d";
import cleanPSLG from "clean-pslg";

import { CHUNK_SIZE, type ChunkCoordinate } from "./chunkCoordinates";
import { chunkId, type ChunkId } from "./chunkId";
import { sampleBiome, type BiomeWeights } from "./biomes";
import { generateTrees, type TreePlacement } from "./forest";
import { normalizeSeed } from "./random";
import {
  sampleChannelTerrainHeightInContext,
  TERRAIN_SEGMENTS,
} from "./terrainSampling";
import { sampleWorldRiverCarving, WORLD_RIVER_CARVING, WORLD_RIVER_LIP_CREST_DISTANCE,
  WORLD_RIVER_MAX_CARVING_RADIUS } from "./worldRiverCarving";
import { createWorldRiverEnvironmentContext } from "./worldRiverEnvironment";
import type { RiverSpine } from "./riverSpineGeometry";
import { getWorldRiverOwner } from "./worldRiverOwner";
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

export interface IrregularTerrainVertex {
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly biomeWeights: BiomeWeights;
  readonly occlusion: number;
  /** Present on deterministic river-aligned cross-section landmark strips. */
  readonly riverStripOffset?: number;
}

/** Global arc-length lattice; it never restarts at a chunk boundary. */
export const WORLD_RIVER_TERRAIN_STRIP_SAMPLE_SPACING = 0.5;
const terrainStripFrames = new Map<string, readonly ReturnType<RiverSpine["sampleFrame"]>[]>();

/** Resets the immutable strip-lattice memo for independent cold diagnostics. */
export function clearWorldRiverTerrainStripCache(): void { terrainStripFrames.clear(); }

function worldRiverTerrainStripFrames(spine: RiverSpine, identity: string): readonly ReturnType<RiverSpine["sampleFrame"]>[] {
  const retained = terrainStripFrames.get(identity); if (retained) return retained;
  const count = Math.ceil(spine.totalLength / WORLD_RIVER_TERRAIN_STRIP_SAMPLE_SPACING);
  const frames = Object.freeze(Array.from({ length: count + 1 }, (_, index) => {
    const distance = Math.min(index * WORLD_RIVER_TERRAIN_STRIP_SAMPLE_SPACING, spine.totalLength);
    return spine.sampleFrame(spine.progressAtDistance(distance));
  }));
  terrainStripFrames.set(identity, frames); return frames;
}

export interface GeneratedChunkData {
  readonly seed: number;
  readonly riverGenerationIdentity: string;
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

}

export interface ChunkGenerationStageTimings {
  terrainFieldMs: number;
  poiAndBridgeMs: number;
  terrainTriangulationMs: number;
  objectPlacementMs: number;
  totalMs: number;
}
export interface ChunkGenerationDiagnostics { record(timings: Readonly<ChunkGenerationStageTimings>): void }

/** Pure, random-access generation: output is solely a function of seed and coordinate. */
export function generateChunk(
  seedInput: number | string,
  coordinate: ChunkCoordinate,
  occlusionOptions: Readonly<TerrainOcclusionOptions> = DEFAULT_TERRAIN_OCCLUSION_OPTIONS,
  includeDebugData = false,
  diagnostics?: ChunkGenerationDiagnostics,
): GeneratedChunkData {
  const generationStarted = diagnostics ? performance.now() : 0;
  const seed = normalizeSeed(seedInput);
  const riverOwner = getWorldRiverOwner(seedInput);
  const terrainSegments = TERRAIN_SEGMENTS;
  const verticesPerSide = terrainSegments + 1;
  const terrainHeights: number[] = [];
  const terrainBiomeWeights: BiomeWeights[] = [];
  const terrainOcclusion: number[] = [];
  const minX = coordinate.x * CHUNK_SIZE;
  const minZ = coordinate.z * CHUNK_SIZE;
  const riverEnvironmentContext = createWorldRiverEnvironmentContext({
    minX, maxX: minX + CHUNK_SIZE, minZ, maxZ: minZ + CHUNK_SIZE,
  }, riverOwner.spine);
  const riverCarvingContext = riverEnvironmentContext.carving;
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
  const terrainFieldFinished = diagnostics ? performance.now() : 0;

  // POIs deliberately precede every placed-object pass. Their global zones may
  // cross this chunk even when the owning origin is in a neighbor.
  const poiNeighborhood = [] as GeneratedPoi[];
  let ownedCandidates: readonly PoiDebugCandidate[] = [];
  for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
    const generated = generatePois(seed, { x: coordinate.x + dx, z: coordinate.z + dz }, riverOwner.spine, riverOwner.identity);
    poiNeighborhood.push(...generated.pois);
    if (dx === 0 && dz === 0) ownedCandidates = generated.candidates;
  }
  const pois = poiNeighborhood.filter(poi => poi.ownerChunk.x === coordinate.x && poi.ownerChunk.z === coordinate.z);
  const bridgeNeighborhood:GeneratedBridge[]=[];
  let ownedBridgeCandidates:readonly BridgeCrossingCandidate[]=[];
  for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){const generated=generateBridges(seed,{x:coordinate.x+dx,z:coordinate.z+dz},poiNeighborhood,riverOwner.spine,riverOwner.identity);bridgeNeighborhood.push(...generated.bridges);if(dx===0&&dz===0)ownedBridgeCandidates=generated.candidates;}
  const bridges=bridgeNeighborhood.filter(bridge=>bridge.ownerChunk.x===coordinate.x&&bridge.ownerChunk.z===coordinate.z);
  // Structural parity is checked once as records enter the generated repository,
  // never during rendering or a movement query.
  for(const definition of [...pois.map(poi=>poi.structure),...bridges.map(bridge=>bridge.collision)])validateStructureDefinition(definition);
  const exclusionZones = [...poiNeighborhood.flatMap(poi => poi.zones),...bridgeNeighborhood.flatMap(bridge=>bridge.zones)];
  const structuresFinished = diagnostics ? performance.now() : 0;
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
    // R4.5 retains the ordinary coarse grid around a narrow, constrained set
    // of river-aligned strips, so refinement cost follows the corridor only.
    let vertices: IrregularTerrainVertex[] = [];
    const pointIndex = new Map<string, number>();
    const addVertex = (worldX: number, worldZ: number, riverStripOffset?: number): number | undefined => {
      if (worldX < minX - 1e-8 || worldX > minX + CHUNK_SIZE + 1e-8
        || worldZ < minZ - 1e-8 || worldZ > minZ + CHUNK_SIZE + 1e-8) return undefined;
      const key = `${worldX.toFixed(9)},${worldZ.toFixed(9)}`;
      const existing = pointIndex.get(key);
      if (existing !== undefined) {
        if (riverStripOffset !== undefined && vertices[existing]!.riverStripOffset === undefined) {
          vertices[existing] = { ...vertices[existing]!, riverStripOffset };
        }
        return existing;
      }
      // This is deliberately the public movement sampler, not a presentation
      // interpolation: strip vertices define the rendered walkable surface.
      const height = sampleAuthoritativeHeight(worldX, worldZ);
      pointIndex.set(key, vertices.length);
      vertices.push({ x: worldX, z: worldZ, height,
        biomeWeights: sampleBiome(seed, worldX, worldZ).weights,
        // Dense river strips inherit neutral occlusion; evaluating the global
        // horizon kernel at every 0.5-wu strip point would dominate generation.
        occlusion: riverStripOffset === undefined
          ? sampleTerrainOcclusion(worldX, worldZ, height, sampleAuthoritativeHeight, occlusionOptions) : 0,
        riverStripOffset,
      });
      return vertices.length - 1;
    };
    const coarseStep = CHUNK_SIZE / terrainSegments;
    for (let cellZ = 0; cellZ < terrainSegments; cellZ++) for (let cellX = 0; cellX < terrainSegments; cellX++) {
      const cellMinX = minX + cellX * coarseStep, cellMinZ = minZ + cellZ * coarseStep;
      // Explicit river-aligned strips now provide the narrow refinement. The
      // surrounding grid stays coarse rather than paying for redundant 0.5-wu
      // vertices which cannot resolve the 0.20-wu shore feature anyway.
      const divisions = 1;
      for (let localZ = 0; localZ <= divisions; localZ++) for (let localX = 0; localX <= divisions; localX++) {
        const worldX = cellMinX + coarseStep * localX / divisions;
        const worldZ = cellMinZ + coarseStep * localZ / divisions;
        const river = sampleWorldRiverCarving(worldX, worldZ, riverCarvingContext);
        // Inside the corridor the constrained cross-section lattice replaces
        // the generic grid, preventing either overlapping surfaces or T-junctions.
        if (!river || river.distanceToCentreline >= WORLD_RIVER_MAX_CARVING_RADIUS - 1e-8) {
          addVertex(worldX, worldZ);
        }
      }
    }
    const { waterHalfWidth, bankWidth } = WORLD_RIVER_CARVING;
    // Quarter-shore strips make the 0.20 wu transition four explicit 0.05 wu
    // spans; midpoint strips similarly bound interpolation error on smoothstep
    // portions of the submerged and inner-bank profiles.
    const submergedStart = waterHalfWidth * 0.55;
    const innerEnd = waterHalfWidth + bankWidth;
    const quarterPoints = (start: number, end: number): number[] =>
      Array.from({ length: 4 }, (_, index) => start + (end - start) * index / 4);
    const positiveOffsets = [0, submergedStart, (submergedStart + waterHalfWidth) / 2,
      ...quarterPoints(waterHalfWidth, WORLD_RIVER_LIP_CREST_DISTANCE),
      WORLD_RIVER_LIP_CREST_DISTANCE, (WORLD_RIVER_LIP_CREST_DISTANCE + innerEnd) / 2,
      innerEnd, WORLD_RIVER_MAX_CARVING_RADIUS];
    const offsets = [...positiveOffsets.slice(1).map(value => -value).reverse(), ...positiveOffsets];
    const globalFrames = worldRiverTerrainStripFrames(riverOwner.spine, riverOwner.identity);
    const frameCount = globalFrames.length - 1;
    const guides = new Map<number, { x: number; z: number }[]>();
    for (const offset of offsets) {
      const guide: { x: number; z: number }[] = [];
      for (let frameIndex = 0; frameIndex <= frameCount; frameIndex++) {
        const frame = globalFrames[frameIndex]!;
        const point = { x: frame.position.x + frame.normal.x * offset,
          z: frame.position.z + frame.normal.z * offset };
        guide.push(point);
        addVertex(point.x, point.z, offset);
      }
      guides.set(offset, guide);
    }
    type StripPoint = { x: number; z: number; offset: number };
    const interpolate = (a: StripPoint, b: StripPoint, t: number): StripPoint => ({
      x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
      offset: a.offset + (b.offset - a.offset) * t,
    });
    const clipEdge = (polygon: StripPoint[], inside: (point: StripPoint) => boolean,
      intersect: (a: StripPoint, b: StripPoint) => StripPoint): StripPoint[] => {
      const output: StripPoint[] = [];
      for (let index = 0; index < polygon.length; index++) {
        const a = polygon[index]!, b = polygon[(index + 1) % polygon.length]!;
        const aInside = inside(a), bInside = inside(b);
        if (aInside) output.push(a);
        if (aInside !== bInside) output.push(intersect(a, b));
      }
      return output;
    };
    const clipTriangle = (triangle: StripPoint[]): StripPoint[] => {
      let polygon = triangle;
      const at = (axis: "x" | "z", value: number) => (a: StripPoint, b: StripPoint) =>
        interpolate(a, b, (value - a[axis]) / (b[axis] - a[axis]));
      polygon = clipEdge(polygon, point => point.x >= minX, at("x", minX));
      polygon = clipEdge(polygon, point => point.x <= minX + CHUNK_SIZE, at("x", minX + CHUNK_SIZE));
      polygon = clipEdge(polygon, point => point.z >= minZ, at("z", minZ));
      return clipEdge(polygon, point => point.z <= minZ + CHUNK_SIZE, at("z", minZ + CHUNK_SIZE));
    };
    const stripIndices: number[] = [];
    const emit = (triangle: StripPoint[]): void => {
      const polygon = clipTriangle(triangle);
      if (polygon.length < 3) return;
      const polygonIndices = polygon.map(point => addVertex(point.x, point.z, point.offset)!);
      for (let index = 1; index < polygonIndices.length - 1; index++) {
        const a = polygonIndices[0]!, b = polygonIndices[index]!, c = polygonIndices[index + 1]!;
        const av = vertices[a]!, bv = vertices[b]!, cv = vertices[c]!;
        const normalY = (bv.z - av.z) * (cv.x - av.x) - (bv.x - av.x) * (cv.z - av.z);
        if (normalY > 1e-10) stripIndices.push(a, b, c);
        else if (normalY < -1e-10) stripIndices.push(a, c, b);
      }
    };
    for (let cross = 0; cross < offsets.length - 1; cross++) {
      const aOffset = offsets[cross]!, bOffset = offsets[cross + 1]!;
      const aGuide = guides.get(aOffset)!, bGuide = guides.get(bOffset)!;
      for (let frame = 0; frame < frameCount; frame++) {
        const a = { ...aGuide[frame]!, offset: aOffset }, b = { ...aGuide[frame + 1]!, offset: aOffset };
        const c = { ...bGuide[frame]!, offset: bOffset }, d = { ...bGuide[frame + 1]!, offset: bOffset };
        const xs = [a.x, b.x, c.x, d.x], zs = [a.z, b.z, c.z, d.z];
        if (Math.max(...xs) < minX || Math.min(...xs) > minX + CHUNK_SIZE
          || Math.max(...zs) < minZ || Math.min(...zs) > minZ + CHUNK_SIZE) continue;
        emit([a, b, c]); emit([c, b, d]);
      }
    }
    const constraintMap = new Map<string, [number, number]>();
    for (let index = 0; index < stripIndices.length; index += 3) for (let edge = 0; edge < 3; edge++) {
      const a = stripIndices[index + edge]!, b = stripIndices[index + (edge + 1) % 3]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      constraintMap.set(key, a < b ? [a, b] : [b, a]);
    }
    // A constrained triangulation makes every river-band edge part of the one
    // terrain surface; generic adaptive points fill only the surrounding faces.
    const originalByPosition = new Map(vertices.map(vertex =>
      [`${vertex.x.toFixed(9)},${vertex.z.toFixed(9)}`, vertex]));
    const points = vertices.map(vertex => [vertex.x, vertex.z]);
    const constraints = [...constraintMap.values()];
    cleanPSLG(points, constraints);
    // clean-pslg uses an internally randomized sweep structure. Its geometric
    // result is stable, but insertion/index order is not. Canonicalize the PSLG
    // before CDT so generation order and cache history cannot leak into buffers.
    const pointOrder = points.map((_, index) => index).sort((a, b) =>
      points[a]![0]! - points[b]![0]! || points[a]![1]! - points[b]![1]!);
    const remap = new Map(pointOrder.map((oldIndex, newIndex) => [oldIndex, newIndex]));
    const canonicalPoints = pointOrder.map(index => points[index]!);
    points.splice(0, points.length, ...canonicalPoints);
    for (const edge of constraints) {
      edge[0] = remap.get(edge[0])!; edge[1] = remap.get(edge[1])!;
      if (edge[0] > edge[1]) [edge[0], edge[1]] = [edge[1], edge[0]];
    }
    constraints.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    vertices = points.map(([x, z]) => originalByPosition.get(`${x!.toFixed(9)},${z!.toFixed(9)}`) ?? (() => {
      const height = sampleAuthoritativeHeight(x!, z!);
      return { x: x!, z: z!, height, biomeWeights: sampleBiome(seed, x!, z!).weights,
        occlusion: 0 };
    })());
    const triangulated = cdt2d(points, constraints).sort((a, b) => {
      const sortedA = [...a].sort((x, y) => x - y), sortedB = [...b].sort((x, y) => x - y);
      return sortedA[0]! - sortedB[0]! || sortedA[1]! - sortedB[1]! || sortedA[2]! - sortedB[2]!;
    });
    const indices: number[] = [];
    for (const triangle of triangulated) {
      const [a, b, c] = triangle;
      const av = vertices[a]!, bv = vertices[b]!, cv = vertices[c]!;
      const normalY = (bv.z - av.z) * (cv.x - av.x) - (bv.x - av.x) * (cv.z - av.z);
      if (Math.abs(normalY) < 1e-10) continue;
      if (normalY > 0) indices.push(a, b, c); else indices.push(a, c, b);
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
  const triangulationFinished = diagnostics ? performance.now() : 0;
  const pines = generateTrees(seed, coordinate, exclusionZones, riverEnvironmentContext);
  const collectibles = placeCollectibles(seed, coordinate, exclusionZones, riverEnvironmentContext);
  const vegetation = generateVegetation(seed, coordinate, exclusionZones, riverEnvironmentContext);
  const wetlandPools = generateWetlandPools(seed, coordinate, riverEnvironmentContext)
    .filter(pool => !isVegetationExcluded(pool.x, pool.z, exclusionZones));
  const objectsFinished = diagnostics ? performance.now() : 0;
  const result: GeneratedChunkData = {
    seed,
    riverGenerationIdentity: riverOwner.identity,
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
    pines,
    pois,
    bridges,
    poiCandidates: includeDebugData ? ownedCandidates : undefined,
    bridgeCandidates:includeDebugData?ownedBridgeCandidates:undefined,
    collectibles,
    vegetation,
    wetlandPools,
  };
  diagnostics?.record({
    terrainFieldMs: terrainFieldFinished - generationStarted,
    poiAndBridgeMs: structuresFinished - terrainFieldFinished,
    terrainTriangulationMs: triangulationFinished - structuresFinished,
    objectPlacementMs: objectsFinished - triangulationFinished,
    totalMs: objectsFinished - generationStarted,
  });
  return result;
}
