import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { createEcsWorld } from "../ecs/createEcsWorld";
import { TerrainSamplingSystem } from "../player/systems";
import { ChunkStreamingSystem } from "./ChunkStreamingSystem";
import { CHUNK_SIZE } from "./chunkCoordinates";
import { generateChunk } from "./generateChunk";
import { canonicalTerrainChunkId, queryChunkTerrainSurface } from "./activeTerrainSurface";
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

  it("returns deterministic edge and vertex ties by lowest containing triangle ordinal", () => {
    const { chunk } = centroidHit("tie-break");
    const p = chunk.terrainMesh.positions, i = chunk.terrainMesh.indices;
    const incident = new Map<number, number[]>();
    for (let tri = 0; tri < i.length / 3; tri += 1) for (const vertex of [i[tri * 3]!, i[tri * 3 + 1]!, i[tri * 3 + 2]!]) incident.set(vertex, [...incident.get(vertex) ?? [], tri]);
    const [vertex, triangles] = [...incident.entries()].find(([, values]) => values.length > 1)!;
    const vertexX = p[vertex * 3]!, vertexZ = p[vertex * 3 + 2]!;
    const a = queryChunkTerrainSurface(chunk, vertexX, vertexZ)!;
    const b = queryChunkTerrainSurface(chunk, vertexX, vertexZ)!;
    expect(a).toEqual(b);
    expect(a.triangleIndex).toBe(Math.min(...triangles));
    const edgeOwner = Math.min(...triangles);
    const otherVertex = [i[edgeOwner * 3]!, i[edgeOwner * 3 + 1]!, i[edgeOwner * 3 + 2]!].find(id => id !== vertex)!;
    const edgeX = (vertexX + p[otherVertex * 3]!) / 2, edgeZ = (vertexZ + p[otherVertex * 3 + 2]!) / 2;
    const edgeIncident = Array.from({ length: i.length / 3 }, (_, tri) => tri).filter(tri => {
      const ids = [i[tri * 3]!, i[tri * 3 + 1]!, i[tri * 3 + 2]!];
      return ids.includes(vertex) && ids.includes(otherVertex);
    });
    expect(queryChunkTerrainSurface(chunk, edgeX, edgeZ)?.triangleIndex).toBe(Math.min(...edgeIncident));
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


  it("uses bounded deterministic seam and corner lookup for every boundary direction", () => {
    const seed = "bounded-seams";
    const scene = new THREE.Scene();
    const world = createEcsWorld();
    world.add({ transform: { x: -0.1, y: 0, z: -0.1, yaw: 0 }, velocity: { x: 0, y: 0, z: 0 }, playerControl: { moveX: 0, moveZ: 0, active: false, jump: false } });
    const chunks = new ChunkStreamingSystem(scene, seed, 1, { generator: generateChunk, generationWorkPerFrame: 20, meshWorkPerFrame: 20 });
    chunks.prepareRender(world, 0, 0);
    const seamSamples = [
      { x: 0, z: -CHUNK_SIZE / 2, id: "0,-1" },
      { x: -CHUNK_SIZE, z: -CHUNK_SIZE / 2, id: "-1,-1" },
      { x: -CHUNK_SIZE / 2, z: 0, id: "-1,0" },
      { x: -CHUNK_SIZE / 2, z: -CHUNK_SIZE, id: "-1,-1" },
      { x: 0, z: 0, id: "0,0" },
      { x: -1e-8, z: -1e-8, id: "-1,-1" },
      { x: 1e-8, z: 1e-8, id: "0,0" },
    ];
    for (const sample of seamSamples) {
      expect(canonicalTerrainChunkId(sample.x, sample.z)).toBe(sample.id);
      const hit = chunks.queryActiveTerrainSurface(sample.x, sample.z);
      expect(hit, `${sample.x},${sample.z}`).toBeDefined();
    }
    chunks.dispose();
  }, 15_000);

  it("activates replacement rendering and query data atomically and retires old query data", async () => {
    const scene = new THREE.Scene();
    const world = createEcsWorld();
    const player = { transform: { x: 1, y: 0, z: 1, yaw: 0 }, velocity: { x: 0, y: 0, z: 0 }, playerControl: { moveX: 0, moveZ: 0, active: false, jump: false } };
    world.add(player);
    let resolveReplacement: ((data: ReturnType<typeof generateChunk>) => void) | undefined;
    let replacement: Promise<ReturnType<typeof generateChunk>> | undefined;
    const generator = vi.fn((seed: number | string, coordinate: { x: number; z: number }) => coordinate.x === 0
      ? generateChunk(seed, coordinate)
      : (replacement = new Promise<ReturnType<typeof generateChunk>>(resolve => { resolveReplacement = resolve; })));
    const chunks = new ChunkStreamingSystem(scene, "lifecycle", 0, { generator, generationWorkPerFrame: 1, meshWorkPerFrame: 1 });
    chunks.prepareRender(world, 0, 0);
    const oldGroup = scene.children[0];
    const oldHit = chunks.queryActiveTerrainSurface(1, 1)!;
    player.transform.x = CHUNK_SIZE + 1;
    chunks.prepareRender(world, 0, 0);
    expect(scene.children).toEqual([oldGroup]);
    expect(chunks.queryActiveTerrainSurface(1, 1)).toEqual(oldHit);
    resolveReplacement?.(generateChunk("lifecycle", { x: 1, z: 0 }));
    await replacement;
    expect(scene.children).toEqual([oldGroup]);
    chunks.prepareRender(world, 0, 0);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).not.toBe(oldGroup);
    expect(chunks.queryActiveTerrainSurface(CHUNK_SIZE + 1, 1)?.chunkId).toBe("1,0");
    expect(chunks.queryActiveTerrainSurface(1, 1)).toBeUndefined();
    expect(oldGroup?.parent).toBeNull();
    chunks.dispose();
  });

  it("does not let stale async generation become active after the request moves away", async () => {
    const scene = new THREE.Scene();
    const world = createEcsWorld();
    const player = { transform: { x: 1, y: 0, z: 1, yaw: 0 }, velocity: { x: 0, y: 0, z: 0 }, playerControl: { moveX: 0, moveZ: 0, active: false, jump: false } };
    world.add(player);
    let resolveStale: ((data: ReturnType<typeof generateChunk>) => void) | undefined;
    let stale: Promise<ReturnType<typeof generateChunk>> | undefined;
    const generator = vi.fn((seed: number | string, coordinate: { x: number; z: number }) => coordinate.x === 1
      ? (stale = new Promise<ReturnType<typeof generateChunk>>(resolve => { resolveStale = resolve; }))
      : generateChunk(seed, coordinate));
    const chunks = new ChunkStreamingSystem(scene, "stale", 0, { generator, generationWorkPerFrame: 1, meshWorkPerFrame: 1 });
    chunks.prepareRender(world, 0, 0);
    player.transform.x = CHUNK_SIZE + 1;
    chunks.prepareRender(world, 0, 0);
    player.transform.x = CHUNK_SIZE * 2 + 1;
    chunks.prepareRender(world, 0, 0);
    resolveStale?.(generateChunk("stale", { x: 1, z: 0 }));
    await stale;
    chunks.prepareRender(world, 0, 0);
    expect(chunks.queryActiveTerrainSurface(CHUNK_SIZE + 1, 1)).toBeUndefined();
    chunks.prepareRender(world, 0, 0);
    expect(chunks.queryActiveTerrainSurface(CHUNK_SIZE * 2 + 1, 1)?.chunkId).toBe("2,0");
    chunks.dispose();
  }, 30_000);

  it("rejects terrain-dependent horizontal entry into missing active chunks", () => {
    const hit = { height: 2, normal: { x: 0, y: 1, z: 0 }, chunkId: "0,0" as const, triangleIndex: 3, candidateCount: 1, barycentric: [1, 0, 0] as const };
    const entity = { transform: { x: 17, y: 2.5, z: 1, yaw: 0 }, previousTransform: { x: 1, y: 2.5, z: 1, yaw: 0 }, velocity: { x: 1, y: -1, z: 0 }, terrainFollower: { heightOffset: 0.76 }, jump: { grounded: false } };
    const world = createEcsWorld(); world.add(entity);
    const query = vi.fn((x: number) => x < CHUNK_SIZE ? hit : undefined);
    new TerrainSamplingSystem("no-active-fallback", { queryActiveTerrainSurface: query }).fixedUpdate(world);
    expect(entity.transform.x).toBe(1);
    expect(entity.transform.z).toBe(1);
    expect(entity.transform.y).toBeCloseTo(2.76);
    expect(entity.jump.grounded).toBe(true);
  });

  it("constrains airborne horizontal movement over missing terrain without creating an invisible floor", () => {
    const hit = { height: 2, normal: { x: 0, y: 1, z: 0 }, chunkId: "0,0" as const, triangleIndex: 3, candidateCount: 1, barycentric: [1, 0, 0] as const };
    const entity = { transform: { x: 17, y: 10, z: 1, yaw: 0 }, previousTransform: { x: 1, y: 10, z: 1, yaw: 0 }, velocity: { x: 1, y: 2, z: 0 }, terrainFollower: { heightOffset: 0.76 }, jump: { grounded: true } };
    const world = createEcsWorld(); world.add(entity);
    new TerrainSamplingSystem("airborne-missing", { queryActiveTerrainSurface: (x) => x < CHUNK_SIZE ? hit : undefined }).fixedUpdate(world);
    expect(entity.transform.x).toBe(1);
    expect(entity.transform.y).toBe(10);
    expect(entity.jump.grounded).toBe(false);
  });

  it("leaves the initial no-active-terrain frame ungrounded without procedural fallback", () => {
    const procedural = sampleTerrain("no-active-fallback", 0, 0).height;
    const entity = { transform: { x: 0, y: procedural + 10, z: 0, yaw: 0 }, previousTransform: { x: 0, y: procedural + 10, z: 0, yaw: 0 }, velocity: { x: 0, y: -1, z: 0 }, terrainFollower: { heightOffset: 0.76 }, jump: { grounded: true } };
    const world = createEcsWorld(); world.add(entity);
    const query = vi.fn(() => undefined);
    new TerrainSamplingSystem("no-active-fallback", { queryActiveTerrainSurface: query }).fixedUpdate(world);
    expect(query).toHaveBeenCalledTimes(2);
    expect(entity.transform.y).toBe(procedural + 10);
    expect(entity.jump.grounded).toBe(false);
  });

  it("preserves structure support precedence even when terrain is missing", () => {
    const entity = { transform: { x: 99, y: 5, z: 99, yaw: 0 }, previousTransform: { x: 1, y: 5, z: 1, yaw: 0 }, velocity: { x: 1, y: -1, z: 0 }, terrainFollower: { heightOffset: 0.76 }, structureSupport: { surfaceId: "deck" }, jump: { grounded: false } };
    const world = createEcsWorld(); world.add(entity);
    const query = vi.fn(() => undefined);
    new TerrainSamplingSystem("structure-missing", { queryActiveTerrainSurface: query }).fixedUpdate(world);
    expect(query).not.toHaveBeenCalled();
    expect(entity.transform.x).toBe(99);
    expect(entity.jump.grounded).toBe(true);
  });
});
