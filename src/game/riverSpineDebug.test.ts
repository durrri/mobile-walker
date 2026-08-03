import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { RiverSpineDebugView } from "./riverSpineDebug";

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
});
