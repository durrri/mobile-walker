import { describe, expect, it } from "vitest";
import { CHUNK_SIZE, worldToChunk } from "./chunkCoordinates";
import {
  BRIDGE_CANDIDATE_SPACING,
  BRIDGE_ENDPOINT_CLEARANCE,
  BRIDGE_LANDING_MARGIN,
  BRIDGE_MAX_CURVATURE_RADIANS,
  createBridgeCollision,
  generateBridges,
  getBridgeDeckTopElevation,
  queryWorldRiverBridgeCandidates,
} from "./bridges";
import { pointInFootprint } from "./poi";
import { WORLD_RIVER_CARVING } from "./worldRiverCarving";
import { getWorldRiverOwner } from "./worldRiverOwner";

const all = (seed = 7) => queryWorldRiverBridgeCandidates(seed, getWorldRiverOwner(seed).spine.bounds);
const generated = (seed = 7) => all(seed).slice(0,64).flatMap(candidate => generateBridges(seed, candidate.ownerChunk).bridges);

describe("world-owned river bridges", () => {
  it("uses stable global-distance identities independent of chunk discovery", () => {
    const candidates = all();
    expect(candidates.length).toBeGreaterThan(0);
    expect(all()).toEqual(candidates);
    for (let index = 1; index < candidates.length; index += 1) {
      expect(candidates[index]!.riverDistance - candidates[index - 1]!.riverDistance).toBeCloseTo(BRIDGE_CANDIDATE_SPACING);
      expect(candidates[index]!.id).toContain(`:d${candidates[index]!.latticeIndex}`);
    }
    const accepted=candidates.slice(0,48).filter(candidate=>generateBridges(7,candidate.ownerChunk).candidates.find(value=>value.id===candidate.id)?.accepted);
    for(let index=1;index<accepted.length;index+=1)expect(accepted[index]!.riverDistance-accepted[index-1]!.riverDistance).toBeGreaterThanOrEqual(BRIDGE_CANDIDATE_SPACING);
    const candidate = candidates[Math.min(2, candidates.length - 1)]!;
    const aroundOwner = queryWorldRiverBridgeCandidates(7, {
      minX: candidate.ownerChunk.x * CHUNK_SIZE,
      maxX: (candidate.ownerChunk.x + 1) * CHUNK_SIZE,
      minZ: candidate.ownerChunk.z * CHUNK_SIZE,
      maxZ: (candidate.ownerChunk.z + 1) * CHUNK_SIZE,
    });
    expect(aroundOwner.some(value => value.id === candidate.id)).toBe(true);
    expect(generateBridges(7, candidate.ownerChunk)).toEqual(generateBridges(7, candidate.ownerChunk));
  });

  it.each(["pedestrian-footbridge","heavy-timber-bridge","stone-bridge"] as const)("uses the actual %s deck top for terrain, collision and rendering",archetype=>{
    const candidate=all().slice(0,64).find(value=>generateBridges(7,value.ownerChunk).candidates.find(item=>item.id===value.id)?.accepted)!;
    const source=generateBridges(7,candidate.ownerChunk).bridges.find(value=>value.id===candidate.id)!;
    const profileHeight=archetype==="stone-bridge"?.65:archetype==="heavy-timber-bridge"?.22:.3;
    const structural={...source,archetype,scale:{...source.scale,profileHeight},crossingCentre:{...source.crossingCentre,y:candidate.proposedDeckElevation-profileHeight*.28-.11}};
    const collision=createBridgeCollision(structural),deckTop=getBridgeDeckTopElevation(structural);
    expect(deckTop).toBeCloseTo(candidate.proposedDeckElevation);expect(deckTop).toBeGreaterThan(WORLD_RIVER_CARVING.surfaceElevation);expect(deckTop).toBeGreaterThanOrEqual(Math.max(candidate.landingHeights.left,candidate.landingHeights.right));
    expect(candidate.approachSlope).toBeLessThanOrEqual(.22);expect(collision.surfaces[0]!.startHeight).toBeCloseTo(deckTop);expect(collision.surfaces[0]!.endHeight).toBeCloseTo(deckTop);
  });

  it("derives orientation, span, landings, elevation and ownership from the world river", () => {
    for (const candidate of all().slice(0,64)) {
      expect(Math.abs(candidate.riverTangent.x * candidate.crossingDirection.x + candidate.riverTangent.z * candidate.crossingDirection.z)).toBeLessThan(1e-9);
      expect(candidate.spanLength).toBeCloseTo(2 * (candidate.waterHalfWidth + WORLD_RIVER_CARVING.bankWidth + BRIDGE_LANDING_MARGIN));
      expect(candidate.proposedDeckElevation).toBeGreaterThan(WORLD_RIVER_CARVING.surfaceElevation);
      expect(candidate.ownerChunk).toEqual(worldToChunk(candidate.centre.x, candidate.centre.z));
      expect(Math.hypot(candidate.leftBankAnchor.x - candidate.centre.x, candidate.leftBankAnchor.z - candidate.centre.z)).toBeCloseTo(candidate.bankExtent);
      expect(candidate.leftBankAnchor.x - candidate.centre.x).toBeCloseTo(candidate.crossingDirection.x * candidate.bankExtent);
    }
  });

  it("deterministically rejects endpoints, bends, and unsuitable terrain", () => {
    for (const candidate of all().slice(0,64)) {
      const result = generateBridges(7, candidate.ownerChunk);
      const diagnostic = result.candidates.find(value => value.id === candidate.id)!;
      expect(diagnostic).toBeDefined();
      if (candidate.riverDistance < BRIDGE_ENDPOINT_CLEARANCE || candidate.riverDistance > getWorldRiverOwner(7).spine.totalLength - BRIDGE_ENDPOINT_CLEARANCE) expect(diagnostic.reason).toBe("near river endpoint");
      if (candidate.curvatureRadians > BRIDGE_MAX_CURVATURE_RADIANS && diagnostic.reason !== "rarity") expect(diagnostic.reason).toBe("river too curved");
    }
  });

  it("has one owner, oriented exact exclusions, and collision/rendering frame parity", () => {
    const seed=2,bridges=generated(seed); // Versioned representative with accepted off-column crossings.
    expect(bridges.length).toBeGreaterThan(0);
    expect(new Set(bridges.map(bridge => bridge.id)).size).toBe(bridges.length);
    expect(new Set(bridges.map(bridge => `${bridge.ownerChunk.x},${bridge.ownerChunk.z}`)).size).toBeGreaterThanOrEqual(1);
    for (const bridge of bridges) {
      expect(bridge.collision.direction).toEqual(bridge.crossingDirection);
      expect(createBridgeCollision({ ...bridge, collision: undefined } as never)).toEqual(bridge.collision);
      for (const approach of Object.values(bridge.approachPoints)) expect(bridge.zones.some(zone => zone.purpose === "vegetation-exclusion" && pointInFootprint(approach.x, approach.z, zone.footprint))).toBe(true);
      expect(generateBridges(seed, { x: bridge.ownerChunk.x + 1, z: bridge.ownerChunk.z }).bridges.some(value => value.id === bridge.id)).toBe(false);
    }
  });
});
