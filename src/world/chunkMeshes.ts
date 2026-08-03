import * as THREE from "three";

import { createBlobShadowGeometry, createBlobShadowMaterial, createBuildingShadowGeometry, markBlobShadow, updateBuildingShadowGeometry } from "../rendering/blobShadows";
import { blobShadowProjectionForCaster, SunlightDirection } from "../rendering/sunlightDirection";

import { BIOME_DEBUG_COLORS, type BiomeId, type BiomeWeights } from "./biomes";
import { TREE_TRUNK_RADIUS } from "./forest";
import type { GeneratedChunkData } from "./generateChunk";
import { LEAF_TREE_TRUNK_RADIUS } from "./vegetation";
import { LAKE_SURFACE_ELEVATION, LAKE_WATER_WEIGHT, mountainSnowCoverage, sampleTerrainHeight } from "./terrainSampling";
import { terrainDarkening } from "./terrainOcclusion";
import { PoiMeshFactory } from "./poiMeshes";
import { BridgeMeshFactory } from "./bridgeMeshes";
import { tessellateWorldRiverWaterChunk, WORLD_RIVER_WATER_SAMPLE_SPACING } from "./worldRiverWater";

export interface DebugViewOptions {
  readonly wireframe: boolean;
  readonly biomeGuide: boolean;
  readonly occlusionMap?: boolean;
  readonly disableTerrainOcclusion?: boolean;
  readonly pois?: "off" | "accepted" | "candidates";
  readonly waterWireframe?: boolean;
}

export type ChunkActivationStage = "terrain" | "hydrology" | "trees" | "vegetation" | "pois" | "details";

const DEBUG_CHUNK_BOUNDARY_NAME = "debug:chunk-boundary";
const SNOW_COLOR = new THREE.Color(0xf4f6f7);
const PINE_FOLIAGE_COLOR = new THREE.Color(0x386f4b);
// Squaring normalized biome weights doubles their log-odds. Since neighboring
// biome log-odds vary linearly across a boundary, this halves the visible
// terrain-color transition without changing biome generation or gameplay.
const TERRAIN_COLOR_BLEND_SHARPNESS = 2;

/** Muted natural colors keep blended biome transitions subtle rather than candy-bright. */
const TERRAIN_PALETTE: Readonly<Record<BiomeId, THREE.Color>> = {
  plains: new THREE.Color(0x829b69),
  // Carry the pine foliage hue into the ground, then deepen and saturate it so
  // forest regions read clearly against the lighter, greyer neighboring land.
  forest: PINE_FOLIAGE_COLOR.clone().offsetHSL(0, 0.22, -0.05),
  wetland: new THREE.Color(0x665746),
  lake: new THREE.Color(0x536b50),
  highlands: new THREE.Color(0x8b7358),
  mountain: new THREE.Color(0x34383d),
};

const DEBUG_TERRAIN_PALETTE: Readonly<Record<BiomeId, THREE.Color>> = {
  plains: new THREE.Color(BIOME_DEBUG_COLORS.plains),
  forest: new THREE.Color(BIOME_DEBUG_COLORS.forest),
  wetland: new THREE.Color(BIOME_DEBUG_COLORS.wetland),
  lake: new THREE.Color(BIOME_DEBUG_COLORS.lake),
  highlands: new THREE.Color(BIOME_DEBUG_COLORS.highlands),
  mountain: new THREE.Color(BIOME_DEBUG_COLORS.mountain),
};

function blendBiomeColor(weights: BiomeWeights, target: THREE.Color): THREE.Color {
  target.setRGB(0, 0, 0);
  const sharpenedTotal = (Object.keys(TERRAIN_PALETTE) as BiomeId[])
    .reduce((total, id) => total + weights[id] ** TERRAIN_COLOR_BLEND_SHARPNESS, 0);
  for (const id of Object.keys(TERRAIN_PALETTE) as BiomeId[]) {
    const color = TERRAIN_PALETTE[id];
    const weight = weights[id] ** TERRAIN_COLOR_BLEND_SHARPNESS / sharpenedTotal;
    target.r += color.r * weight;
    target.g += color.g * weight;
    target.b += color.b * weight;
  }
  return target;
}

