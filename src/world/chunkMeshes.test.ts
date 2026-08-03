import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  ChunkMeshFactory,
  createRiverRibbonGeometry,
  createRiverChannelGeometry,
} from "./chunkMeshes";
import { generateChunk } from "./generateChunk";
import { SunlightDirection } from "../rendering/sunlightDirection";

describe("river ribbon geometry", () => {
  it("renders world water beyond legacy column zero and does not fill an absent column-zero chunk", () => {
    const factory = new ChunkMeshFactory();
    const curvedReach = factory.create(generateChunk("r4-column-audit", { x: 4, z: 2 }));
    const absentReach = factory.create(generateChunk("r4-column-audit", { x: 0, z: 6 }));
    const curvedWater = curvedReach.getObjectByName("world-river-water") as THREE.Mesh;
    const absentWater = absentReach.getObjectByName("world-river-water");
    expect(curvedWater.geometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(absentWater).toBeUndefined();
    expect(curvedReach.getObjectByName("river")).toBeUndefined();
    expect(curvedReach.getObjectByName("river-channel")).toBeUndefined();
    factory.disposeChunk(curvedReach); factory.disposeChunk(absentReach); factory.dispose();
  });

  it("renders locally refined authoritative terrain and disables legacy presentation", () => {
    const factory = new ChunkMeshFactory();
    const data = generateChunk("open-channel", { x: 4, z: 2 });
    const group = factory.create(data);
    const terrain = group.getObjectByName("terrain") as THREE.Mesh;
    const water = group.getObjectByName("world-river-water") as THREE.Mesh;
    expect(group.getObjectByName("river-channel")).toBeUndefined();
    expect(group.getObjectByName("river")).toBeUndefined();
    expect(water).toBeInstanceOf(THREE.Mesh);
    expect(terrain.geometry.getAttribute("position").count).toBe(data.irregularTerrain!.vertices.length);
    expect(data.irregularTerrain!.vertices.length).toBeGreaterThan(data.terrainHeights.length);

    factory.disposeChunk(group);
    factory.dispose();
  });

  it("reuses each section boundary verbatim in adjacent channel triangles", () => {
    const sections = generateChunk("shared-strip", { x: 0, z: 0 }).river!.channelSections;
    const geometry = createRiverChannelGeometry(sections);
    const positions = geometry.getAttribute("position");
    for (let section = 1; section < sections.length - 1; section += 1) {
      for (let cross = 0; cross < 6; cross += 1) {
        const vertex = section * 6 + cross;
        expect(positions.getZ(vertex)).toBeCloseTo(sections[section]!.z);
      }
    }
    geometry.dispose();
  });

  it("uses carved terrain itself as the visible bank", () => {
    const factory = new ChunkMeshFactory();
    const group = factory.create(generateChunk("visible-shoreline", { x: 0, z: 0 }));
    const terrain = group.getObjectByName("terrain") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(terrain.userData.isTerrainSurface).toBe(true);
    expect(group.getObjectByName("river-channel")).toBeUndefined();

    factory.disposeChunk(group);
    factory.dispose();
  });

  it("supports independently selectable water wireframe debug", () => {
    const factory = new ChunkMeshFactory();
    const group = factory.create(generateChunk("river-debug-pipeline", { x: 4, z: 2 }));
    factory.registerGroup(group);
    const terrain = group.getObjectByName("terrain") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const water = group.getObjectByName("world-river-water") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const waterMaterial = water.material;

    factory.setDebugView({ wireframe: false, waterWireframe: true, biomeGuide: true, occlusionMap: true });
    expect(terrain.geometry.getAttribute("color")).toBe(terrain.geometry.getAttribute("debugColor"));
    expect(water.material).toBe(waterMaterial);
    expect(water.material).not.toBe(terrain.material);
    expect(water.material.wireframe).toBe(true);

    factory.disposeChunk(group);
    factory.dispose();
  });

  it("keeps legacy downstream data but not its bank mesh during R4", () => {
    const factory = new ChunkMeshFactory();
    const data = generateChunk("river-bank-seam", { x: 0, z: 0 });
    const group = factory.create(data);
    expect(data.river?.channelSections.length).toBeGreaterThan(0);
    expect(group.getObjectByName("river-channel")).toBeUndefined();

    factory.disposeChunk(group);
    factory.dispose();
  });

  it("winds its triangles counter-clockwise from above", () => {
    const geometry = createRiverRibbonGeometry([
      { x: 0, z: 0, width: 2, surfaceElevation: 0 },
      { x: 4, z: 1, width: 2, surfaceElevation: 0 },
    ]);
    const positions = geometry.getAttribute("position");
    const indices = geometry.getIndex();
    const triangle = new THREE.Triangle(
      new THREE.Vector3().fromBufferAttribute(positions, indices!.getX(0)),
      new THREE.Vector3().fromBufferAttribute(positions, indices!.getX(1)),
      new THREE.Vector3().fromBufferAttribute(positions, indices!.getX(2)),
    );

    expect(triangle.getNormal(new THREE.Vector3()).y).toBeGreaterThan(0);
    geometry.dispose();
  });

  it("uses a front-sided production material", () => {
    const factory = new ChunkMeshFactory();
    const group = factory.create(generateChunk("river-material", { x: 0, z: 0 }));
    const river = group.children[1] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

    expect(river.material.side).toBe(THREE.FrontSide);
    expect(river.material.side).not.toBe(THREE.DoubleSide);

    factory.disposeChunk(group);
    factory.dispose();
  });

  it("does not create retired river debug geometry", () => {
    const factory = new ChunkMeshFactory();
    const group = factory.create(generateChunk("retired-river-debug", { x: 0, z: 0 }));

    expect(group.getObjectByName("wetland-pools")).toBeDefined();
    expect(group.getObjectByName("debug:walkable-boundaries")).toBeUndefined();
    expect(group.getObjectByName("debug:river-placement")).toBeUndefined();
    expect(() => factory.registerGroup(group)).not.toThrow();

    factory.disposeChunk(group);
    factory.dispose();
  });
});

describe("pine tree geometry", () => {
  it("keeps resident and newly created tree-shadow batches on the current sunlight", () => {
    const sunlight = new SunlightDirection();
    const factory = new ChunkMeshFactory(sunlight);
    const data = generateChunk("forest-biomes", { x: -4, z: -4 });
    const existing = factory.create(data);
    factory.registerGroup(existing);
    sunlight.set(new THREE.Vector3(4, 2, -5));
    const streamed = factory.create(data);
    const matrixA = new THREE.Matrix4();
    const matrixB = new THREE.Matrix4();
    (existing.getObjectByName("tree-shadows") as THREE.InstancedMesh).getMatrixAt(0, matrixA);
    (streamed.getObjectByName("tree-shadows") as THREE.InstancedMesh).getMatrixAt(0, matrixB);

    expect(matrixA.elements).toEqual(matrixB.elements);
    factory.disposeChunk(existing);
    factory.disposeChunk(streamed);
    factory.dispose();
  });

  it("does not rebuild resident instance matrices while sunlight is unchanged", () => {
    const sunlight = new SunlightDirection();
    const factory = new ChunkMeshFactory(sunlight);
    const group = factory.create(generateChunk("forest-biomes", { x: -4, z: -4 }));
    factory.registerGroup(group);
    const shadows = group.getObjectByName("tree-shadows") as THREE.InstancedMesh;
    const setMatrixAt = vi.spyOn(shadows, "setMatrixAt");

    sunlight.set(new THREE.Vector3(-4, 8, 5));
    sunlight.set(new THREE.Vector3(-4, 8, 5));
    expect(setMatrixAt).not.toHaveBeenCalled();
    sunlight.set(new THREE.Vector3(4, 8, -5));
    expect(setMatrixAt).toHaveBeenCalledTimes(shadows.count);

    factory.disposeChunk(group);
    factory.dispose();
  });

  it("moves tree shadows farther from their trees at lower sun elevations", () => {
    const sunlight = new SunlightDirection();
    const factory = new ChunkMeshFactory(sunlight);
    const data = generateChunk("forest-biomes", { x: -4, z: -4 });
    const group = factory.create(data);
    factory.registerGroup(group);
    const shadows = group.getObjectByName("tree-shadows") as THREE.InstancedMesh;
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const matrix = new THREE.Matrix4();

    sunlight.set(new THREE.Vector3(-1, 8, 0));
    shadows.getMatrixAt(0, matrix);
    matrix.decompose(position, rotation, scale);
    const highElevationOffset = Math.hypot(position.x - data.pines[0]!.x, position.z - data.pines[0]!.z);

    sunlight.set(new THREE.Vector3(-8, 1, 0));
    shadows.getMatrixAt(0, matrix);
    matrix.decompose(position, rotation, scale);
    const lowElevationOffset = Math.hypot(position.x - data.pines[0]!.x, position.z - data.pines[0]!.z);

    expect(lowElevationOffset).toBeGreaterThan(highElevationOffset);

    factory.disposeChunk(group);
    factory.dispose();
  });

  it("offsets a 22-degree tree shadow by the projected crown height", () => {
    const sunlight = new SunlightDirection();
    const factory = new ChunkMeshFactory(sunlight);
    const data = generateChunk("forest-biomes", { x: -4, z: -4 });
    const group = factory.create(data);
    factory.registerGroup(group);
    const shadows = group.getObjectByName("tree-shadows") as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();

    const elevation = THREE.MathUtils.degToRad(22);
    sunlight.set(new THREE.Vector3(Math.cos(elevation), Math.sin(elevation), 0));
    shadows.getMatrixAt(0, matrix);
    position.setFromMatrixPosition(matrix);

    const offset = Math.hypot(position.x - data.pines[0]!.x, position.z - data.pines[0]!.z);
    expect(offset).toBeCloseTo(1.8 * data.pines[0]!.scale / Math.tan(elevation), 4);

    factory.disposeChunk(group);
    factory.dispose();
  });

  it("renders each tree with an instanced trunk and layered crown", () => {
    const factory = new ChunkMeshFactory();
    const data = generateChunk("forest-biomes", { x: -4, z: -4 });
    const group = factory.create(data);
    const trees = group.getObjectByName("trees") as THREE.Group;

    expect(data.pines.length).toBeGreaterThan(0);
    expect(trees.children).toHaveLength(3);
    expect(trees.children.every((child) => child instanceof THREE.InstancedMesh)).toBe(true);
    expect((trees.children[0] as THREE.InstancedMesh).count).toBe(data.pines.length);

    factory.disposeChunk(group);
    factory.dispose();
  });

  it("batches only major-tree contact shadows and supports the debug toggle", () => {
    const factory = new ChunkMeshFactory();
    const data = generateChunk("forest-biomes", { x: -4, z: -4 });
    const group = factory.create(data);
    factory.registerGroup(group);
    const shadows = group.getObjectByName("tree-shadows") as THREE.InstancedMesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;

    expect(shadows).toBeInstanceOf(THREE.InstancedMesh);
    expect(shadows.count).toBe(data.pines.length + data.vegetation.leafTrees.length);
    expect(shadows.material.depthWrite).toBe(false);
    expect(shadows.material.opacity).toBeGreaterThanOrEqual(0.3);
    const shadowTransform = new THREE.Matrix4();
    const shadowScale = new THREE.Vector3();
    shadows.getMatrixAt(0, shadowTransform);
    shadowTransform.decompose(new THREE.Vector3(), new THREE.Quaternion(), shadowScale);
    expect(shadowScale.x).toBeGreaterThan(data.pines[0]!.scale);
    expect(shadowScale.z).toBeGreaterThan(data.pines[0]!.scale * 0.7);
    factory.setShadowsEnabled(false);
    expect(shadows.visible).toBe(false);

    factory.disposeChunk(group);
    factory.dispose();
  });
});

describe("biome vegetation geometry", () => {
  it("renders leaf trees, bushes, and flowers as low-poly instances", () => {
    const factory = new ChunkMeshFactory();
    const data = generateChunk("garden-geometry", { x: -2, z: 1 });
    const group = factory.create(data);
    const vegetation = group.getObjectByName("vegetation") as THREE.Group;
    const leafTrees = vegetation.getObjectByName("leaf-trees") as THREE.Group;
    const bushes = vegetation.getObjectByName("bushes") as THREE.Group;
    const flowers = vegetation.getObjectByName("flowers") as THREE.Group;
    const leafCrown = leafTrees.children[1] as THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const bushMesh = bushes.children[0] as THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const flowerHeads = flowers.children[1] as THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

    expect(vegetation.children).toHaveLength(3);
    expect(leafTrees.children.every((child) => child instanceof THREE.InstancedMesh)).toBe(true);
    expect(bushes.children.every((child) => child instanceof THREE.InstancedMesh)).toBe(true);
    expect(flowers.children.every((child) => child instanceof THREE.InstancedMesh)).toBe(true);
    expect((flowers.children[0] as THREE.InstancedMesh).count).toBe(data.vegetation.flowers.length);

    const coloredMeshes = [
      [leafCrown, data.vegetation.leafTrees.length],
      [bushMesh, data.vegetation.bushes.length],
      [flowerHeads, data.vegetation.flowers.length],
    ] as const;
    for (const [mesh, placementCount] of coloredMeshes) {
      const representativeColor = new THREE.Color();
      mesh.getColorAt(0, representativeColor);

      expect(placementCount).toBeGreaterThan(0);
      expect(mesh.instanceColor).not.toBeNull();
      expect(mesh.instanceColor?.count).toBe(placementCount);
      expect(representativeColor.getHex()).not.toBe(0x000000);
      expect(mesh.material.vertexColors).toBe(false);
    }

    factory.disposeChunk(group);
    factory.dispose();
  });
});

describe("terrain biome colors", () => {
  const terrainOf = (factory: ChunkMeshFactory, seed: string, x: number, z: number) => {
    const data = generateChunk(seed, { x, z });
    const group = factory.create(data);
    return { data, group, terrain: group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> };
  };

  it("provides one vertex color for every terrain vertex", () => {
    const factory = new ChunkMeshFactory();
    const { data, group, terrain } = terrainOf(factory, "colored-terrain", 0, 0);

    expect(terrain.geometry.getAttribute("color").count)
      .toBe(terrain.geometry.getAttribute("position").count);
    expect(terrain.geometry.getAttribute("color").count)
      .toBe(data.irregularTerrain?.vertices.length ?? data.terrainHeights.length);
    expect(terrain.material.vertexColors).toBe(true);

    factory.disposeChunk(group);
    factory.dispose();
  });

  it("gives adjacent chunks exactly matching boundary colors", () => {
    const factory = new ChunkMeshFactory();
    const left = terrainOf(factory, "color-continuity", 1, 2);
    const right = terrainOf(factory, "color-continuity", 2, 2);
    const leftColors = left.terrain.geometry.getAttribute("color");
    const rightColors = right.terrain.geometry.getAttribute("color");
    const boundaryX = 2 * left.data.size;
    const boundaryColors = (data: typeof left.data, colors: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => {
      const vertices = data.irregularTerrain?.vertices;
      if (!vertices) throw new Error("expected refined river fixture");
      return new Map(vertices.flatMap((vertex, index) => vertex.x === boundaryX
        ? [[vertex.z, [colors.getX(index), colors.getY(index), colors.getZ(index)]] as const]
        : []));
    };
    const leftBoundary = boundaryColors(left.data, leftColors);
    const rightBoundary = boundaryColors(right.data, rightColors);
    for (const [z, color] of leftBoundary) expect(rightBoundary.get(z)).toEqual(color);

    factory.disposeChunk(left.group);
    factory.disposeChunk(right.group);
    factory.dispose();
  });

  it("blends biome variation into multiple terrain colors", () => {
    const factory = new ChunkMeshFactory();
    const { group, terrain } = terrainOf(factory, "biome-color-variation", -4, -4);
    const colors = terrain.geometry.getAttribute("color");
    const uniqueColors = new Set(Array.from({ length: colors.count }, (_, index) =>
      `${colors.getX(index)},${colors.getY(index)},${colors.getZ(index)}`));

    expect(uniqueColors.size).toBeGreaterThan(1);

    factory.disposeChunk(group);
    factory.dispose();
  });

  it("preserves biome and snow colour hue while applying baked occlusion", () => {
    const factory = new ChunkMeshFactory();
    const coordinate = { x: 4, z: -5 };
    const lit = generateChunk("preserved-terrain-colors", coordinate, {
      sampleCount: 8, sampleDistance: 32, heightThreshold: 1.5, softness: 3, maximumDarkening: 0,
    });
    const shaded = generateChunk("preserved-terrain-colors", coordinate, {
      sampleCount: 8, sampleDistance: 32, heightThreshold: 1.5, softness: 3, maximumDarkening: 0.5,
    });
    const litGroup = factory.create(lit);
    const shadedGroup = factory.create(shaded);
    const litColors = (litGroup.getObjectByName("terrain") as THREE.Mesh<THREE.BufferGeometry>).geometry.getAttribute("color");
    const shadedColors = (shadedGroup.getObjectByName("terrain") as THREE.Mesh<THREE.BufferGeometry>).geometry.getAttribute("color");

    for (let index = 0; index < litColors.count; index += 1) {
      const ratio = shadedColors.getX(index) / litColors.getX(index);
      expect(ratio).toBeGreaterThanOrEqual(0.5);
      expect(shadedColors.getY(index) / litColors.getY(index)).toBeCloseTo(ratio, 5);
      expect(shadedColors.getZ(index) / litColors.getZ(index)).toBeCloseTo(ratio, 5);
    }

    factory.disposeChunk(litGroup);
    factory.disposeChunk(shadedGroup);
    factory.dispose();
  });

  it("stores base and final terrain colours separated only by baked occlusion", () => {
    const factory = new ChunkMeshFactory();
    const data = generateChunk("terrain-color-attributes", { x: 4, z: -5 });
    const group = factory.create(data);
    const geometry = (group.getObjectByName("terrain") as THREE.Mesh<THREE.BufferGeometry>).geometry;
    const base = geometry.getAttribute("baseTerrainColor");
    const occluded = geometry.getAttribute("terrainColor");
    const vertices = data.irregularTerrain?.vertices ?? data.terrainHeights.map((_, index) => ({
      occlusion: data.terrainOcclusion[index] ?? 0,
    }));

    expect(base.count).toBe(occluded.count);
    for (let index = 0; index < base.count; index += 1) {
      const multiplier = 1 - vertices[index]!.occlusion * data.terrainMaximumDarkening;
      expect(occluded.getX(index)).toBeCloseTo(base.getX(index) * multiplier, 6);
      expect(occluded.getY(index)).toBeCloseTo(base.getY(index) * multiplier, 6);
      expect(occluded.getZ(index)).toBeCloseTo(base.getZ(index) * multiplier, 6);
    }

    factory.disposeChunk(group);
    factory.dispose();
  });

  it("restores biome and snow colours instead of inverse grayscale when occlusion is disabled", () => {
    const factory = new ChunkMeshFactory();
    const group = factory.create(generateChunk("disable-occlusion", { x: 4, z: -5 }));
    factory.registerGroup(group);
    const geometry = (group.getObjectByName("terrain") as THREE.Mesh<THREE.BufferGeometry>).geometry;

    factory.setDebugView({ wireframe: false, biomeGuide: false, disableTerrainOcclusion: true });

    expect(geometry.getAttribute("color")).toBe(geometry.getAttribute("baseTerrainColor"));
    expect(geometry.getAttribute("color")).not.toBe(geometry.getAttribute("occlusionColor"));
    const color = geometry.getAttribute("color");
    expect(Array.from({ length: color.count }, (_, index) =>
      color.getX(index) === 1 && color.getY(index) === 1 && color.getZ(index) === 1,
    ).every(Boolean)).toBe(false);

    factory.unregisterGroup(group);
    factory.disposeChunk(group);
    factory.dispose();
  });

  it("applies the selected terrain mode to existing and subsequently streamed chunks", () => {
    const factory = new ChunkMeshFactory();
    const existing = factory.create(generateChunk("existing-debug-chunk", { x: 2, z: 1 }));
    factory.registerGroup(existing);
    factory.setDebugView({ wireframe: false, biomeGuide: false, disableTerrainOcclusion: true });
    const streamed = factory.create(generateChunk("streamed-debug-chunk", { x: 3, z: 1 }));
    factory.registerGroup(streamed);

    for (const group of [existing, streamed]) {
      const geometry = (group.getObjectByName("terrain") as THREE.Mesh<THREE.BufferGeometry>).geometry;
      expect(geometry.getAttribute("color")).toBe(geometry.getAttribute("baseTerrainColor"));
      factory.unregisterGroup(group);
      factory.disposeChunk(group);
    }
    factory.dispose();
  });

  it("uses explicit biome, occlusion-map, unoccluded, and normal precedence", () => {
    const factory = new ChunkMeshFactory();
    const group = factory.create(generateChunk("debug-precedence", { x: 1, z: 1 }));
    factory.registerGroup(group);
    const geometry = (group.getObjectByName("terrain") as THREE.Mesh<THREE.BufferGeometry>).geometry;

    factory.setDebugView({ wireframe: false, biomeGuide: false, occlusionMap: false, disableTerrainOcclusion: false });
    expect(geometry.getAttribute("color")).toBe(geometry.getAttribute("terrainColor"));
    factory.setDebugView({ wireframe: false, biomeGuide: false, occlusionMap: true, disableTerrainOcclusion: true });
    expect(geometry.getAttribute("color")).toBe(geometry.getAttribute("occlusionColor"));
    factory.setDebugView({ wireframe: false, biomeGuide: true, occlusionMap: true, disableTerrainOcclusion: true });
    expect(geometry.getAttribute("color")).toBe(geometry.getAttribute("debugColor"));

    factory.unregisterGroup(group);
    factory.disposeChunk(group);
    factory.dispose();
  });
});

describe("terrain wireframe debug view", () => {
  it("highlights each chunk perimeter while wireframe mode is enabled", () => {
    const factory = new ChunkMeshFactory();
    const data = generateChunk("chunk-boundary-highlight", { x: 2, z: -1 });
    const group = factory.create(data);
    factory.registerGroup(group);
    const boundary = group.getObjectByName("debug:chunk-boundary") as THREE.LineLoop;

    expect(boundary).toBeInstanceOf(THREE.LineLoop);
    expect(boundary.visible).toBe(false);

    factory.setDebugView({ wireframe: true, biomeGuide: false });

    expect(boundary.visible).toBe(true);
    expect((boundary.material as THREE.LineBasicMaterial).color.getHex()).toBe(0x8b0000);
    expect((boundary.material as THREE.LineBasicMaterial).depthTest).toBe(false);
    expect(boundary.geometry.getAttribute("position").count).toBe(data.terrainVerticesPerSide * 4 - 4);

    factory.setDebugView({ wireframe: false, biomeGuide: false });
    expect(boundary.visible).toBe(false);

    factory.unregisterGroup(group);
    factory.disposeChunk(group);
    factory.dispose();
  });
});

describe("lazy POI debug presentation", () => {
  const view = (pois: "off" | "accepted" | "candidates") => ({ wireframe: false, biomeGuide: false, pois });

  it("creates no candidate meshes until debug is enabled, then uses at most two batches", () => {
    const factory = new ChunkMeshFactory();
    const group = factory.create(generateChunk("poi-debug-batches", { x: 0, z: 0 }));
    factory.registerGroup(group);

    expect(group.getObjectByName("debug:pois")).toBeUndefined();
    expect(group.children.filter(child => child.name.startsWith("debug:poi-candidates"))).toHaveLength(0);

    factory.setDebugView(view("candidates"));
    const debug = group.getObjectByName("debug:pois")!;
    const batches = debug.children.filter(child => child.name.startsWith("debug:poi-candidates"));
    expect(batches.length).toBeLessThanOrEqual(2);
    expect(batches.every(batch => batch instanceof THREE.InstancedMesh)).toBe(true);
    for (const batch of batches as THREE.InstancedMesh[]) {
      const material = batch.material as THREE.MeshBasicMaterial;
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBeGreaterThanOrEqual(0.68);
      expect(material.depthTest).toBe(false);
      expect(material.depthWrite).toBe(false);
      expect(batch.renderOrder).toBe(100);

      const transform = new THREE.Matrix4();
      const scale = new THREE.Vector3();
      batch.getMatrixAt(0, transform);
      transform.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
      expect(scale.x).toBeCloseTo(2.8);
      expect(scale.y).toBeCloseTo(0.22);
      expect(scale.z).toBeCloseTo(2.8);
    }

    factory.disposeChunk(group);
    factory.dispose();
  });

  it("disposes debug-owned geometry and does not accumulate objects across toggles", () => {
    const factory = new ChunkMeshFactory();
    const group = factory.create(generateChunk("poi-debug-lifecycle", { x: 1, z: 0 }));
    factory.registerGroup(group);
    let expectedDebugObjects = 0;

    for (let toggle = 0; toggle < 3; toggle += 1) {
      factory.setDebugView(view("candidates"));
      const debug = group.getObjectByName("debug:pois")!;
      expectedDebugObjects ||= debug.children.length;
      expect(debug.children).toHaveLength(expectedDebugObjects);
      const lines = debug.getObjectByName("debug:poi-lines") as THREE.LineSegments | undefined;
      const dispose = lines ? vi.spyOn(lines.geometry, "dispose") : undefined;

      factory.setDebugView(view("off"));
      expect(group.getObjectByName("debug:pois")).toBeUndefined();
      if (dispose) expect(dispose).toHaveBeenCalledOnce();
    }

    factory.disposeChunk(group);
    factory.dispose();
  });

  it("applies the active POI mode to newly streamed chunks", () => {
    const factory = new ChunkMeshFactory();
    factory.setDebugView(view("accepted"));
    const group = factory.create(generateChunk("poi-debug-streamed", { x: 2, z: 0 }));
    factory.registerGroup(group);

    const debug = group.getObjectByName("debug:pois")!;
    expect(debug).toBeDefined();
    expect(debug.getObjectByName("debug:poi-candidates:rejected")).toBeUndefined();

    factory.disposeChunk(group);
    factory.dispose();
  });
});
