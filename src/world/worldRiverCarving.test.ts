import { describe, expect, it } from "vitest";
import { RiverSpine, worldRiverSpine } from "./worldRiverSpine";
import {
  applyWorldRiverCarving,
  createWorldRiverCarvingContext,
  sampleWorldRiverCarving,
  WORLD_RIVER_CARVING,
  WORLD_RIVER_MAX_CARVING_RADIUS,
} from "./worldRiverCarving";

describe("world river carving field", () => {
  it("is symmetric, signed, monotonic, continuous and deterministic", () => {
    const frame = worldRiverSpine.sampleFrame(0.45);
    const at = (offset: number) => sampleWorldRiverCarving(
      frame.position.x + frame.normal.x * offset,
      frame.position.z + frame.normal.z * offset,
    )!;
    expect(at(0).channelInfluence).toBe(1);
    expect(at(1).channelInfluence).toBe(at(-1).channelInfluence);
    expect(Math.sign(at(1).signedSide)).toBe(-Math.sign(at(-1).signedSide));
    const values = Array.from({ length: 41 }, (_, i) => {
      const sample = at(i * WORLD_RIVER_MAX_CARVING_RADIUS / 40);
      return applyWorldRiverCarving(2, sample);
    });
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]! - 1e-9);
    expect(at(WORLD_RIVER_MAX_CARVING_RADIUS + 0.01).insideCarvingFalloff).toBe(false);
    expect(applyWorldRiverCarving(2, at(WORLD_RIVER_MAX_CARVING_RADIUS + 0.01))).toBe(2);
    for (const boundary of [WORLD_RIVER_CARVING.halfWidth,
      WORLD_RIVER_CARVING.halfWidth + WORLD_RIVER_CARVING.bankWidth,
      WORLD_RIVER_MAX_CARVING_RADIUS]) {
      expect(Math.abs(applyWorldRiverCarving(2, at(boundary - 1e-5))
        - applyWorldRiverCarving(2, at(boundary + 1e-5)))).toBeLessThan(1e-4);
    }
    expect(at(3.2)).toEqual(at(3.2));
  });

  it("works for both principal orientations and has valid constants", () => {
    for (const spine of [new RiverSpine([{ x: -10, z: 0 }, { x: 10, z: 0 }]),
      new RiverSpine([{ x: 0, z: -10 }, { x: 0, z: 10 }])]) {
      const context = { spine, segments: spine.indexedSegments, hasRiver: true } as const;
      expect(sampleWorldRiverCarving(0, 0, context)!.channelInfluence).toBe(1);
      expect(Number.isFinite(sampleWorldRiverCarving(2.5, 2.5, context)!.targetBedHeight)).toBe(true);
    }
    expect(Object.values(WORLD_RIVER_CARVING).every(Number.isFinite)).toBe(true);
    expect(WORLD_RIVER_CARVING.halfWidth).toBeGreaterThan(0);
    expect(WORLD_RIVER_CARVING.bankWidth).toBeGreaterThan(0);
    expect(WORLD_RIVER_CARVING.falloffWidth).toBeGreaterThan(0);
  });

  it("uses deterministic bounded candidate contexts and an empty fast path", () => {
    const far = createWorldRiverCarvingContext({ minX: 1000, maxX: 1016, minZ: 1000, maxZ: 1016 });
    expect(far.hasRiver).toBe(false);
    expect(sampleWorldRiverCarving(1008, 1008, far)).toBeUndefined();
    const frame = worldRiverSpine.sampleFrame(0.5);
    const local = createWorldRiverCarvingContext({
      minX: frame.position.x - 8, maxX: frame.position.x + 8,
      minZ: frame.position.z - 8, maxZ: frame.position.z + 8,
    });
    expect(local.segments.length).toBeGreaterThan(0);
    expect(local.segments.length).toBeLessThan(worldRiverSpine.indexedSegments.length);
    expect(local.segments.map(segment => segment.index)).toEqual(
      [...local.segments].map(segment => segment.index).sort((a, b) => a - b),
    );
    expect(sampleWorldRiverCarving(frame.position.x, frame.position.z, local))
      .toEqual(sampleWorldRiverCarving(frame.position.x, frame.position.z));
  });

  it("uses one finite absolute bed datum independent of progress", () => {
    const beds = Array.from({ length: 1001 }, (_, index) => {
      const p = worldRiverSpine.samplePosition(index / 1000);
      return sampleWorldRiverCarving(p.x, p.z)!.targetBedHeight;
    });
    expect(beds.every(Number.isFinite)).toBe(true);
    expect(worldRiverSpine.lookupBuildCount).toBe(1);
    const centreBeds = [0, 0.5, 1].map(progress => {
      const point = worldRiverSpine.samplePosition(progress);
      return sampleWorldRiverCarving(point.x, point.z)!.targetBedHeight;
    });
    expect(centreBeds[0]).toBeCloseTo(WORLD_RIVER_CARVING.surfaceElevation - WORLD_RIVER_CARVING.nominalBedDepth, 12);
    expect(centreBeds[1]).toBeCloseTo(centreBeds[0]!, 12);
    expect(centreBeds[2]).toBeCloseTo(centreBeds[0]!, 12);
  });

  it("creates an authoritative raised lip and walkable bank without flattening the outer terrain", () => {
    const frame = worldRiverSpine.sampleFrame(0.5);
    const at = (offset: number) => sampleWorldRiverCarving(
      frame.position.x + frame.normal.x * offset,
      frame.position.z + frame.normal.z * offset,
    )!;
    const edge = at(WORLD_RIVER_CARVING.halfWidth);
    expect(applyWorldRiverCarving(20, edge)).toBeCloseTo(
      WORLD_RIVER_CARVING.surfaceElevation + WORLD_RIVER_CARVING.lipHeight, 12,
    );
    expect(applyWorldRiverCarving(-20, edge)).toBeCloseTo(applyWorldRiverCarving(20, edge), 12);
    const inner = at(WORLD_RIVER_CARVING.halfWidth + WORLD_RIVER_CARVING.bankWidth);
    expect(applyWorldRiverCarving(20, inner)).toBeCloseTo(
      WORLD_RIVER_CARVING.surfaceElevation + WORLD_RIVER_CARVING.lipHeight
        + WORLD_RIVER_CARVING.innerBankRise, 12,
    );
    expect(applyWorldRiverCarving(20, at(WORLD_RIVER_MAX_CARVING_RADIUS + 0.01))).toBe(20);
  });
});
