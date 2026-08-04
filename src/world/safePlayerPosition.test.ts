import { describe, expect, it, vi } from "vitest";

import { generateTrees } from "./forest";
import { findSafeRestoredTransform } from "./safePlayerPosition";
import { sampleTerrain } from "./terrainSampling";
import { overlapsGeneratedTreeTrunk, PLAYER_COLLISION_RADIUS } from "./treeCollision";
import { worldRiverSpine } from "./worldRiverSpine";
import { WORLD_RIVER_LIP_CREST_DISTANCE, WORLD_RIVER_MAX_CARVING_RADIUS } from "./worldRiverCarving";
import { isInsideWorldRiverWater } from "./worldRiverGameplay";
import { createWorldRiverGameplayContext } from "./worldRiverGameplay";
import { getWorldRiverOwner } from "./worldRiverOwner";

describe("findSafeRestoredTransform", () => {
  const seed = "tree-collision-test";
  const offset = 0.76;
  const safe = { x: 1000, y: 123, z: 1000, yaw: 1.25 };
  const tree = generateTrees(seed, { x: 0, z: 0 })[0]!;

  it("leaves the horizontal position of a safe save unchanged", () => {
    const result = findSafeRestoredTransform(seed, safe, offset, PLAYER_COLLISION_RADIUS, 0.5, 5);
    expect(result).toMatchObject({ x: safe.x, z: safe.z });
  });

  it("corrects a restored position to terrain height", () => {
    const result = findSafeRestoredTransform(seed, safe, offset, PLAYER_COLLISION_RADIUS, 0.5, 5);
    expect(result.y).toBeCloseTo(sampleTerrain(seed, safe.x, safe.z).height + offset);
  });

  it("relocates a save from inside a generated trunk", () => {
    const result = findSafeRestoredTransform(seed, { ...tree, yaw: 0 }, offset, PLAYER_COLLISION_RADIUS, 0.5, 5);
    expect(overlapsGeneratedTreeTrunk(seed, result.x, result.z, PLAYER_COLLISION_RADIUS)).toBe(false);
    expect([result.x, result.z]).not.toEqual([tree.x, tree.z]);
  });

  it("selects a candidate on the nearest ring containing a safe point", () => {
    const result = findSafeRestoredTransform(seed, { ...tree, yaw: 0 }, offset, PLAYER_COLLISION_RADIUS, 0.5, 5);
    const radius = Math.hypot(result.x - tree.x, result.z - tree.z);
    for (let prior = 0.5; prior < radius - 1e-8; prior += 0.5) {
      const count = Math.ceil(2 * Math.PI * prior / 0.5);
      expect(Array.from({ length: count }, (_, index) => {
        const angle = index * 2 * Math.PI / count;
        return overlapsGeneratedTreeTrunk(
          seed, tree.x + Math.cos(angle) * prior, tree.z + Math.sin(angle) * prior, PLAYER_COLLISION_RADIUS,
        );
      }).every(Boolean)).toBe(true);
    }
  });

  it("returns deterministic repeat results", () => {
    const saved = { ...tree, yaw: 2 };
    expect(findSafeRestoredTransform(seed, saved, offset, PLAYER_COLLISION_RADIUS, 0.5, 5))
      .toEqual(findSafeRestoredTransform(seed, saved, offset, PLAYER_COLLISION_RADIUS, 0.5, 5));
  });

  it("preserves saved yaw after relocation", () => {
    expect(findSafeRestoredTransform(seed, { ...tree, yaw: 2.7 }, offset, PLAYER_COLLISION_RADIUS, 0.5, 5).yaw)
      .toBe(2.7);
  });

  it("rejects river water while accepting banks and outer falloff", () => {
    const owner=getWorldRiverOwner(seed),spine=owner.spine,frame = spine.sampleFrame(0.62);
    const at = (offset: number) => ({ x: frame.position.x + frame.normal.x * offset, y: 99,
      z: frame.position.z + frame.normal.z * offset, yaw: 0 });
    const neverBlocked = () => false;
    const water = findSafeRestoredTransform(seed, at(0), offset, PLAYER_COLLISION_RADIUS, 0.5, 5, neverBlocked);
    expect(isInsideWorldRiverWater(water.x, water.z, createWorldRiverGameplayContext({minX:water.x,maxX:water.x,minZ:water.z,maxZ:water.z},spine,owner.widthProfile))).toBe(false);
    for (const distance of [WORLD_RIVER_LIP_CREST_DISTANCE + 0.1, WORLD_RIVER_MAX_CARVING_RADIUS - 0.1]) {
      const origin = at(distance);
      expect(findSafeRestoredTransform(seed, origin, offset, PLAYER_COLLISION_RADIUS, 0.5, 5, neverBlocked))
        .toMatchObject({ x: origin.x, z: origin.z });
    }
  });

  it("lets a walkable structure deck override water and rejects structure solids", () => {
    const p = worldRiverSpine.samplePosition(0.35), neverBlocked = () => false;
    const saved = { x: p.x, y: 0, z: p.z, yaw: 0 };
    const deck = findSafeRestoredTransform(seed, saved, offset, PLAYER_COLLISION_RADIUS, 0.5, 1,
      neverBlocked, () => ({ kind: "walkable", height: 3 }));
    expect(deck).toEqual({ ...saved, y: 3 + offset });
    const solid = findSafeRestoredTransform(seed, saved, offset, PLAYER_COLLISION_RADIUS, 0.5, 1,
      neverBlocked, (x) => x === saved.x ? { kind: "solid" } : undefined);
    expect([solid.x, solid.z]).not.toEqual([saved.x, saved.z]);
  });

  it("uses the bounded grounded fallback when the area is entirely blocked", () => {
    const alwaysBlocked = vi.fn(() => true);
    const result = findSafeRestoredTransform(
      seed, { ...tree, yaw: 0.8 }, offset, PLAYER_COLLISION_RADIUS, 0.5, 1, alwaysBlocked,
    );
    expect(result).toEqual({
      x: 0,
      y: sampleTerrain(seed, 0, 0).height + offset,
      z: 0,
      yaw: 0.8,
    });
    // Each origin checks itself, seven points on the 0.5 m ring, and thirteen on
    // the 1 m ring. Both the saved origin and fallback spawn are bounded alike.
    expect(alwaysBlocked).toHaveBeenCalledTimes(42);
  });
});
