import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { createEcsWorld } from "../ecs/createEcsWorld";
import { TerrainSamplingSystem } from "../player/systems";
import { ChunkStreamingSystem } from "./ChunkStreamingSystem";
import { CHUNK_SIZE } from "./chunkCoordinates";
import { generateChunk } from "./generateChunk";
import { queryChunkTerrainSurface } from "./activeTerrainSurface";
import { sampleTerrain } from "./terrainSampling";

function centroidHit(seed: string, coordinate = { x: 0, z: 0 }) {
  const chunk = generateChunk(seed, coordinate);
  const tri = 0;
  const p = chunk.terrainMesh.positions, i = chunk.terrainMesh.indices;
  const ids = [i[0]!, i[1]!, i[2]!];
  const x = ids.reduce((sum, id) => sum + p[id * 3]!, 0) / 3;
  const z = ids.reduce((sum, id) => sum + p[id * 3 + 2]!, 0) / 3;
  return { chunk, hit: queryChunkTerrainSurface(chunk, x, z)!, ids, x, z, tri };
}

describe("activated terrain mesh query surface", () => {
  it("uses the same immutable vertex and index buffers as rendered terrain and interpolates the exact triangle plane", () => {
    const { chunk, hit, ids } = centroidHit("mesh-authority");
    expect(chunk.terrainSurfaceIndex.positions).toBe(chunk.terrainMesh.positions);
    expect(chunk.terrainSurfaceIndex.indices).toBe(chunk.terrainMesh.indices);
    const expected = ids.reduce((sum, id) => sum + chunk.terrainMesh.positions[id * 3 + 1]!, 0) / 3;
    expect(hit.height).toBeCloseTo(expected, 6);
    expect(hit.candidateCount).toBeLessThan(chunk.terrainMesh.indices.length / 3);
  });

  it("returns deterministic edge and vertex ties by lowest triangle ordinal", () => {
    const { chunk } = centroidHit("tie-break");
    const p = chunk.terrainMesh.positions, i = chunk.terrainMesh.indices;
    const vertexX = p[i[0]! * 3]!, vertexZ = p[i[0]! * 3 + 2]!;
    const a = queryChunkTerrainSurface(chunk, vertexX, vertexZ)!;
    const b = queryChunkTerrainSurface(chunk, vertexX, vertexZ)!;
    expect(a).toEqual(b);
    expect(a.triangleIndex).toBe(0);
  });

  it("is independent of generation order and cache reuse", () => {
    const forward = generateChunk("order-independent", { x: 0, z: 0 });
    void generateChunk("order-independent", { x: 3, z: -2 });
    const reverse = generateChunk("order-independent", { x: 0, z: 0 });
    const x = 2.1, z = 1.7;
    expect(queryChunkTerrainSurface(forward, x, z)).toEqual(queryChunkTerrainSurface(reverse, x, z));
  });

  it("is continuous across exact seams through canonical active chunk ownership", () => {
    const seed = "seam-authority";
    const west = generateChunk(seed, { x: 0, z: 0 });
    const east = generateChunk(seed, { x: 1, z: 0 });
    const x = CHUNK_SIZE, z = CHUNK_SIZE * 0.375;
    const westHit = queryChunkTerrainSurface(west, x, z)!;
    const eastHit = queryChunkTerrainSurface(east, x, z)!;
    expect(westHit.height).toBeCloseTo(eastHit.height, 5);

    const scene = new THREE.Scene();
    const world = createEcsWorld();
    world.add({ transform: { x: CHUNK_SIZE + 0.1, y: 0, z, yaw: 0 }, velocity: { x: 0, y: 0, z: 0 }, playerControl: { moveX: 0, moveZ: 0, active: false, jump: false } });
    const chunks = new ChunkStreamingSystem(scene, seed, 1, { generator: generateChunk, generationWorkPerFrame: 20, meshWorkPerFrame: 20 });
    chunks.prepareRender(world, 0, 0);
    expect(chunks.queryActiveTerrainSurface(x, z)?.height).toBeCloseTo(eastHit.height, 5);
    chunks.dispose();
  }, 15000);

  it("activates terrain queries atomically with rendered chunks and keeps old physical terrain until replacement activation", () => {
    const scene = new THREE.Scene();
    const world = createEcsWorld();
    const player = { transform: { x: 1, y: 0, z: 1, yaw: 0 }, velocity: { x: 0, y: 0, z: 0 }, playerControl: { moveX: 0, moveZ: 0, active: false, jump: false } };
    world.add(player);
    let resolveReplacement: ((data: ReturnType<typeof generateChunk>) => void) | undefined;
    const generator = vi.fn((seed: number | string, coordinate: { x: number; z: number }) => coordinate.x === 0
      ? generateChunk(seed, coordinate)
      : new Promise<ReturnType<typeof generateChunk>>(resolve => { resolveReplacement = resolve; }));
    const chunks = new ChunkStreamingSystem(scene, "lifecycle", 0, { generator, generationWorkPerFrame: 1, meshWorkPerFrame: 1 });
    expect(chunks.queryActiveTerrainSurface(1, 1)).toBeUndefined();
    chunks.prepareRender(world, 0, 0);
    const oldHit = chunks.queryActiveTerrainSurface(1, 1);
    expect(oldHit).toBeDefined();
    player.transform.x = CHUNK_SIZE + 1;
    chunks.prepareRender(world, 0, 0);
    expect(resolveReplacement).toBeDefined();
    expect(chunks.queryActiveTerrainSurface(1, 1)).toEqual(oldHit);
    resolveReplacement?.(generateChunk("lifecycle", { x: 1, z: 0 }));
    chunks.dispose();
  });

  it("does not fall back to procedural sampling for active runtime grounding when the mesh is missing", () => {
    const procedural = sampleTerrain("no-active-fallback", 0, 0).height;
    const entity = { transform: { x: 0, y: procedural + 10, z: 0, yaw: 0 }, previousTransform: { x: 0, y: procedural + 10, z: 0, yaw: 0 }, velocity: { x: 0, y: -1, z: 0 }, terrainFollower: { heightOffset: 0.76 }, jump: { grounded: false } };
    const world = createEcsWorld(); world.add(entity);
    const query = vi.fn(() => undefined);
    new TerrainSamplingSystem("no-active-fallback", { queryActiveTerrainSurface: query }).fixedUpdate(world);
    expect(query).toHaveBeenCalled();
    expect(entity.transform.y).toBe(procedural + 10);
    expect(entity.jump.grounded).toBe(false);
  });
});
