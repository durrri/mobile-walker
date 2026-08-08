import { describe, expect, it } from "vitest";

import { createEcsWorld } from "../ecs/createEcsWorld";
import {
  NOON_ELEVATION_STORAGE_KEY,
  restoreNoonElevation,
} from "./noonElevation";
import { GAME_STATE_STORAGE_KEY, loadGameState, PersistenceSystem, resetGameState } from "./persistence";

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
    storage.setItem(NOON_ELEVATION_STORAGE_KEY, "70");
    resetGameState(storage);
    expect(storage.getItem(GAME_STATE_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(NOON_ELEVATION_STORAGE_KEY)).toBeNull();
    expect(restoreNoonElevation(storage.getItem(NOON_ELEVATION_STORAGE_KEY))).toBe(45);
  });

  it.each([
    [null, 45],
    ["0", 0],
    ["45", 45],
    ["70", 70],
    ["not a number", 45],
    ["Infinity", 45],
  ])("restores noon elevation %s as %s", (storedValue, expected) => {
    expect(restoreNoonElevation(storedValue)).toBe(expected);
  });

  it("round-trips player progress and collected waypoint ids", () => {
    const storage = new MemoryStorage();
    const world = createEcsWorld();
    world.add({
      transform: { x: 12, y: 3, z: -8, yaw: 1.5 },
      playerControl: { moveX: 0, moveZ: 0, active: false, jump: false },
    });
    world.add({ collectionState: { collectedIds: new Set(["b", "a"]), discovered: 2 } });

    const persistence = new PersistenceSystem(storage, "seed", 1, () => -0.75);
    persistence.fixedUpdate(world, 1);

    expect(loadGameState(storage, "seed")).toEqual({
      version: 2,
      worldSeed: "seed",
      player: { x: 12, y: 3, z: -8, yaw: 1.5 },
      playerHeading: -0.75,
      collectedIds: ["a", "b"],
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

    expect(loadGameState(storage, "seed")?.playerHeading).toBe(1.25);
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
    const persistence = new PersistenceSystem(storage, "seed");
    expect(() => persistence.fixedUpdate(world, 1)).not.toThrow();
  });
});
