import type { TransformComponent } from "../ecs/Entity";
import { isLakeAt, sampleTerrain } from "./terrainSampling";
import { overlapsGeneratedTreeTrunk } from "./treeCollision";
import { isInsideWorldRiverWater } from "./worldRiverGameplay";
import { worldToChunk } from "./chunkCoordinates";
import { generateWetlandPools } from "./wetlands";
import { createCanonicalStructureSafetyQuery } from "./structureCollision";

export const DEFAULT_PLAYER_SPAWN: TransformComponent = { x: 0, y: 0.76, z: 0, yaw: 0 };

export type PlayerTrunkOverlapQuery = (x: number, z: number, playerRadius: number) => boolean;
export type PlayerStructureSafetyQuery = (x: number, z: number, playerRadius: number) =>
  Readonly<{ kind: "walkable"; height: number } | { kind: "solid" }> | undefined;

function grounded(seed: number | string, transform: TransformComponent, heightOffset: number): TransformComponent {
  return { ...transform, y: sampleTerrain(seed, transform.x, transform.z).height + heightOffset };
}

function findNear(
  seed: number | string,
  origin: TransformComponent,
  heightOffset: number,
  collisionRadius: number,
  searchStep: number,
  maximumSearchRadius: number,
  overlapsTrunk: PlayerTrunkOverlapQuery,
  structureSafety?: PlayerStructureSafetyQuery,
): TransformComponent | undefined {
  const isUnsafe = (x: number, z: number): boolean => {
    const structure = structureSafety?.(x, z, collisionRadius);
    if (structure?.kind === "walkable") return false;
    if (structure?.kind === "solid" || overlapsTrunk(x, z, collisionRadius) || isInsideWorldRiverWater(x, z) || isLakeAt(seed, x, z)) return true;
    return generateWetlandPools(seed, worldToChunk(x, z)).some(pool => {
      const cosine = Math.cos(pool.rotation), sine = Math.sin(pool.rotation);
      const dx = x - pool.x, dz = z - pool.z;
      const u = dx * cosine + dz * sine, v = -dx * sine + dz * cosine;
      return (u / (pool.radiusX + collisionRadius)) ** 2 + (v / (pool.radiusZ + collisionRadius)) ** 2 <= 1;
    });
  };
  const groundCandidate = (transform: TransformComponent): TransformComponent => {
    const structure = structureSafety?.(transform.x, transform.z, collisionRadius);
    return structure?.kind === "walkable" ? { ...transform, y: structure.height + heightOffset }
      : grounded(seed, transform, heightOffset);
  };
  const initial = groundCandidate(origin);
  if (!isUnsafe(initial.x, initial.z)) return initial;

  // Start due east and proceed counter-clockwise for a stable candidate order.
  for (let radius = searchStep; radius <= maximumSearchRadius + Number.EPSILON; radius += searchStep) {
    const candidateCount = Math.max(1, Math.ceil(2 * Math.PI * radius / searchStep));
    for (let index = 0; index < candidateCount; index += 1) {
      const angle = index * 2 * Math.PI / candidateCount;
      const candidate = groundCandidate({
        x: origin.x + Math.cos(angle) * radius,
        y: origin.y,
        z: origin.z + Math.sin(angle) * radius,
        yaw: origin.yaw,
      });
      if (!isUnsafe(candidate.x, candidate.z)) return candidate;
    }
  }
  return undefined;
}

/** Grounds and, when necessary, deterministically relocates a restored player. */
export function findSafeRestoredTransform(
  seed: number | string,
  saved: TransformComponent,
  heightOffset: number,
  collisionRadius: number,
  searchStep = 0.5,
  maximumSearchRadius = 5,
  overlapsTrunk: PlayerTrunkOverlapQuery = (x, z, radius) =>
    overlapsGeneratedTreeTrunk(seed, x, z, radius),
  structureSafety?: PlayerStructureSafetyQuery,
): TransformComponent {
  if (!Number.isFinite(searchStep) || !Number.isFinite(maximumSearchRadius)
    || searchStep <= 0 || maximumSearchRadius < 0) {
    throw new RangeError("Safe-position search distances must be finite and non-negative.");
  }
  const restored = findNear(
    seed, saved, heightOffset, collisionRadius, searchStep, maximumSearchRadius, overlapsTrunk, structureSafety,
  );
  if (restored) return restored;

  // Validate the authored spawn with the same bounded search. It is known safe
  // for the production seed; its grounded form is the bounded final fallback.
  const fallback = { ...DEFAULT_PLAYER_SPAWN, yaw: saved.yaw };
  return findNear(
    seed, fallback, heightOffset, collisionRadius, searchStep, maximumSearchRadius, overlapsTrunk, structureSafety,
  )
    ?? grounded(seed, fallback, heightOffset);
}

/** Production restoration entry point. Canonical collision records are
 * available synchronously before the streaming repository is populated. */
export function findSafeRestoredTransformFromCanonicalWorld(
  seed:number|string,saved:TransformComponent,heightOffset:number,collisionRadius:number,
  searchStep=.5,maximumSearchRadius=5,
):TransformComponent {
  return findSafeRestoredTransform(seed,saved,heightOffset,collisionRadius,searchStep,maximumSearchRadius,
    undefined,createCanonicalStructureSafetyQuery(seed));
}
