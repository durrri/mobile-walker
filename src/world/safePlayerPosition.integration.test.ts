import { describe, expect, it } from "vitest";
import { generateBridges, type GeneratedBridge } from "./bridges";
import { generatePois, type GeneratedPoi } from "./poi";
import { PLAYER_COLLISION_RADIUS } from "./treeCollision";
import {
  classifyStructureRestorationSafety,
  createCanonicalStructureSafetyQuery,
} from "./structureCollision";
import { findSafeRestoredTransformFromCanonicalWorld } from "./safePlayerPosition";
import { createWorldRiverGameplayContext, isInsideWorldRiverWater } from "./worldRiverGameplay";
import { getWorldRiverOwner } from "./worldRiverOwner";
import { worldRiverSpine } from "./worldRiverSpine";

const seed = "mobile-walker-v2", offset = .76;
const structures = (() => {
  const bridges: GeneratedBridge[] = [], pois: GeneratedPoi[] = [];
  for (let z = -8; z <= 8; z++) for (let x = -8; x <= 8; x++) {
    bridges.push(...generateBridges(seed, { x, z }).bridges);
    pois.push(...generatePois(seed, { x, z }).pois);
  }
  return { bridges, pois };
})();
const canonical = createCanonicalStructureSafetyQuery(seed);
const bridge = structures.bridges.find(value =>
  canonical(value.crossingCentre.x, value.crossingCentre.z, PLAYER_COLLISION_RADIUS)?.kind === "walkable");

describe("production safe restoration structure integration", () => {
  it("keeps an actual generated bridge deck above river water at its authoritative height", () => {
    expect(bridge).toBeDefined();
    const deck = bridge!.collision.surfaces[0]!;
    const p=bridge!.crossingCentre,spine=getWorldRiverOwner(seed).spine;
    expect(isInsideWorldRiverWater(p.x,p.z,createWorldRiverGameplayContext({minX:p.x,maxX:p.x,minZ:p.z,maxZ:p.z},spine))).toBe(true);
    const saved = { x: bridge!.crossingCentre.x, y: -20, z: bridge!.crossingCentre.z, yaw: .4 };
    const restored = findSafeRestoredTransformFromCanonicalWorld(seed, saved, offset, PLAYER_COLLISION_RADIUS);
    expect(restored).toEqual({ ...saved, y: deck.startHeight + deck.crownHeight + offset });
  });

  it("rejects actual bridge railings or supports even where the deck broad phase overlaps", () => {
    const obstacleBridge = structures.bridges.find(value => value.collision.segments.length || value.collision.boxes.length);
    expect(obstacleBridge).toBeDefined();
    const segment = obstacleBridge!.collision.segments[0];
    const box = obstacleBridge!.collision.boxes[0];
    const point = segment
      ? { x: (segment.start.x + segment.end.x) / 2, z: (segment.start.z + segment.end.z) / 2 }
      : { x: box!.centre.x, z: box!.centre.z };
    expect(canonical(point.x, point.z, PLAYER_COLLISION_RADIUS)).toEqual({ kind: "solid" });
    const saved = { ...point, y: 0, yaw: 0 };
    expect(findSafeRestoredTransformFromCanonicalWorld(seed, saved, offset, PLAYER_COLLISION_RADIUS))
      .not.toMatchObject({ x: saved.x, z: saved.z });
  });

  it("rejects ordinary river water where no structure owns the point", () => {
    const point = Array.from({ length: 81 }, (_, index) => worldRiverSpine.samplePosition(index / 80))
      .find(value => isInsideWorldRiverWater(value.x, value.z)
        && canonical(value.x, value.z, PLAYER_COLLISION_RADIUS) === undefined)!;
    expect(point).toBeDefined();
    const restored = findSafeRestoredTransformFromCanonicalWorld(seed, { ...point, y: 0, yaw: 0 }, offset, PLAYER_COLLISION_RADIUS);
    expect(isInsideWorldRiverWater(restored.x, restored.z)).toBe(false);
  });

  it("uses the same unified rules for a generated walkable POI deck", () => {
    const poiSeed = 0, poiCanonical = createCanonicalStructureSafetyQuery(poiSeed);
    const generated = generatePois(poiSeed, { x: -16, z: -5 }).pois;
    const sample = generated.flatMap(poi => poi.structure.surfaces.flatMap(surface => {
      const normal = { x: -surface.direction.z, z: surface.direction.x };
      return [-.3, 0, .3].flatMap(u => [-.3, 0, .3].map(v => ({ poi, surface, point: {
        x: surface.centre.x + surface.direction.x * surface.length * u + normal.x * surface.width * v,
        z: surface.centre.z + surface.direction.z * surface.length * u + normal.z * surface.width * v,
      } })));
    })).find(({ point }) => poiCanonical(point.x, point.z, PLAYER_COLLISION_RADIUS)?.kind === "walkable");
    expect(sample).toBeDefined();
    const safety = poiCanonical(sample!.point.x, sample!.point.z, PLAYER_COLLISION_RADIUS);
    expect(safety?.kind).toBe("walkable");
    expect(safety!.kind === "walkable" && safety!.height).toBeGreaterThan(0);
  });

  it("is deterministic before and after equivalent streamed collision data is available", () => {
    const definitions = [bridge!.collision, ...structures.pois.map(poi => poi.structure)];
    const point = bridge!.crossingCentre;
    const before = canonical(point.x, point.z, PLAYER_COLLISION_RADIUS);
    const after = classifyStructureRestorationSafety(definitions, point.x, point.z, PLAYER_COLLISION_RADIUS);
    expect(after).toEqual(before);
    expect(createCanonicalStructureSafetyQuery(seed)(point.x, point.z, PLAYER_COLLISION_RADIUS)).toEqual(before);
  });
});
