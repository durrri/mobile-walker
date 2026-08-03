import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { placeRiverDebugPoint, RIVER_SPINE_DEBUG_SURFACE_OFFSET, RiverSpineDebugView } from "./riverSpineDebug";

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
});