interface TerrainPresentationVertex {
  readonly height: number;
  readonly biomeWeights: BiomeWeights;
  readonly occlusion: number;
}

/** Installs the common presentation contract consumed by every terrain surface. */
function addTerrainPresentationAttributes(
  geometry: THREE.BufferGeometry,
  vertices: readonly TerrainPresentationVertex[],
  maximumDarkening: number,
): void {
  const baseTerrainColors: number[] = [];
  const terrainColors: number[] = [];
  const debugColors: number[] = [];
  const occlusionColors: number[] = [];
  const color = new THREE.Color();
  for (const vertex of vertices) {
    blendBiomeColor(vertex.biomeWeights, color);
    color.lerp(SNOW_COLOR, mountainSnowCoverage(vertex.height, vertex.biomeWeights));
    baseTerrainColors.push(color.r, color.g, color.b);
    color.multiplyScalar(1 - terrainDarkening(vertex.occlusion, maximumDarkening));
    terrainColors.push(color.r, color.g, color.b);
    const dominant = (Object.keys(vertex.biomeWeights) as BiomeId[])
      .reduce((best, id) => vertex.biomeWeights[id] > vertex.biomeWeights[best] ? id : best);
    const debugColor = DEBUG_TERRAIN_PALETTE[dominant];
    debugColors.push(debugColor.r, debugColor.g, debugColor.b);
    const shade = Math.min(1, vertex.occlusion * 2);
    occlusionColors.push(shade, shade, shade);
  }
  const base = new THREE.Float32BufferAttribute(baseTerrainColors, 3);
  const rendered = new THREE.Float32BufferAttribute(terrainColors, 3);
  geometry.setAttribute("baseTerrainColor", base);
  geometry.setAttribute("terrainColor", rendered);
  geometry.setAttribute("color", rendered);
  geometry.setAttribute("debugColor", new THREE.Float32BufferAttribute(debugColors, 3));
  geometry.setAttribute("occlusionColor", new THREE.Float32BufferAttribute(occlusionColors, 3));
}

