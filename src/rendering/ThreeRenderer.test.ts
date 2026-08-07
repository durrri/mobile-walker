import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

const webgl = vi.hoisted(() => ({
  instances: [] as Array<{ setSize: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>,
}));

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();

  class WebGLRenderer {
    readonly setSize = vi.fn((width: number, height: number) => {
      canvas.width = width;
      canvas.height = height;
    });
    readonly dispose = vi.fn();
    readonly info = { render: { calls: 0, triangles: 0 } };
    outputColorSpace = "";

    constructor(parameters: { canvas: HTMLCanvasElement }) {
      canvas = parameters.canvas;
      webgl.instances.push(this);
    }

    setPixelRatio(): void {}
    render(): void {}
  }

  let canvas: HTMLCanvasElement;
  return { ...actual, WebGLRenderer };
});

import { deriveEnvironmentLighting } from "../core/environmentLighting";
import { deriveEnvironmentTime } from "../core/environmentTime";
import { FOG_FAR_DISTANCE, FOG_NEAR_DISTANCE, MAX_DRAW_DISTANCE, sunlightPosition, ThreeRenderer } from "./ThreeRenderer";

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  readonly disconnect = vi.fn();
  readonly observe = vi.fn();

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }

  notify(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

describe("ThreeRenderer resize synchronization", () => {
  let animationFrames: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    webgl.instances.length = 0;
    ResizeObserverStub.instances.length = 0;
    animationFrames = new Map();
    let nextAnimationFrame = 1;

    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const id = nextAnimationFrame++;
      animationFrames.set(id, callback);
      return id;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => animationFrames.delete(id)));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("updates the WebGL buffer and camera when only the canvas changes size", () => {
    const canvas = { clientWidth: 320, clientHeight: 180, width: 0, height: 0 } as HTMLCanvasElement;
    const renderer = new ThreeRenderer(canvas);
    const webglRenderer = webgl.instances[0];

    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(180);
    expect(renderer.camera.aspect).toBe(320 / 180);

    Object.assign(canvas, { clientWidth: 480, clientHeight: 320 });
    ResizeObserverStub.instances[0].notify();

    expect(canvas.width).toBe(480);
    expect(canvas.height).toBe(320);
    expect(renderer.camera.aspect).toBe(1.5);
    expect(webglRenderer.setSize).toHaveBeenCalledTimes(2);

    ResizeObserverStub.instances[0].notify();
    expect(webglRenderer.setSize).toHaveBeenCalledTimes(2);

    renderer.dispose();
    expect(ResizeObserverStub.instances[0].disconnect).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it("keeps fog distances independent from the camera draw distance", () => {
    const canvas = { clientWidth: 320, clientHeight: 180, width: 0, height: 0 } as HTMLCanvasElement;
    const renderer = new ThreeRenderer(canvas);
    const fog = renderer.scene.fog;

    expect(renderer.camera.far).toBe(MAX_DRAW_DISTANCE);
    expect(MAX_DRAW_DISTANCE).toBe(225);
    expect(fog).toMatchObject({ near: FOG_NEAR_DISTANCE, far: FOG_FAR_DISTANCE });
    expect(FOG_NEAR_DISTANCE).toBe(130);
    expect(FOG_FAR_DISTANCE).toBe(150);
    expect(FOG_FAR_DISTANCE).toBeLessThan(MAX_DRAW_DISTANCE);

    renderer.dispose();
  });
});

describe("derived sunlight", () => {
  it("applies global lights and shared sunlight direction from EnvironmentLightingState", () => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("ResizeObserver", undefined);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const canvas = { clientWidth: 320, clientHeight: 180, width: 0, height: 0 } as HTMLCanvasElement;
    const renderer = new ThreeRenderer(canvas);
    const sunlight = renderer.scene.children.find((object): object is THREE.DirectionalLight => object instanceof THREE.DirectionalLight)!;
    const hemisphere = renderer.scene.children.find((object): object is THREE.HemisphereLight => object instanceof THREE.HemisphereLight)!;
    const lighting = deriveEnvironmentLighting(deriveEnvironmentTime(0.5, { maximumNoonSolarElevationDegrees: 51 }));

    renderer.setEnvironmentLighting(lighting);
    expect(sunlight.position).toEqual(sunlightPosition(lighting));
    expect(sunlight.intensity).toBe(lighting.directLightIntensity);
    expect(sunlight.color.r).toBeCloseTo(lighting.directLightColor.red);
    expect(hemisphere.intensity).toBe(lighting.hemisphereIntensity);
    expect(hemisphere.color.b).toBeCloseTo(lighting.hemisphereSkyColor.blue);
    expect(hemisphere.groundColor.g).toBeCloseTo(lighting.hemisphereGroundColor.green);
    expect(renderer.sunlightDirection.direction).toEqual(sunlight.position.clone().normalize());

    renderer.dispose();
    vi.unstubAllGlobals();
  });

  it.each([
    [0, -1, 0],
    [90, 0, 1],
    [180, 1, 0],
    [270, 0, -1],
    [360, -1, 0],
  ])("places derived azimuth %i° toward the documented compass direction", (solarAzimuthDegrees, expectedX, expectedZ) => {
    const position = sunlightPosition({ solarElevationDegrees: 10, solarAzimuthDegrees }).normalize();

    expect(position.x / Math.cos(THREE.MathUtils.degToRad(10))).toBeCloseTo(expectedX);
    expect(position.z / Math.cos(THREE.MathUtils.degToRad(10))).toBeCloseTo(expectedZ);
  });

  it("removes direct solar light and blob-shadow strength at night", () => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("ResizeObserver", undefined);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const canvas = { clientWidth: 320, clientHeight: 180, width: 0, height: 0 } as HTMLCanvasElement;
    const renderer = new ThreeRenderer(canvas);
    const sunlight = renderer.scene.children.find((object): object is THREE.DirectionalLight => object instanceof THREE.DirectionalLight)!;

    renderer.setEnvironmentLighting(deriveEnvironmentLighting(deriveEnvironmentTime(0, { maximumNoonSolarElevationDegrees: 51 })));

    expect(sunlight.intensity).toBe(0);
    expect(renderer.sunlightDirection.solarShadowStrength).toBe(0);
    renderer.dispose();
    vi.unstubAllGlobals();
  });

  it("uses elevation above the horizon and clamps it to 0–90°", () => {
    expect(sunlightPosition({ solarElevationDegrees: 10, solarAzimuthDegrees: 0 }).normalize().y).toBeCloseTo(Math.sin(THREE.MathUtils.degToRad(10)));
    const overhead = sunlightPosition({ solarElevationDegrees: 90, solarAzimuthDegrees: 123 }).normalize();
    expect(overhead.x).toBeCloseTo(0);
    expect(overhead.y).toBeCloseTo(1);
    expect(overhead.z).toBeCloseTo(0);
    expect(sunlightPosition({ solarElevationDegrees: -1, solarAzimuthDegrees: 0 })).toEqual(sunlightPosition({ solarElevationDegrees: 0, solarAzimuthDegrees: 0 }));
  });
});
