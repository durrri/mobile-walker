import { beforeEach, describe, expect, it } from "vitest";

import type { TransformComponent } from "../ecs/Entity";
import { generateTrees, TREE_TRUNK_RADIUS } from "./forest";
import {
  clearTreeCollisionCache,
  PLAYER_COLLISION_RADIUS,
  resolveSweptCircularMovement,
  resolveTreeTrunkMovement,
  TREE_TRUNK_MAX_COLLISION_ITERATIONS,
  TREE_TRUNK_SEPARATION_EPSILON,
  TREE_TRUNK_TANGENTIAL_RETENTION,
  treeCollisionCacheDiagnostics,
} from "./treeCollision";
import { generateLeafTrees, LEAF_TREE_TRUNK_RADIUS } from "./vegetation";

describe("resolveTreeTrunkMovement", () => {
  const seed = "tree-collision-test";
  const tree = generateTrees(seed, { x: 0, z: 0 })[0]!;

  beforeEach(clearTreeCollisionCache);

  it("blocks movement into a generated tree trunk", () => {
    expect(tree).toBeDefined();
    const radius = PLAYER_COLLISION_RADIUS + TREE_TRUNK_RADIUS * tree.scale;
    const from: TransformComponent = { x: tree.x - radius - 0.1, y: tree.y + 0.76, z: tree.z, yaw: 1 };
    const to: TransformComponent = { ...from, x: tree.x - radius + 0.05 };

    const resolved = resolveTreeTrunkMovement(seed, from, to);
    expect(resolved.x).toBeCloseTo(tree.x - radius - TREE_TRUNK_SEPARATION_EPSILON, 3);
    expect(resolved.z).toBeCloseTo(tree.z, 1);
  });

  it("blocks movement into a generated leaf tree trunk", () => {
    const leafTree = generateLeafTrees(seed, { x: 0, z: 0 })[0]!;
    expect(leafTree).toBeDefined();
    const radius = PLAYER_COLLISION_RADIUS + LEAF_TREE_TRUNK_RADIUS * leafTree.scale;
    const from: TransformComponent = {
      x: leafTree.x - radius - 0.1,
      y: leafTree.y + 0.76,
      z: leafTree.z,
      yaw: 1,
    };
    const to: TransformComponent = { ...from, x: leafTree.x - radius + 0.05 };

    const resolved = resolveTreeTrunkMovement(seed, from, to);
    expect(resolved.x).toBeCloseTo(leafTree.x - radius - TREE_TRUNK_SEPARATION_EPSILON, 8);
  });

  it("allows movement beneath foliage when clear of the trunk", () => {
    const radius = PLAYER_COLLISION_RADIUS + TREE_TRUNK_RADIUS * tree.scale;
    const z = tree.z + radius + 0.05;
    const from: TransformComponent = { x: tree.x - 0.1, y: tree.y + 0.76, z, yaw: 0 };
    const to: TransformComponent = { ...from, x: tree.x + 0.1 };

    expect(resolveTreeTrunkMovement(seed, from, to)).toEqual(to);
  });

  it("slides tangentially around a trunk rather than resolving axes independently", () => {
    const radius = PLAYER_COLLISION_RADIUS + TREE_TRUNK_RADIUS * tree.scale;
    const from: TransformComponent = {
      x: tree.x - radius - 0.1,
      y: tree.y + 0.76,
      z: tree.z - 0.2,
      yaw: 0,
    };
    const to: TransformComponent = { ...from, x: tree.x - radius + 0.05, z: tree.z - 0.3 };

    const resolved = resolveTreeTrunkMovement(seed, from, to);
    expect(resolved.z).toBeLessThan(from.z);
    expect(Math.hypot(resolved.x - tree.x, resolved.z - tree.z)).toBeGreaterThanOrEqual(radius);
  });

  it("reuses collision placements for repeated movement through the same chunks", () => {
    const from: TransformComponent = { x: 8, y: 0, z: 8, yaw: 0 };
    const to = { ...from, x: 8.2 };

    resolveTreeTrunkMovement(seed, from, to);
    const first = treeCollisionCacheDiagnostics();
    resolveTreeTrunkMovement(seed, to, from);

    expect(first.generatedChunkCount).toBe(1);
    expect(treeCollisionCacheDiagnostics()).toMatchObject({ size: 1, generatedChunkCount: 1 });
  });

  it("generates both chunks at an edge only once", () => {
    const from: TransformComponent = { x: 0, y: 0, z: 8, yaw: 0 };
    resolveTreeTrunkMovement(seed, from, { ...from, z: 8.1 });
    resolveTreeTrunkMovement(seed, from, { ...from, z: 7.9 });

    const diagnostics = treeCollisionCacheDiagnostics();
    expect(diagnostics.generatedChunkCount).toBe(2);
    expect(new Set(diagnostics.keys).size).toBe(2);
  });

  it("generates all four chunks at a corner only once", () => {
    const from: TransformComponent = { x: 0, y: 0, z: 0, yaw: 0 };
    resolveTreeTrunkMovement(seed, from, { ...from, x: 0.1, z: 0.1 });
    resolveTreeTrunkMovement(seed, from, { ...from, x: -0.1, z: -0.1 });

    const diagnostics = treeCollisionCacheDiagnostics();
    expect(diagnostics.generatedChunkCount).toBe(4);
    expect(new Set(diagnostics.keys).size).toBe(4);
  });
});

