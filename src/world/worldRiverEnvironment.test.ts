import { describe, expect, it } from "vitest";
import { WORLD_RIVER_CARVING, WORLD_RIVER_LIP_CREST_DISTANCE, WORLD_RIVER_MAX_CARVING_RADIUS } from "./worldRiverCarving";
import {
  RIVER_OBJECT_CLEARANCE,
  RIVER_PLACEMENT_TUNING,
  createWorldRiverEnvironmentContext,
  decideWorldRiverObjectPlacement,
  sampleWorldRiverEnvironment,
  type RiverObjectCategory,
} from "./worldRiverEnvironment";
import { RiverSpine } from "./worldRiverSpine";

const spine = new RiverSpine([{ x: 0, z: -50 }, { x: 0, z: 50 }], { lookupSamples: 128, indexSamples: 64 });
const context = createWorldRiverEnvironmentContext({ minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, spine);
const at = (distance: number, side = 1) => sampleWorldRiverEnvironment(distance * side, 0, context);

describe("world river environmental zones", () => {
  it("classifies the authoritative cross-section landmarks symmetrically", () => {
    expect(at(0).zone).toBe("water");
    expect(at(WORLD_RIVER_CARVING.waterHalfWidth).zone).toBe("water");
    expect(at(WORLD_RIVER_CARVING.waterHalfWidth + 0.01).zone).toBe("shoreTransition");
    expect(at(WORLD_RIVER_LIP_CREST_DISTANCE + 0.01).zone).toBe("walkableBank");
    expect(at(WORLD_RIVER_CARVING.waterHalfWidth + WORLD_RIVER_CARVING.bankWidth + 0.01).zone).toBe("outerFalloff");
    expect(at(WORLD_RIVER_MAX_CARVING_RADIUS + 0.01).zone).toBe("outsideRiverInfluence");
    for (const distance of [0, 2, 2.1, 2.5, 4, 6]) {
      expect(at(distance, -1).zone).toBe(at(distance, 1).zone);
      expect(at(distance, -1).signedSide).toBeCloseTo(-at(distance, 1).signedSide, 5);
    }
  });

  it("is orientation independent on east/west and diagonal reaches", () => {
    for (const points of [
      [{ x: -50, z: 0 }, { x: 50, z: 0 }],
      [{ x: -50, z: -50 }, { x: 50, z: 50 }],
    ]) {
      const oriented = new RiverSpine(points, { lookupSamples: 128, indexSamples: 64 });
      const local = createWorldRiverEnvironmentContext({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, oriented);
      const frame = oriented.sampleFrame(0.5);
      const sample = sampleWorldRiverEnvironment(
        frame.position.x + frame.normal.x * (WORLD_RIVER_LIP_CREST_DISTANCE + 0.1),
        frame.position.z + frame.normal.z * (WORLD_RIVER_LIP_CREST_DISTANCE + 0.1), local,
      );
      expect(sample.zone).toBe("walkableBank");
    }
  });

  it("remains deterministic on a strong bend and across overlapping contexts", () => {
    const bend = new RiverSpine([{ x: -30, z: -20 }, { x: 0, z: 0 }, { x: -30, z: 20 }]);
    const a = createWorldRiverEnvironmentContext({ minX: -12, maxX: 4, minZ: -8, maxZ: 8 }, bend);
    const b = createWorldRiverEnvironmentContext({ minX: -4, maxX: 12, minZ: -8, maxZ: 8 }, bend);
    expect(sampleWorldRiverEnvironment(0, 0, a)).toEqual(sampleWorldRiverEnvironment(0, 0, b));
    expect(sampleWorldRiverEnvironment(0, 0, a)).toEqual(sampleWorldRiverEnvironment(0, 0, a));
  });

  it("takes a no-river fast path for dry bounds", () => {
    const dry = createWorldRiverEnvironmentContext({ minX: 100, maxX: 110, minZ: 100, maxZ: 110 }, spine);
    expect(dry.hasRiver).toBe(false);
    expect(decideWorldRiverObjectPlacement({ seed: 1, category: "tree", worldX: 105, worldZ: 105, context: dry }).accepted).toBe(true);
  });
});

describe("river object category policy", () => {
  const decision = (category: RiverObjectCategory, distance: number, identityX = 1) =>
    decideWorldRiverObjectPlacement({ seed: 42, category, worldX: distance, worldZ: 0, identityX, identityZ: 7, footprintClearance: 0, context });

  it.each(["tree", "largeShrub", "largeRock", "decorativeProp"] as const)("clears %s through the walkable bank", category => {
    expect(decision(category, 0).accepted).toBe(false);
    expect(decision(category, WORLD_RIVER_CARVING.waterHalfWidth + 0.1).accepted).toBe(false);
    expect(decision(category, WORLD_RIVER_LIP_CREST_DISTANCE + 0.1).accepted).toBe(false);
  });

  it("allows bank flowers and reachable collectibles but never water collectibles", () => {
    expect(decision("tinyVegetation", WORLD_RIVER_LIP_CREST_DISTANCE + 0.1).accepted).toBe(true);
    expect(decision("collectible", WORLD_RIVER_LIP_CREST_DISTANCE + 0.3).accepted).toBe(true);
    expect(decision("wetlandPool", WORLD_RIVER_LIP_CREST_DISTANCE + 0.8).accepted).toBe(true);
    expect(decision("collectible", 0).accepted).toBe(false);
    expect(decision("wetlandPool", WORLD_RIVER_CARVING.waterHalfWidth + 0.1).accepted).toBe(false);
  });

  it("uses stable category hashes for shoreline flowers and bank rocks", () => {
    const repeated = Array.from({ length: 100 }, (_, identity) => decision("tinyVegetation", 2.1, identity).accepted);
    expect(repeated).toEqual(Array.from({ length: 100 }, (_, identity) => decision("tinyVegetation", 2.1, identity).accepted));
    const survivors = repeated.filter(Boolean).length;
    expect(survivors).toBeGreaterThanOrEqual(4);
    expect(survivors).toBeLessThanOrEqual(18);
    expect(RIVER_PLACEMENT_TUNING.shoreTinyVegetationSurvival).toBe(0.1);
    expect(RIVER_PLACEMENT_TUNING.walkableBankSmallRockSurvival).toBe(0.22);
  });

  it("delegates every category unchanged throughout the outer falloff", () => {
    const outer = WORLD_RIVER_CARVING.waterHalfWidth + WORLD_RIVER_CARVING.bankWidth + 0.7;
    for (const category of ["tree", "largeShrub", "largeRock", "smallRock", "tinyVegetation", "collectible", "wetlandPool", "decorativeProp"] as const) {
      expect(decision(category, outer)).toEqual({ accepted: true, zone: "outerFalloff" });
    }
  });

  it("composes POI and bridge-owned structure exclusion before bank allowances", () => {
    for (const category of ["tinyVegetation", "collectible"] as const) {
      expect(decideWorldRiverObjectPlacement({ seed: 1, category, worldX: 3, worldZ: 0, structureExcluded: true, context }))
        .toMatchObject({ accepted: false, reason: "structure" });
    }
  });

  it("uses category footprints symmetrically and across context boundaries", () => {
    const centre = WORLD_RIVER_LIP_CREST_DISTANCE + RIVER_OBJECT_CLEARANCE.tree - 0.01;
    for (const side of [-1, 1]) expect(decideWorldRiverObjectPlacement({ seed: 2, category: "tree", worldX: centre * side, worldZ: 0, context }).accepted).toBe(false);
    const left = createWorldRiverEnvironmentContext({ minX: -8, maxX: 0, minZ: -8, maxZ: 8 }, spine);
    const right = createWorldRiverEnvironmentContext({ minX: 0, maxX: 8, minZ: -8, maxZ: 8 }, spine);
    const options = { seed: 2, category: "largeRock" as const, worldX: 2.6, worldZ: 0 };
    expect(decideWorldRiverObjectPlacement({ ...options, context: left })).toEqual(decideWorldRiverObjectPlacement({ ...options, context: right }));
  });
});
