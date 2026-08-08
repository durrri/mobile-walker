import { describe, expect, it } from "vitest";

import { createEcsWorld } from "../ecs/createEcsWorld";
import { GAME_STATE_STORAGE_KEY, loadGameState, PersistenceSystem, resetGameState } from "./persistence";
import { PoiBeaconState } from "./poiBeaconState";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe("game persistence", () => {
  it("resets saved progress", () => {
    const storage = new MemoryStorage();
    storage.setItem(GAME_STATE_STORAGE_KEY, "saved");
    resetGameState(storage);
    expect(storage.getItem(GAME_STATE_STORAGE_KEY)).toBeNull();
  });

  it("round-trips player progress and collected waypoint ids", () => {
    const storage = new MemoryStorage();
    const world = createEcsWorld();
    world.add({
      transform: { x: 12, y: 3, z: -8, yaw: 1.5 },
      playerControl: { moveX: 0, moveZ: 0, active: false, jump: false },
    });
    world.add({ collectionState: { collectedIds: new Set(["b", "a"]), discovered: 2 } });

    const beacons = new PoiBeaconState([{ poiId: "poi-z", litFixtures: ["lantern"] }, { poiId: "poi-a", litFixtures: ["fire"] }]);
    const persistence = new PersistenceSystem(storage, "seed", beacons, 1, () => -0.75);
    persistence.fixedUpdate(world, 1);

    expect(loadGameState(storage, "seed")).toEqual({
      version: 3,
      worldSeed: "seed",
      player: { x: 12, y: 3, z: -8, yaw: 1.5 },
      playerHeading: -0.75,
      collectedIds: ["a", "b"],
      poiBeacons: [
        { poiId: "poi-a", litFixtures: ["fire"] },
        { poiId: "poi-z", litFixtures: ["lantern"] },
      ],
    });
  });

  it("migrates player yaw as the heading for version 1 saves", () => {
    const storage = new MemoryStorage();
    storage.values.set(GAME_STATE_STORAGE_KEY, JSON.stringify({
      version: 1,
      worldSeed: "seed",
      player: { x: 4, y: 2, z: 7, yaw: 1.25 },
      collectedIds: [],
    }));

    expect(loadGameState(storage, "seed")).toMatchObject({ playerHeading: 1.25, poiBeacons: [] });
  });

  it("migrates the previous version 2 schema with beacon fixtures all off", () => {
    const storage = new MemoryStorage();
    storage.values.set(GAME_STATE_STORAGE_KEY, JSON.stringify({
      version: 2, worldSeed: "seed", player: { x: 9, y: 2, z: -3, yaw: 1.25 },
      playerHeading: -.4, collectedIds: ["collection-kept"],
    }));
    expect(loadGameState(storage, "seed")).toEqual({
      version: 3, worldSeed: "seed", player: { x: 9, y: 2, z: -3, yaw: 1.25 },
      playerHeading: -.4, collectedIds: ["collection-kept"], poiBeacons: [],
    });
  });

  it("ignores corrupt, incompatible, and other-world state", () => {
    const storage = new MemoryStorage();
    storage.values.set(GAME_STATE_STORAGE_KEY, "not json");
    expect(loadGameState(storage, "seed")).toBeUndefined();

    storage.values.set(GAME_STATE_STORAGE_KEY, JSON.stringify({
      version: 1,
      worldSeed: "old-seed",
      player: { x: 0, y: 0, z: 0, yaw: 0 },
      collectedIds: [],
    }));
    expect(loadGameState(storage, "seed")).toBeUndefined();
  });

  it("continues when browser storage rejects writes", () => {
    const world = createEcsWorld();
    world.add({
      transform: { x: 0, y: 1, z: 0, yaw: 0 },
      playerControl: { moveX: 0, moveZ: 0, active: false, jump: false },
    });
    world.add({ collectionState: { collectedIds: new Set(), discovered: 0 } });
    const storage = { getItem: () => null, setItem: () => { throw new Error("denied"); } };
    const persistence = new PersistenceSystem(storage, "seed", new PoiBeaconState());
    expect(() => persistence.fixedUpdate(world, 1)).not.toThrow();
  });

  it("preserves valid progress while discarding malformed beacon records", () => {
    const storage = new MemoryStorage();
    storage.values.set(GAME_STATE_STORAGE_KEY, JSON.stringify({
      version: 3, worldSeed: "seed", player: { x: 4, y: 2, z: 7, yaw: 1 }, playerHeading: .5,
      collectedIds: ["kept"], poiBeacons: [null, { poiId: 7, litFixtures: ["fire"] },
        { poiId: "valid", litFixtures: ["unknown", "lantern", "lantern"] }, { poiId: "broken" }],
    }));
    expect(loadGameState(storage, "seed")).toMatchObject({
      collectedIds: ["kept"], poiBeacons: [{ poiId: "valid", litFixtures: ["lantern"] }],
    });
  });

  it("does not load beacon state from another world seed", () => {
    const storage = new MemoryStorage();
    storage.values.set(GAME_STATE_STORAGE_KEY, JSON.stringify({
      version: 3, worldSeed: "other", player: { x: 0, y: 1, z: 0, yaw: 0 }, playerHeading: 0,
      collectedIds: [], poiBeacons: [{ poiId: "poi", litFixtures: ["fire"] }],
    }));
    expect(loadGameState(storage, "seed")).toBeUndefined();
  });
});
