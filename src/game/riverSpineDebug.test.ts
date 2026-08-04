import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  placeRiverDebugPoint,
  RIVER_DEBUG_STYLE,
  RIVER_SPINE_DEBUG_SURFACE_OFFSET,
  RiverSpineDebugView,
} from "./riverSpineDebug";

describe("RiverSpineDebugView", () => {
  it("is absent by default, lazy by mode, and disposes cleanly", () => {
    const scene = new THREE.Scene(), view = new RiverSpineDebugView(scene);
    expect(scene.getObjectByName("debug:world-river-spine")).toBeUndefined();
    view.setMode("ribbon");
    expect(scene.getObjectByName("debug:river-ribbon")).toBeDefined();
    view.setMode("off");
    expect(scene.getObjectByName("debug:world-river-spine")).toBeUndefined();
    view.dispose();
  });

  it("batches Detailed diagnostics into thick strip meshes with the intended hierarchy", () => {
    const scene = new THREE.Scene(), view = new RiverSpineDebugView(scene);
    view.setMode("detailed");

    const categories = [
      "debug:river-centreline",
      "debug:river-tangents",
      "debug:river-normals",
      "debug:river-indexed-bounds",
      "debug:river-chunk-grid",
      "debug:river-channel-edges",
      "debug:river-lip-edges",
      "debug:river-inner-bank-edges",
      "debug:river-falloff-edges",
    ];
    for (const name of categories) {
      const diagnostic = scene.getObjectByName(name) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      expect(diagnostic).toBeInstanceOf(THREE.Mesh);
      expect(diagnostic.geometry.index!.count).toBeGreaterThan(0);
      expect(diagnostic.material.depthTest).toBe(true);
      expect(diagnostic.material.fog).toBe(false);
    }
    expect(RIVER_DEBUG_STYLE.centreline.width).toBeGreaterThan(RIVER_DEBUG_STYLE.tangent.width);
    expect(RIVER_DEBUG_STYLE.tangent.width).toBeGreaterThan(RIVER_DEBUG_STYLE.indexedBounds.width);
    expect(RIVER_DEBUG_STYLE.indexedBounds.width).toBeGreaterThan(RIVER_DEBUG_STYLE.chunkGrid.width);
    view.dispose();
  });

  it("allocates bounded width diagnostics only in detailed mode and disposes them once",()=>{
    const scene=new THREE.Scene(),view=new RiverSpineDebugView(scene);
    expect(scene.getObjectByName("debug:river-width-cross-sections")).toBeUndefined();
    view.setMode("ribbon");
    expect(scene.getObjectByName("debug:river-width-cross-sections")).toBeUndefined();
    view.setMode("detailed");
    const sections=scene.getObjectByName("debug:river-width-cross-sections") as THREE.Mesh<THREE.BufferGeometry,THREE.Material>;
    const targets=scene.getObjectByName("debug:river-width-target-cross-sections") as THREE.Mesh<THREE.BufferGeometry,THREE.Material>;
    const clamps=scene.getObjectByName("debug:river-width-safety-clamps") as THREE.Points<THREE.BufferGeometry,THREE.Material>;
    expect(sections.geometry.getAttribute("position").count).toBeLessThanOrEqual(128*4);
    expect(targets.geometry.getAttribute("position").count).toBeLessThanOrEqual(128*4);
    expect(clamps.geometry.getAttribute("position").count).toBeLessThanOrEqual(128);
    const sectionDispose=vi.spyOn(sections.geometry,"dispose"),clampDispose=vi.spyOn(clamps.geometry,"dispose");
    view.setMode("off");expect(sectionDispose).toHaveBeenCalledOnce();expect(clampDispose).toHaveBeenCalledOnce();
    view.dispose();expect(sectionDispose).toHaveBeenCalledOnce();expect(clampDispose).toHaveBeenCalledOnce();
  });

  it("dims only the Detailed ribbon", () => {
    const scene = new THREE.Scene(), view = new RiverSpineDebugView(scene);
    view.setMode("ribbon");
    let ribbon = scene.getObjectByName("debug:river-ribbon") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    expect(ribbon.material.opacity).toBe(RIVER_DEBUG_STYLE.ribbonOpacity);

    view.setMode("detailed");
    ribbon = scene.getObjectByName("debug:river-ribbon") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    expect(ribbon.material.opacity).toBe(RIVER_DEBUG_STYLE.detailedRibbonOpacity);
    expect(ribbon.material.opacity).toBeLessThan(RIVER_DEBUG_STYLE.ribbonOpacity);
    view.dispose();
  });

  it("places debug geometry at the sampled terrain surface plus its offset", () => {
    const sampler = (x: number, z: number) => x * 0.5 - z * 0.25;
    expect(placeRiverDebugPoint({ x: 8, z: -4 }, sampler)).toEqual({
      x: 8,
      y: 5 + RIVER_SPINE_DEBUG_SURFACE_OFFSET,
      z: -4,
    });

    const scene = new THREE.Scene(), view = new RiverSpineDebugView(scene, undefined, sampler);
    view.setMode("ribbon");
    const ribbon = scene.getObjectByName("debug:river-ribbon") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    const positions = ribbon.geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index += 1) {
      expect(positions.getY(index)).toBeCloseTo(sampler(positions.getX(index), positions.getZ(index)) + RIVER_SPINE_DEBUG_SURFACE_OFFSET, 5);
    }
    expect(ribbon.material.depthTest).toBe(true);
    expect(ribbon.material.depthWrite).toBe(false);
    view.dispose();
  });

  it("terrain-drapes every strip corner and disposes resources when switched Off", () => {
    const sampler = (x: number, z: number) => x * 0.02 + z * 0.03;
    const scene = new THREE.Scene(), view = new RiverSpineDebugView(scene, undefined, sampler);
    view.setMode("detailed");
    const centreline = scene.getObjectByName("debug:river-centreline") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    const positions = centreline.geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index += 1) {
      expect(positions.getY(index)).toBeCloseTo(
        sampler(positions.getX(index), positions.getZ(index)) + RIVER_DEBUG_STYLE.centreline.offset,
        5,
      );
    }
    const disposeGeometry = vi.spyOn(centreline.geometry, "dispose");
    const disposeMaterial = vi.spyOn(centreline.material, "dispose");
    view.setMode("off");
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(disposeMaterial).toHaveBeenCalledOnce();
    expect(scene.getObjectByName("debug:world-river-spine")).toBeUndefined();
  });

  it("shows independently toggleable dual spines and decimated R8 connectors", () => {
    const scene = new THREE.Scene(), view = new RiverSpineDebugView(scene);
    view.setMode("detailed");
    const macro = scene.getObjectByName("debug:river-macro-spine")!;
    const final = scene.getObjectByName("debug:river-centreline")!;
    const connectors = scene.getObjectByName("debug:river-displacement-connectors") as THREE.Mesh<THREE.BufferGeometry>;
    expect(macro).toBeDefined(); expect(final).toBeDefined();
    expect(connectors.geometry.getAttribute("position").count).toBeLessThan(400);
    view.setLayerVisibility({ macro: false });
    expect(macro.visible).toBe(false); expect(final.visible).toBe(true); expect(connectors.visible).toBe(true);
    const labels = view.generationReadout();
    expect(labels.generationVersion).toBe(9); expect(labels.macroControlPointCount).toBeGreaterThan(2);
    expect(labels.widthMinimum).toBeGreaterThan(0);expect(labels.widthMaximum).toBeGreaterThanOrEqual(labels.widthMinimum as number);
    view.dispose();
  });
});
