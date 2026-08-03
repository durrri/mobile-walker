import { describe, expect, it } from "vitest";
import { RiverSpine, worldRiverSpine } from "./worldRiverSpine";
import { createWorldRiverRelationshipContext, queryWorldRiverRelationship } from "./worldRiverRelationship";

describe("world-river POI relationships", () => {
  it.each([0.18, 0.48, 0.72])("keeps side, distance, and an orthonormal frame stable at progress %s", progress => {
    const frame = worldRiverSpine.sampleFrame(progress);
    const left = queryWorldRiverRelationship(frame.position.x + frame.normal.x * 3, frame.position.z + frame.normal.z * 3)!;
    const right = queryWorldRiverRelationship(frame.position.x - frame.normal.x * 3, frame.position.z - frame.normal.z * 3)!;
    expect(left.signedSide).toBeGreaterThan(0);
    expect(right.signedSide).toBeLessThan(0);
    expect(left.distanceToCentreline).toBeCloseTo(3, 3);
    expect(left.tangent.x * left.normal.x + left.tangent.z * left.normal.z).toBeCloseTo(0, 9);
    expect(Math.hypot(left.normal.x, left.normal.z)).toBeCloseTo(1, 9);
  });

  it.each([
    [[{ x: 0, z: 0 }, { x: 0, z: 30 }, { x: 0, z: 60 }], "straight"],
    [[{ x: 0, z: 0 }, { x: 20, z: 20 }, { x: 40, z: 40 }], "diagonal"],
    [[{ x: 0, z: 0 }, { x: 30, z: 1 }, { x: 60, z: 2 }], "near-horizontal"],
    [[{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 30 }, { x: 5, z: 45 }], "bend"],
  ] as const)("queries a reach without an axis convention", (points, _name) => {
    const spine = new RiverSpine(points);
    const frame = spine.sampleFrame(0.5);
    const context = createWorldRiverRelationshipContext({ minX: frame.position.x - 4, maxX: frame.position.x + 4, minZ: frame.position.z - 4, maxZ: frame.position.z + 4 }, 8, spine);
    const relationship = queryWorldRiverRelationship(frame.position.x + frame.normal.x * 2, frame.position.z + frame.normal.z * 2, context, { curvatureThresholdRadians: 0.01 });
    expect(relationship?.signedSide).toBeGreaterThan(0);
    expect(relationship?.segmentIndex).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(relationship?.curvatureRadians)).toBe(true);
  });

  it("makes bounded and point contexts agree and handles endpoints deterministically", () => {
    const frame = worldRiverSpine.sampleFrame(0.01);
    const context = createWorldRiverRelationshipContext({ minX: frame.position.x - 8, maxX: frame.position.x + 8, minZ: frame.position.z - 8, maxZ: frame.position.z + 8 }, 12);
    const bounded = queryWorldRiverRelationship(frame.position.x, frame.position.z, context, { endpointDistance: 10 })!;
    const direct = queryWorldRiverRelationship(frame.position.x, frame.position.z, undefined, { endpointDistance: 10 })!;
    expect(bounded.nearest).toEqual(direct.nearest);
    expect(bounded.distanceAlongRiver).toEqual(direct.distanceAlongRiver);
    expect(bounded.nearEndpoint).toBe(direct.nearEndpoint);
  });

  it("uses the indexed dry fast path and supports river reaches outside legacy column zero", () => {
    const dry = createWorldRiverRelationshipContext({ minX: -2, maxX: 2, minZ: 500, maxZ: 516 }, 12);
    expect(dry.hasRiver).toBe(false);
    expect(queryWorldRiverRelationship(0, 508, dry)).toBeUndefined();
    const outsideOldColumn = worldRiverSpine.sampleFrame(0.35);
    expect(Math.abs(outsideOldColumn.position.x)).toBeGreaterThan(16);
    expect(queryWorldRiverRelationship(outsideOldColumn.position.x, outsideOldColumn.position.z)).toBeDefined();
  });
});
