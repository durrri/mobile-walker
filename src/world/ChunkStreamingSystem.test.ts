import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { createEcsWorld } from "../ecs/createEcsWorld";
import { CHUNK_SIZE } from "./chunkCoordinates";
import { ChunkStreamingSystem } from "./ChunkStreamingSystem";
import { ChunkMeshFactory } from "./chunkMeshes";
import { generateChunk } from "./generateChunk";

function createPlayerWorld() {
  const world = createEcsWorld();
  const player = {
    transform: { x: 1, y: 0, z: 1, yaw: 0 },
    velocity: { x: 0, y: 0, z: 1 },
    playerControl: { moveX: 0, moveZ: 0, active: false, jump: false },
  };
  world.add(player);
  return { world, player };
}

describe("loaded neighborhood boundary", () => {
  it("supports independent streaming offsets in every direction", () => {
    const scene = new THREE.Scene();
    const { world } = createPlayerWorld();
    const chunks = new ChunkStreamingSystem(scene, "north-row", 1, {
      offsets: { west: 0, east: 1, north: 2, south: 0 },
      generator: generateChunk,
      generationWorkPerFrame: 20,
      meshWorkPerFrame: 20,
    });

    chunks.prepareRender(world, 0, 0);

    expect(scene.children).toHaveLength(6);
    expect(scene.getObjectByName("chunk:0,-2")).toBeDefined();
    expect(scene.getObjectByName("chunk:1,0")).toBeDefined();
    expect(scene.getObjectByName("chunk:-1,0")).toBeUndefined();
    expect(scene.getObjectByName("chunk:0,1")).toBeUndefined();
    chunks.dispose();
  });

  it("applies changed offsets to the running world", () => {
    const scene = new THREE.Scene();
    const { world } = createPlayerWorld();
    const chunks = new ChunkStreamingSystem(scene, "live-settings", 0, {
      generator: generateChunk, generationWorkPerFrame: 20, meshWorkPerFrame: 20,
    });
    chunks.prepareRender(world, 0, 0);
    expect(scene.children).toHaveLength(1);

    chunks.setNeighborhoodOffsets({ west: 1, east: 1, north: 1, south: 1 });
    chunks.prepareRender(world, 0, 0);
    expect(scene.children).toHaveLength(9);
    expect(scene.getObjectByName("chunk:-1,-1")).toBeDefined();
    chunks.dispose();
  });

  it("queues activation and obeys generation and mesh limits per frame", () => {
    const scene = new THREE.Scene();
    const { world } = createPlayerWorld();
    const generator = vi.fn(generateChunk);
    const chunks = new ChunkStreamingSystem(scene, "limits", 1, {
      generator, generationWorkPerFrame: 2, meshWorkPerFrame: 1,
    });

    chunks.prepareRender(world, 0, 0);
    expect(generator).toHaveBeenCalledTimes(2);
    expect(scene.children).toHaveLength(1);
    chunks.prepareRender(world, 0, 0);
    expect(generator).toHaveBeenCalledTimes(4);
    expect(scene.children).toHaveLength(2);

    chunks.dispose();
  });

  it("retains the departed chunk until its replacement is ready", () => {
    const scene = new THREE.Scene();
    const { world, player } = createPlayerWorld();
    const chunks = new ChunkStreamingSystem(scene, "retain", 0, {
      generator: generateChunk, generationWorkPerFrame: 1, meshWorkPerFrame: 1,
    });
    chunks.prepareRender(world, 0, 0);
    const original = scene.children[0];

    player.transform.x = CHUNK_SIZE + 1;
    chunks.prepareRender(world, 0, 0);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).not.toBe(original);
    // Replacement activation and safe retirement happen in the same frame; no empty edge is exposed.
    expect(original.parent).toBeNull();

    chunks.dispose();
  });

  it("keeps an old resident while asynchronous replacement generation is pending", async () => {
    const scene = new THREE.Scene();
    const { world, player } = createPlayerWorld();
    let resolveReplacement: ((data: ReturnType<typeof generateChunk>) => void) | undefined;
    let replacementGeneration: Promise<ReturnType<typeof generateChunk>> | undefined;
    const generator = vi.fn((seed: number | string, coordinate: { x: number; z: number }) => {
      if (coordinate.x === 0) return generateChunk(seed, coordinate);
      replacementGeneration = new Promise<ReturnType<typeof generateChunk>>((resolve) => { resolveReplacement = resolve; });
      return replacementGeneration;
    });
    // Complete one ready activation per render boundary so this test isolates
    // asynchronous generation rather than depending on stage timing.
    const chunks = new ChunkStreamingSystem(scene, "async", 0, { generator, meshWorkPerFrame: 1 });
    chunks.prepareRender(world, 0, 0);
    const original = scene.children[0];
    const originalDisposals: ReturnType<typeof vi.spyOn>[] = [];
    original?.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        originalDisposals.push(vi.spyOn(object.geometry, "dispose"));
      }
    });
    player.transform.x = CHUNK_SIZE + 1;
    chunks.prepareRender(world, 0, 0);
    expect(scene.children).toEqual([original]);
    expect(chunks.getDiagnostics().generationInProgress).toBe(1);
    expect(replacementGeneration).toBeDefined();

    resolveReplacement?.(generateChunk("async", { x: 1, z: 0 }));
    await replacementGeneration;
    // Generation completion alone does not mutate the scene; activation is
    // performed at the next render preparation boundary.
    expect(scene.children).toEqual([original]);
    chunks.prepareRender(world, 0, 0);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).not.toBe(original);
    expect(original?.parent).toBeNull();
    chunks.dispose();
    for (const dispose of originalDisposals) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("reuses cached generated data when reversing across a boundary", () => {
    const scene = new THREE.Scene();
    const { world, player } = createPlayerWorld();
    const generator = vi.fn(generateChunk);
    const chunks = new ChunkStreamingSystem(scene, "cache", 0, { generator, cacheSize: 2 });
    chunks.prepareRender(world, 0, 0);
    player.transform.x = CHUNK_SIZE + 1;
    chunks.prepareRender(world, 0, 0);
    player.transform.x = 1;
    chunks.prepareRender(world, 0, 0);

    // The first reverse boundary performs the retained-data cache hit and
    // queues/resumes its activation job. Terrain creation may consume the
    // frame's activation budget before hydrology marks the group renderable,
    // so drive the next explicit render boundary rather than waiting on time
    // or microtasks. Safe retirement keeps chunk 1 resident until chunk 0 is active.
    expect(generator).toHaveBeenCalledTimes(2);
    chunks.prepareRender(world, 0, 0);
    expect(generator).toHaveBeenCalledTimes(2);
    expect(scene.children[0]?.name).toBe("chunk:0,0");
    chunks.dispose();
  });

  it("disposes every resident geometry exactly once, including after cache reuse", () => {
    const scene = new THREE.Scene();
    const { world, player } = createPlayerWorld();
    const chunks = new ChunkStreamingSystem(scene, "dispose", 0, { generator: generateChunk, cacheSize: 2 });
    const disposals: ReturnType<typeof vi.spyOn>[] = [];
    const trackCurrent = () => scene.children[0]?.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) disposals.push(vi.spyOn(object.geometry, "dispose"));
    });
    chunks.prepareRender(world, 0, 0);
    trackCurrent();
    player.transform.x = CHUNK_SIZE + 1;
    chunks.prepareRender(world, 0, 0);
    trackCurrent();
    chunks.dispose();
    chunks.dispose();

    expect(disposals.length).toBeGreaterThan(0);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("stabilizes a radius-1 seam, restores resident meshes, and disposes them exactly once", () => {
    const scene = new THREE.Scene();
    const { world, player } = createPlayerWorld();
    const generator = vi.fn(generateChunk);
    const meshFactory = new ChunkMeshFactory();
    const create = vi.spyOn(meshFactory, "create");
    const disposeChunk = vi.spyOn(meshFactory, "disposeChunk");
    const chunks = new ChunkStreamingSystem(scene, "resident-cache", 1, {
      generator,
      meshFactory,
      cacheSize: 3,
      generationWorkPerFrame: 20,
      meshWorkPerFrame: 20,
    });

    chunks.prepareRender(world, 0, 0);
    expect(generator).toHaveBeenCalledTimes(9);
    expect(create).toHaveBeenCalledTimes(9);
    const initialGroups = new Map(scene.children.map((group) => [group.name, group]));

    for (let index = 0; index < 8; index += 1) {
      player.transform.x = CHUNK_SIZE + (index % 2 === 0 ? 0.1 : -0.1);
      chunks.prepareRender(world, 0, 0);
    }
    expect(generator).toHaveBeenCalledTimes(9);
    expect(create).toHaveBeenCalledTimes(9);
    expect(disposeChunk).not.toHaveBeenCalled();

    // Crossing the hysteresis band deliberately loads one new column and caches
    // the departed one. Returning restores those same Three.js groups directly.
    player.transform.x = CHUNK_SIZE + 0.6;
    chunks.prepareRender(world, 0, 0);
    expect(generator).toHaveBeenCalledTimes(12);
    expect(create).toHaveBeenCalledTimes(12);
    chunks.setDebugView({ wireframe: true, biomeGuide: false });
    player.transform.x = CHUNK_SIZE - 0.6;
    chunks.prepareRender(world, 0, 0);
    expect(generator).toHaveBeenCalledTimes(12);
    expect(create).toHaveBeenCalledTimes(12);
    for (const name of ["chunk:-1,-1", "chunk:-1,0", "chunk:-1,1"]) {
      const restored = scene.getObjectByName(name);
      expect(restored).toBe(initialGroups.get(name));
      expect(restored?.getObjectByName("debug:chunk-boundary")?.visible).toBe(true);
    }

    // A distant neighborhood forces bounded-cache eviction; final disposal must
    // account for every group, without ever disposing a group twice.
    player.transform.x = CHUNK_SIZE * 4;
    chunks.prepareRender(world, 0, 0);
    expect(disposeChunk).toHaveBeenCalled();
    chunks.dispose();
    chunks.dispose();
    const createdGroups = create.mock.results.map(({ value }) => value);
    expect(disposeChunk).toHaveBeenCalledTimes(createdGroups.length);
    for (const group of createdGroups) {
      expect(disposeChunk.mock.calls.filter(([disposed]) => disposed === group)).toHaveLength(1);
    }
  }, 10_000);
});
