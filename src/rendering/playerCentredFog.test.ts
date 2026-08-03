import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { FOG_COLOR, FOG_FAR_DISTANCE, FOG_NEAR_DISTANCE } from "./ThreeRenderer";
import { createPlayerCentredFogController, horizontalFogDistance, linearFogFactor } from "./playerCentredFog";

describe("player-centred cylindrical fog math", () => {
  it.each([
    [0, 0, 0, 0, 0], [10, 0, 0, 0, 10], [0, 10, 0, 0, 10], [6, 8, 0, 0, 10],
  ])("measures world X/Z only", (x, z, cx, cz, expected) => {
    expect(horizontalFogDistance(x, z, cx, cz)).toBe(expected);
  });

  it("safely fully fogs non-finite positions", () => {
    expect(horizontalFogDistance(Number.NaN, 0, 0, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("retains the configured smooth linear transition", () => {
    const near = FOG_NEAR_DISTANCE, far = FOG_FAR_DISTANCE;
    expect(FOG_COLOR).toBe(0xd9ead8);
    expect(linearFogFactor(near - 1, near, far)).toBe(0);
    expect(linearFogFactor(near, near, far)).toBe(0);
    expect(linearFogFactor((near + far) / 2, near, far)).toBe(0.5);
    expect(linearFogFactor(far, near, far)).toBe(1);
    expect(linearFogFactor(far + 1, near, far)).toBe(1);
  });
});

describe("standard material fog patch", () => {
  const shader = () => ({
    uniforms: {},
    vertexShader: "#include <fog_pars_vertex>\n#include <fog_vertex>",
    fragmentShader: "#include <fog_pars_fragment>\n#include <fog_fragment>",
  });

  it("composes callbacks, shares a uniform, patches once, and extends cache identity", () => {
    const controller = createPlayerCentredFogController(new THREE.Fog(FOG_COLOR, 130, 150));
    const existing = vi.fn();
    const material = new THREE.MeshStandardMaterial();
    material.onBeforeCompile = existing;
    material.customProgramCacheKey = () => "existing";
    expect(controller.apply(material)).toBe(true);
    expect(controller.apply(material)).toBe(false);
    const compiled = shader();
    material.onBeforeCompile(compiled as never, {} as never);
    expect(existing).toHaveBeenCalledOnce();
    expect(compiled.uniforms).toHaveProperty("playerFogCenter", controller.playerFogCenter);
    expect(compiled.vertexShader).toContain("modelMatrix * playerFogWorldPosition");
    expect(compiled.fragmentShader).toContain("length( playerFogWorldXZ - playerFogCenter )");
    expect(compiled.fragmentShader).not.toContain("vFogDepth");
    expect(material.customProgramCacheKey()).toContain("existing|player-centred-cylindrical-fog-v1");
  });

  it("skips opted-out materials and fails loudly for incompatible shader chunks", () => {
    const controller = createPlayerCentredFogController(new THREE.Fog(FOG_COLOR, 130, 150));
    expect(controller.apply(new THREE.MeshBasicMaterial({ fog: false }))).toBe(false);
    const material = new THREE.MeshStandardMaterial(); controller.apply(material);
    expect(() => material.onBeforeCompile({ uniforms: {}, vertexShader: "", fragmentShader: "" } as never, {} as never))
      .toThrow(/could not find vertex fog parameters/);
  });

  it("updates only the shared value and restores hooks on disposal", () => {
    const controller = createPlayerCentredFogController(new THREE.Fog(FOG_COLOR, 130, 150));
    const material = new THREE.MeshStandardMaterial();
    const compile = material.onBeforeCompile, key = material.customProgramCacheKey;
    controller.apply(material); const versionAfterPatch = material.version;
    controller.update(12.5, -7.25);
    expect(controller.playerFogCenter.value.toArray()).toEqual([12.5, -7.25]);
    expect(material.version).toBe(versionAfterPatch);
    controller.dispose();
    expect(material.onBeforeCompile).toBe(compile);
    expect(material.customProgramCacheKey).toBe(key);
  });
});
