import { describe, expect, it } from "vitest";
import { clearPoiGenerationCaches, type GeneratedPoi, type PoiBeaconDefinition } from "../world/poi";
import { GeneratedChunkRepository } from "../world/GeneratedChunkRepository";
import { generateChunk } from "../world/generateChunk";
import { poiFixture } from "../world/riverProceduralFixtures";
import { PoiBeaconState } from "./poiBeaconState";

const definition = (fixtures: readonly ("fire" | "lantern")[]): PoiBeaconDefinition => ({
  profile: "cabin", fixtures: fixtures.map(kind => ({ id: kind, kind, anchor: { x: 0, y: 0, z: 0 } })),
});
const poi = (id: string, fixtures: readonly ("fire" | "lantern")[] = ["fire", "lantern"]): Pick<GeneratedPoi, "id" | "beacon"> =>
  ({ id, beacon: definition(fixtures) });

describe("POI beacon gameplay state", () => {
  it("keeps fire and lantern physically independent through activation and deactivation", () => {
    const state = new PoiBeaconState(), target = poi("stable-generated-id");
    expect(state.light(target, "fire")).toBe("changed");
    expect(state.getState(target.id)).toEqual({ fireLit: true, lanternLit: false });
    expect(state.light(target, "lantern")).toBe("changed");
    expect(state.extinguish(target, "fire")).toBe("changed");
    expect(state.getState(target.id)).toEqual({ fireLit: false, lanternLit: true });
    expect(state.extinguish(target, "lantern")).toBe("changed");
    expect(state.serialize()).toEqual([]);
  });

  it("keys state by existing POI id without leaking between POIs", () => {
    const state = new PoiBeaconState(), first = poi("poi:one"), second = poi("poi:two");
    state.light(first, "fire");
    expect(state.getState(first.id).fireLit).toBe(true);
    expect(state.getState(second.id)).toEqual({ fireLit: false, lanternLit: false });
  });

  it("rejects unsupported fixtures without creating impossible state", () => {
    const state = new PoiBeaconState(), lanternOnly = poi("lantern-only", ["lantern"]);
    expect(state.light(lanternOnly, "fire")).toBe("unsupported");
    expect(state.light({ id: "no-facility" }, "lantern")).toBe("unsupported");
    expect(state.serialize()).toEqual([]);
  });

  it("serializes sparsely and in stable POI and fixture order", () => {
    const state = new PoiBeaconState();
    state.light(poi("z"), "lantern"); state.light(poi("a"), "lantern"); state.light(poi("a"), "fire");
    expect(state.serialize()).toEqual([
      { poiId: "a", litFixtures: ["fire", "lantern"] }, { poiId: "z", litFixtures: ["lantern"] },
    ]);
    expect(new PoiBeaconState(state.serialize()).serialize()).toEqual(state.serialize());
  });

  it("is unaffected by generated chunk repository lifecycle", () => {
    const seed = 0;
    const fixture = poiFixture(seed, candidate => candidate.typeId === "plains-farmhouse");
    const repository = new GeneratedChunkRepository();
    const generatedChunk = generateChunk(seed, fixture.chunk);
    repository.set(generatedChunk.id, generatedChunk);
    const target = repository.get(generatedChunk.id)?.pois.find(candidate => candidate.id === fixture.poi.id);
    if (!target) throw new Error("Expected the fixture POI in its generated owner chunk.");

    const state = new PoiBeaconState();
    expect(state.light(target, "fire")).toBe("changed");
    repository.delete(generatedChunk.id);
    expect(repository.get(generatedChunk.id)).toBeUndefined();

    clearPoiGenerationCaches();
    const regeneratedChunk = generateChunk(seed, fixture.chunk);
    repository.set(regeneratedChunk.id, regeneratedChunk);
    const reacquired = repository.get(regeneratedChunk.id)?.pois.find(candidate => candidate.id === fixture.poi.id);
    expect(reacquired).not.toBe(target);
    expect(reacquired?.id).toBe(target.id);
    if (!reacquired) throw new Error("Expected the deterministic POI after chunk regeneration.");
    expect(state.getState(reacquired.id).fireLit).toBe(true);
  });
});