describe("resolveSweptCircularMovement", () => {
  const trunk = [{ x: 0, z: 0, radius: 1 }];

  it("stops direct movement at the boundary and cannot tunnel", () => {
    const result = resolveSweptCircularMovement(-10, 0, 20, 0, trunk);
    expect(result.x).toBeCloseTo(-1 - TREE_TRUNK_SEPARATION_EPSILON, 8);
    expect(result.z).toBe(0);
    expect(Math.hypot(result.x, result.z)).toBeGreaterThanOrEqual(1);
  });

  it("retains exactly 95% of the geometrically valid tangent", () => {
    // Contact is at (-1, 0), so the unconsumed (1, 1) has inward normal -1
    // removed and leaves the tangent (0, 1).
    const result = resolveSweptCircularMovement(-2, -1, 2, 2, trunk);
    const tangentialTravel = result.z;
    expect(tangentialTravel).toBeCloseTo(TREE_TRUNK_TANGENTIAL_RETENTION, 5);
    expect(result.x).toBeCloseTo(-1 - TREE_TRUNK_SEPARATION_EPSILON, 5);
  });

  it.each([
    [-2, -1, 2, 2],
    [2, 1, -2, -2],
    [1, -2, -2, 2],
    [-1, 2, 2, -2],
  ])("slides equivalently on every side", (x, z, dx, dz) => {
    const result = resolveSweptCircularMovement(x, z, dx, dz, trunk);
    expect(Math.hypot(result.x, result.z)).toBeGreaterThanOrEqual(1);
    expect(Math.hypot(result.x - x, result.z - z)).toBeCloseTo(Math.hypot(1, 1.95), 4);
  });

  it("does not cancel outward movement", () => {
    expect(resolveSweptCircularMovement(-1, 0, -2, 0, trunk)).toEqual({ x: -3, z: 0 });
  });

  it("resolves the earliest trunk and then a second collider", () => {
    const colliders = [{ x: 0, z: 0, radius: 1 }, { x: -1, z: 2, radius: 1 }];
    const result = resolveSweptCircularMovement(-3, 0, 4, 4, colliders);
    for (const collider of colliders) {
      expect(Math.hypot(result.x - collider.x, result.z - collider.z)).toBeGreaterThanOrEqual(collider.radius);
    }
  });

  it("corrects initial penetration minimally and handles a degenerate centre", () => {
    const nearEdge = resolveSweptCircularMovement(0.9, 0, 0, 0, trunk);
    expect(nearEdge.x).toBeCloseTo(1 + TREE_TRUNK_SEPARATION_EPSILON, 8);
    const centre = resolveSweptCircularMovement(0, 0, 0, 0, trunk);
    expect(centre.x).toBeCloseTo(1 + TREE_TRUNK_SEPARATION_EPSILON, 8);
    expect(Number.isFinite(centre.x) && Number.isFinite(centre.z)).toBe(true);
  });

  it("returns an unobstructed zero displacement unchanged", () => {
    expect(resolveSweptCircularMovement(2, 3, 0, 0, trunk)).toEqual({ x: 2, z: 3 });
    expect(TREE_TRUNK_MAX_COLLISION_ITERATIONS).toBeGreaterThan(0);
    expect(TREE_TRUNK_MAX_COLLISION_ITERATIONS).toBeLessThanOrEqual(5);
  });
});
