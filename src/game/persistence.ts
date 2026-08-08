import type { TransformComponent } from "../ecs/Entity";
import type { EcsWorld } from "../ecs/createEcsWorld";
import type { FixedSystem } from "../ecs/System";
import { PoiBeaconState, type PersistedPoiBeaconState } from "./poiBeaconState";

export const GAME_STATE_STORAGE_KEY = "mobile-walker:game-state";

interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function resetGameState(storage: StorageAdapter): void {
  try { storage.removeItem?.(GAME_STATE_STORAGE_KEY); } catch { /* Reset remains safe when storage is denied. */ }
}

const unavailableStorage: StorageAdapter = {
  getItem: () => null,
  setItem: () => undefined,
};

/** Accessing localStorage itself can throw in restricted browser contexts. */
export function getBrowserStorage(): StorageAdapter {
  try {
    return window.localStorage;
  } catch {
    return unavailableStorage;
  }
}

export interface PersistedGameState {
  readonly version: 3;
  readonly worldSeed: string;
  readonly player: TransformComponent;
  readonly playerHeading: number;
  readonly collectedIds: readonly string[];
  readonly poiBeacons: readonly PersistedPoiBeaconState[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseGameState(value: unknown, worldSeed: string): PersistedGameState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<PersistedGameState>;
  const player = candidate.player as Partial<TransformComponent> | undefined;
  const version = (candidate as { version?: unknown }).version;
  const heading = version === 1 ? player?.yaw : candidate.playerHeading;
  if ((version !== 1 && version !== 2 && version !== 3) || candidate.worldSeed !== worldSeed || !player
    || !isFiniteNumber(player.x) || !isFiniteNumber(player.y)
    || !isFiniteNumber(player.z) || !isFiniteNumber(player.yaw)
    || !isFiniteNumber(heading)
    || !Array.isArray(candidate.collectedIds)
    || candidate.collectedIds.some((id) => typeof id !== "string")) return undefined;
  const beacons = new Map<string, Set<"fire" | "lantern">>();
  if (version === 3 && Array.isArray(candidate.poiBeacons)) for (const value of candidate.poiBeacons) {
    if (!value || typeof value !== "object") continue;
    const entry = value as { poiId?: unknown; litFixtures?: unknown };
    if (typeof entry.poiId !== "string" || !entry.poiId || !Array.isArray(entry.litFixtures)) continue;
    const fixtures = beacons.get(entry.poiId) ?? new Set<"fire" | "lantern">();
    for (const fixture of entry.litFixtures) if (fixture === "fire" || fixture === "lantern") fixtures.add(fixture);
    if (fixtures.size) beacons.set(entry.poiId, fixtures);
  }
  return {
    version: 3,
    worldSeed,
    player: { x: player.x, y: player.y, z: player.z, yaw: player.yaw },
    playerHeading: heading,
    collectedIds: [...new Set(candidate.collectedIds)],
    poiBeacons: [...beacons.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([poiId, fixtures]) => ({
      poiId, litFixtures: (["fire", "lantern"] as const).filter(fixture => fixtures.has(fixture)),
    })),
  };
}

/** Returns no state when storage is unavailable, corrupt, or belongs to another world. */
export function loadGameState(storage: StorageAdapter, worldSeed: string): PersistedGameState | undefined {
  try {
    const serialized = storage.getItem(GAME_STATE_STORAGE_KEY);
    return serialized === null ? undefined : parseGameState(JSON.parse(serialized), worldSeed);
  } catch {
    return undefined;
  }
}

function snapshotGameState(world: EcsWorld, worldSeed: string, playerHeading: number, beacons: PoiBeaconState): PersistedGameState | undefined {
  const player = world.entities.find((entity) => entity.playerControl && entity.transform)?.transform;
  const collection = world.entities.find((entity) => entity.collectionState)?.collectionState;
  if (!player || !collection) return undefined;
  return {
    version: 3,
    worldSeed,
    player: { x: player.x, y: player.y, z: player.z, yaw: player.yaw },
    playerHeading,
    collectedIds: [...collection.collectedIds].sort(),
    poiBeacons: beacons.serialize(),
  };
}

/** Periodically stores durable simulation data without serializing ECS or Three.js objects. */
export class PersistenceSystem implements FixedSystem {
  private elapsedSeconds = 0;
  private lastSerialized?: string;
  private world?: EcsWorld;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly worldSeed: string,
    private readonly beacons: PoiBeaconState,
    private readonly intervalSeconds = 1,
    private readonly getPlayerHeading: () => number = () => 0,
  ) {}

  fixedUpdate(world: EcsWorld, deltaSeconds: number): void {
    this.world = world;
    this.elapsedSeconds += deltaSeconds;
    if (this.elapsedSeconds < this.intervalSeconds) return;
    this.elapsedSeconds = 0;
    this.flush();
  }

  flush(): void {
    if (!this.world) return;
    const playerHeading = this.getPlayerHeading();
    if (!isFiniteNumber(playerHeading)) return;
    const state = snapshotGameState(this.world, this.worldSeed, playerHeading, this.beacons);
    if (!state) return;
    const serialized = JSON.stringify(state);
    if (serialized === this.lastSerialized) return;
    try {
      this.storage.setItem(GAME_STATE_STORAGE_KEY, serialized);
      this.lastSerialized = serialized;
    } catch {
      // Storage can be denied or full; persistence must never stop gameplay.
    }
  }

  dispose(): void { this.flush(); }
}
