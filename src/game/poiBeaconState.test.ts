import { describe, expect, it } from "vitest";
import type { GeneratedPoi, PoiBeaconDefinition } from "../world/poi";
import { GeneratedChunkRepository } from "../world/GeneratedChunkRepository";
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
    const state = new PoiBeaconState(), target = poi("resident-or-not");
    state.light(target, "fire");
    const chunks = new GeneratedChunkRepository();
    chunks.clear();
    expect(state.getState(target.id).fireLit).toBe(true);
    expect(Object.keys(target)).toEqual(["id", "beacon"]);
  });
});