/** Presentation-only conversion of plain generated data into disposable Three.js objects. */
export class ChunkMeshFactory {
  private readonly poiMeshes = new PoiMeshFactory();
  private readonly bridgeMeshes = new BridgeMeshFactory();
  private readonly sunlight: SunlightDirection;
  private readonly unsubscribeSunlight: () => void;
  private readonly groups = new Set<THREE.Group>();
  private readonly disposedGeometries = new WeakSet<THREE.BufferGeometry>();
  private readonly terrainMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, flatShading: true, roughness: 1,
  });
  private readonly riverMaterial = new THREE.MeshStandardMaterial({
    color: 0x5da9c9, flatShading: true, roughness: 0.65,
  });
  private readonly wetlandWaterMaterial = new THREE.MeshStandardMaterial({
    color: 0x6599a0, flatShading: true, roughness: 0.42, transparent: true, opacity: 0.82,
  });
  private readonly trunkMaterial = new THREE.MeshStandardMaterial({
    color: 0x77553d, flatShading: true, roughness: 1,
  });
  private readonly foliageMaterial = new THREE.MeshStandardMaterial({
    color: PINE_FOLIAGE_COLOR, flatShading: true, roughness: 1,
  });
  private readonly leafMaterial = new THREE.MeshStandardMaterial({
    color: 0x5d8244, flatShading: true, roughness: 1,
  });
  private readonly bushMaterial = new THREE.MeshStandardMaterial({
    color: 0x527747, flatShading: true, roughness: 1,
  });
  private readonly flowerStemMaterial = new THREE.MeshStandardMaterial({
    color: 0x668653, flatShading: true, roughness: 1,
  });
  private readonly flowerHeadMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, flatShading: true, roughness: 0.9,
  });
  private readonly chunkBoundaryMaterial = new THREE.LineBasicMaterial({ color: 0x8b0000, depthTest: false, fog: false });
  private readonly blobShadowMaterial = createBlobShadowMaterial(0.3);
  private debugView: DebugViewOptions = {
    wireframe: false, biomeGuide: false, occlusionMap: false, disableTerrainOcclusion: false,
  };
  private shadowsEnabled = true;

  constructor(sunlight = new SunlightDirection()) {
    this.sunlight = sunlight;
    this.unsubscribeSunlight = sunlight.subscribe(() => this.updateShadowBatches());
  }

  create(data: GeneratedChunkData): THREE.Group {
    const group = new THREE.Group();
    group.name = `chunk:${data.id}`;
    for (const stage of ["terrain", "hydrology", "trees", "vegetation", "pois", "details"] as const) {
      this.addActivationStage(group, data, stage);
    }
    return group;
  }

  /** Adds one atomic, independently disposable activation layer. */
  addActivationStage(group: THREE.Group, data: GeneratedChunkData, stage: ChunkActivationStage): void {
    if (stage === "terrain") group.add(this.createTerrain(data));
    else if (stage === "hydrology") {
      const riverWater = this.createWorldRiverWater(data); if (riverWater) group.add(riverWater);
      group.add(this.createLake(data), this.createWetlandPools(data));
    } else if (stage === "trees") group.add(this.createTrees(data));
    else if (stage === "vegetation") group.add(this.createVegetation(data));
    else if (stage === "pois") {
      const poiGroup = new THREE.Group(); poiGroup.name = "pois";
      for (const poi of data.pois) poiGroup.add(this.poiMeshes.create(poi));
      for (const bridge of data.bridges) poiGroup.add(this.bridgeMeshes.create(bridge));
      group.add(poiGroup);
      group.userData.poiDebugData = { pois: data.pois, candidates: data.poiCandidates };
      group.userData.bridgeDebugData = data.bridgeCandidates;
      const level = this.debugView.pois ?? "off";
      // Candidate geometry is deliberately not constructed in the normal mode.
      if (level !== "off") {group.add(this.poiMeshes.createDebug(data.pois, data.poiCandidates ?? [], level));group.add(this.bridgeMeshes.createDebug(data.bridgeCandidates ?? []));}
    } else {
      group.add(this.createChunkBoundary(data), this.createTreeShadows(data), this.createBuildingShadows(data));
    }
  }

  setDebugView(options: DebugViewOptions): void {
    this.debugView = { ...options };
    this.terrainMaterial.wireframe = options.wireframe;
    this.terrainMaterial.needsUpdate = true;
    this.riverMaterial.wireframe = options.waterWireframe ?? options.wireframe;
    this.riverMaterial.needsUpdate = true;
    // Debug objects share stable names, including chunks streamed after a toggle.
    for (const group of this.groups) this.applyDebugVisibility(group);
  }

  setShadowsEnabled(enabled: boolean): void {
    this.shadowsEnabled = enabled;
    for (const group of this.groups) {
      group.traverse(object=>{if(object.userData.isBlobShadow)object.visible=enabled;});
    }
  }

  disposeChunk(group: THREE.Group): void {
    this.groups.delete(group);
    group.traverse((object) => {
      if ((object instanceof THREE.Mesh || object instanceof THREE.Line)
        && object.geometry.userData.poiShared !== true && !this.disposedGeometries.has(object.geometry)) {
        this.disposedGeometries.add(object.geometry);
        object.geometry.dispose();
      }
    });
    group.removeFromParent();
  }

  dispose(): void {
    this.unsubscribeSunlight();
    this.poiMeshes.dispose();
    this.bridgeMeshes.dispose();
    this.terrainMaterial.dispose();
    this.riverMaterial.dispose();
    this.wetlandWaterMaterial.dispose();
    this.trunkMaterial.dispose();
    this.foliageMaterial.dispose();
    this.leafMaterial.dispose();
    this.bushMaterial.dispose();
    this.flowerStemMaterial.dispose();
    this.flowerHeadMaterial.dispose();
    this.chunkBoundaryMaterial.dispose();
    this.blobShadowMaterial.dispose();
  }

  private createTreeShadows(data: GeneratedChunkData): THREE.InstancedMesh {
    const trees = [...data.pines, ...data.vegetation.leafTrees];
    const shadows = markBlobShadow(new THREE.InstancedMesh(
      createBlobShadowGeometry(), this.blobShadowMaterial, trees.length,
    ));
    shadows.name = "tree-shadows";
    shadows.visible = this.shadowsEnabled && trees.length > 0;
    shadows.renderOrder = 2;
    shadows.userData.shadowTrees = trees;
    shadows.userData.pineCount = data.pines.length;
    this.updateTreeShadowBatch(shadows);
    return shadows;
  }

  private createBuildingShadows(data:GeneratedChunkData):THREE.Mesh {
    const casters=[...data.pois.flatMap(poi=>poi.shadowCaster?[poi.shadowCaster]:[]),...data.bridges.flatMap(bridge=>bridge.shadowCaster?[bridge.shadowCaster]:[])];
    const geometry=createBuildingShadowGeometry(casters);
    const shadows=markBlobShadow(new THREE.Mesh(geometry,this.blobShadowMaterial));
    shadows.name="building-shadows";shadows.visible=this.shadowsEnabled&&casters.length>0;
    shadows.userData.terrainSeed=data.seed;
    this.updateBuildingShadowMesh(shadows);
    return shadows;
  }

  private updateBuildingShadowMesh(shadows:THREE.Mesh):void {
    const seed=shadows.userData.terrainSeed as number;
    updateBuildingShadowGeometry(shadows.geometry,this.sunlight.direction,(x,z)=>sampleTerrainHeight(seed,x,z));
  }

  private updateShadowBatches():void {
    this.updateTreeShadowBatches();
    for(const group of this.groups){const shadows=group.getObjectByName("building-shadows");if(shadows instanceof THREE.Mesh)this.updateBuildingShadowMesh(shadows);}
  }

  private updateTreeShadowBatches(): void {
    for (const group of this.groups) {
      const shadows = group.getObjectByName("tree-shadows");
      if (shadows instanceof THREE.InstancedMesh) this.updateTreeShadowBatch(shadows);
    }
  }

  private updateTreeShadowBatch(shadows: THREE.InstancedMesh): void {
    const trees = shadows.userData.shadowTrees as Array<{ x: number; y: number; z: number; scale: number }>;
    const pineCount = shadows.userData.pineCount as number;
    const projection = blobShadowProjectionForCaster(this.sunlight.direction,1);
    const transform = new THREE.Object3D();
    trees.forEach((tree, index) => {
      const isPine = index < pineCount;
      // Cover the crown as well as the trunk and project it away from the sun.
      const crownRadius = isPine ? 0.92 : 1.02;
      // Project the visual centre of the crown, not a fraction of its radius.
      // Using caster height here makes low-elevation shadows travel the same
      // distance a real ray from the crown would travel across the ground.
      const projectionHeight = isPine ? 1.8 : 1.65;
      const treeProjection=blobShadowProjectionForCaster(this.sunlight.direction,projectionHeight*tree.scale,{maximumOffset:12});
      const offset = treeProjection.offsetDistance;
      transform.position.set(tree.x + treeProjection.directionX * offset, tree.y + 0.025, tree.z + treeProjection.directionZ * offset);
      transform.rotation.y = projection.rotationY;
      transform.scale.set(crownRadius * 1.5 * tree.scale * projection.stretch, 1, crownRadius * 0.9 * tree.scale);
      transform.updateMatrix();
      shadows.setMatrixAt(index, transform.matrix);
    });
    shadows.instanceMatrix.needsUpdate = true;
  }

  private createTerrain(data: GeneratedChunkData): THREE.Mesh {
    const side = data.terrainVerticesPerSide;
    const renderedVertices = data.irregularTerrain?.vertices ?? Array.from(data.terrainHeights, (height, vertexIndex) => ({
      x: data.coordinate.x * data.size + vertexIndex % side * data.size / (side - 1),
      z: data.coordinate.z * data.size + Math.floor(vertexIndex / side) * data.size / (side - 1),
      height,
      biomeWeights: data.terrainBiomeWeights[vertexIndex],
      occlusion: data.terrainOcclusion[vertexIndex] ?? 0,
    }));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.terrainMesh.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(data.terrainMesh.normals, 3));
    addTerrainPresentationAttributes(geometry, renderedVertices, data.terrainMaximumDarkening);
    geometry.setIndex(new THREE.BufferAttribute(data.terrainMesh.indices, 1));
    const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
    mesh.name = "terrain";
    mesh.userData.isTerrainSurface = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private createChunkBoundary(data: GeneratedChunkData): THREE.LineLoop {
    const side = data.terrainVerticesPerSide;
    const step = data.size / (side - 1);
    const originX = data.coordinate.x * data.size;
    const originZ = data.coordinate.z * data.size;
    const pointAt = (x: number, z: number): THREE.Vector3 => {
      const height = data.terrainHeights[z * side + x]!;
      return new THREE.Vector3(originX + x * step, height + 0.12, originZ + z * step);
    };
    const points: THREE.Vector3[] = [];
    for (let x = 0; x < side; x += 1) points.push(pointAt(x, 0));
    for (let z = 1; z < side; z += 1) points.push(pointAt(side - 1, z));
    for (let x = side - 2; x >= 0; x -= 1) points.push(pointAt(x, side - 1));
    for (let z = side - 2; z > 0; z -= 1) points.push(pointAt(0, z));

    const boundary = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      this.chunkBoundaryMaterial,
    );
    boundary.name = DEBUG_CHUNK_BOUNDARY_NAME;
    boundary.renderOrder = 22;
    boundary.visible = this.debugView.wireframe;
    return boundary;
  }

  private createWorldRiverWater(data: GeneratedChunkData): THREE.Mesh | undefined {
    const fragment = tessellateWorldRiverWaterChunk(data.coordinate);
    if (fragment.indices.length === 0) return undefined;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(fragment.vertices.flatMap(vertex => [vertex.x, vertex.y, vertex.z]), 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(fragment.vertices.flatMap(vertex => [vertex.u, vertex.v]), 2));
    geometry.setIndex([...fragment.indices]);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, this.riverMaterial);
    mesh.name = "world-river-water";
    mesh.receiveShadow = true;
    mesh.userData.sampleSpacing = WORLD_RIVER_WATER_SAMPLE_SPACING;
    return mesh;
  }

  private createWetlandPools(data: GeneratedChunkData): THREE.Group {
    const group = new THREE.Group();
    group.name = "wetland-pools";
    if (data.wetlandPools.length === 0) return group;
    const pools = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 10), this.wetlandWaterMaterial, data.wetlandPools.length,
    );
    const transform = new THREE.Object3D();
    for (const [index, pool] of data.wetlandPools.entries()) {
      transform.position.set(pool.x, pool.y, pool.z);
      transform.rotation.set(-Math.PI / 2, 0, pool.rotation);
      transform.scale.set(pool.radiusX, pool.radiusZ, 1);
      transform.updateMatrix();
      pools.setMatrixAt(index, transform.matrix);
    }
    pools.receiveShadow = true;
    pools.renderOrder = 1;
    group.add(pools);
    return group;
  }

  /** Floods contiguous lake-biome cells with the exact material used by wetland puddles. */
  private createLake(data: GeneratedChunkData): THREE.Mesh {
    const side = data.terrainVerticesPerSide;
    const step = data.size / (side - 1);
    const originX = data.coordinate.x * data.size;
    const originZ = data.coordinate.z * data.size;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let z = 0; z < side - 1; z += 1) for (let x = 0; x < side - 1; x += 1) {
      const corners = [z * side + x, z * side + x + 1, (z + 1) * side + x, (z + 1) * side + x + 1];
      if (!corners.every((index) => data.terrainBiomeWeights[index]!.lake >= LAKE_WATER_WEIGHT)) continue;
      const vertex = positions.length / 3;
      positions.push(
        originX + x * step, LAKE_SURFACE_ELEVATION, originZ + z * step,
        originX + (x + 1) * step, LAKE_SURFACE_ELEVATION, originZ + z * step,
        originX + x * step, LAKE_SURFACE_ELEVATION, originZ + (z + 1) * step,
        originX + (x + 1) * step, LAKE_SURFACE_ELEVATION, originZ + (z + 1) * step,
      );
      indices.push(vertex, vertex + 2, vertex + 1, vertex + 1, vertex + 2, vertex + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const lake = new THREE.Mesh(geometry, this.wetlandWaterMaterial);
    lake.name = "lake";
    lake.receiveShadow = true;
    lake.renderOrder = 1;
    return lake;
  }

  private createTrees(data: GeneratedChunkData): THREE.Group {
    const group = new THREE.Group();
    group.name = "trees";
    if (data.pines.length === 0) return group;

    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.11, TREE_TRUNK_RADIUS, 1.1, 5), this.trunkMaterial, data.pines.length,
    );
    const crowns = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.82, 2.25, 7), this.foliageMaterial, data.pines.length,
    );
    const upperCrowns = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.59, 1.75, 7), this.foliageMaterial, data.pines.length,
    );
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    data.pines.forEach((tree, index) => {
      transform.position.set(tree.x, tree.y + 0.55 * tree.scale, tree.z);
      transform.rotation.y = tree.rotation;
      transform.scale.setScalar(tree.scale);
      transform.updateMatrix();
      trunks.setMatrixAt(index, transform.matrix);

      transform.position.y = tree.y + 1.45 * tree.scale;
      transform.updateMatrix();
      crowns.setMatrixAt(index, transform.matrix);
      color.setHSL(0.36 + tree.shade * 0.025, 0.34, 0.27 + tree.shade * 0.08);
      crowns.setColorAt(index, color);

      transform.position.y = tree.y + 2.15 * tree.scale;
      transform.updateMatrix();
      upperCrowns.setMatrixAt(index, transform.matrix);
      upperCrowns.setColorAt(index, color);
    });
    trunks.castShadow = crowns.castShadow = upperCrowns.castShadow = true;
    trunks.receiveShadow = crowns.receiveShadow = upperCrowns.receiveShadow = true;
    group.add(trunks, crowns, upperCrowns);
    return group;
  }

  private createVegetation(data: GeneratedChunkData): THREE.Group {
    const group = new THREE.Group();
    group.name = "vegetation";
    group.add(
      this.createLeafTrees(data),
      this.createBushes(data),
      this.createFlowers(data),
    );
    return group;
  }

  private createLeafTrees(data: GeneratedChunkData): THREE.Group {
    const group = new THREE.Group();
    group.name = "leaf-trees";
    const placements = data.vegetation.leafTrees;
    if (placements.length === 0) return group;
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.13, LEAF_TREE_TRUNK_RADIUS, 1.35, 6), this.trunkMaterial, placements.length,
    );
    const crown = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.9, 1), this.leafMaterial, placements.length,
    );
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    placements.forEach((tree, index) => {
      transform.position.set(tree.x, tree.y + 0.675 * tree.scale, tree.z);
      transform.rotation.y = tree.rotation;
      transform.scale.setScalar(tree.scale);
      transform.updateMatrix();
      trunk.setMatrixAt(index, transform.matrix);
      transform.position.set(tree.x, tree.y + 1.65 * tree.scale, tree.z);
      transform.scale.set(1.15 * tree.scale, 0.92 * tree.scale, tree.scale);
      transform.updateMatrix();
      crown.setMatrixAt(index, transform.matrix);
      color.setHSL(0.25 + tree.shade * 0.05, 0.36, 0.33 + tree.shade * 0.08);
      crown.setColorAt(index, color);
    });
    trunk.castShadow = crown.castShadow = true;
    trunk.receiveShadow = crown.receiveShadow = true;
    group.add(trunk, crown);
    return group;
  }

  private createBushes(data: GeneratedChunkData): THREE.Group {
    const group = new THREE.Group();
    group.name = "bushes";
    const placements = data.vegetation.bushes;
    if (placements.length === 0) return group;
    const bushes = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.42, 0), this.bushMaterial, placements.length,
    );
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    placements.forEach((bush, index) => {
      transform.position.set(bush.x, bush.y + 0.3 * bush.scale, bush.z);
      transform.rotation.y = bush.rotation;
      transform.scale.set(1.3 * bush.scale, 0.72 * bush.scale, bush.scale);
      transform.updateMatrix();
      bushes.setMatrixAt(index, transform.matrix);
      color.setHSL(0.27 + bush.shade * 0.04, 0.32, 0.31 + bush.shade * 0.08);
      bushes.setColorAt(index, color);
    });
    bushes.castShadow = bushes.receiveShadow = true;
    group.add(bushes);
    return group;
  }

  private createFlowers(data: GeneratedChunkData): THREE.Group {
    const group = new THREE.Group();
    group.name = "flowers";
    const placements = data.vegetation.flowers;
    if (placements.length === 0) return group;
    const stems = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.018, 0.025, 0.3, 4), this.flowerStemMaterial, placements.length,
    );
    const heads = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.105, 0), this.flowerHeadMaterial, placements.length,
    );
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    placements.forEach((flower, index) => {
      transform.position.set(flower.x, flower.y + 0.15 * flower.scale, flower.z);
      transform.rotation.y = flower.rotation;
      transform.scale.setScalar(flower.scale);
      transform.updateMatrix();
      stems.setMatrixAt(index, transform.matrix);
      transform.position.y = flower.y + 0.34 * flower.scale;
      transform.updateMatrix();
      heads.setMatrixAt(index, transform.matrix);
      heads.setColorAt(index, color.setHex(flower.color));
    });
    group.add(stems, heads);
    return group;
  }

  registerGroup(group: THREE.Group): void {
    this.groups.add(group);
    const shadows = group.getObjectByName("tree-shadows");
    if (shadows instanceof THREE.InstancedMesh) this.updateTreeShadowBatch(shadows);
    const buildings=group.getObjectByName("building-shadows");
    if(buildings instanceof THREE.Mesh)this.updateBuildingShadowMesh(buildings);
    this.applyDebugVisibility(group);
  }

  unregisterGroup(group: THREE.Group): void {
    this.groups.delete(group);
  }

  private applyDebugVisibility(group: THREE.Group): void {
    group.traverse(object=>{if(object.userData.isBlobShadow)object.visible=this.shadowsEnabled;});
    const chunkBoundary = group.getObjectByName(DEBUG_CHUNK_BOUNDARY_NAME);
    if (chunkBoundary) chunkBoundary.visible = this.debugView.wireframe;
    const level = this.debugView.pois ?? "off";
    const poiDebug = group.getObjectByName("debug:pois");
    const bridgeDebug=group.getObjectByName("debug:bridge-crossings");
    if (poiDebug && poiDebug.userData.level !== level) {
      group.remove(poiDebug);
      poiDebug.traverse(object => {
        if ((object instanceof THREE.Mesh || object instanceof THREE.Line) && object.geometry.userData.poiShared !== true) object.geometry.dispose();
      });
    }
    if (level !== "off" && (!poiDebug || poiDebug.userData.level !== level)) {
      const data = group.userData.poiDebugData as { pois: GeneratedChunkData["pois"]; candidates: GeneratedChunkData["poiCandidates"] };
      group.add(this.poiMeshes.createDebug(data.pois, data.candidates ?? [], level));
      group.add(this.bridgeMeshes.createDebug((group.userData.bridgeDebugData as GeneratedChunkData["bridgeCandidates"])??[]));
    }
    if((level==="off"||poiDebug?.userData.level!==level)&&bridgeDebug){group.remove(bridgeDebug);bridgeDebug.traverse(object=>{if(object instanceof THREE.Line){object.geometry.dispose();(object.material as THREE.Material).dispose();}});}
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object.userData.isTerrainSurface !== true) return;
      const terrain = object;
      const geometry = terrain.geometry as THREE.BufferGeometry;
      // Keep precedence explicit so combinations selected through programmatic
      // debug controls always resolve predictably.
      const colorAttribute = this.debugView.biomeGuide ? "debugColor"
        : this.debugView.occlusionMap ? "occlusionColor"
          : this.debugView.disableTerrainOcclusion ? "baseTerrainColor"
            : "terrainColor";
      geometry.setAttribute("color", geometry.getAttribute(colorAttribute));
      terrain.material = this.terrainMaterial;
    });
  }
}
