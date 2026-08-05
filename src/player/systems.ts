import type { FixedSystem } from "../ecs/System";
import { sampleTerrain } from "../world/terrainSampling";
import type { ActiveTerrainSurfaceHit } from "../world/activeTerrainSurface";
import { resolveTreeTrunkMovement } from "../world/treeCollision";
import { sampleWetlandSpeedMultiplier } from "../world/wetlands";
import type { InputController } from "./InputController";
import type { GeneratedChunkRepository } from "../world/GeneratedChunkRepository";
import { integrateMovement, normalizeInput } from "./movement";
import { queryStructureCollisions, resolveStructureMovement } from "../world/structureCollision";

/** Converts screen-aligned input into world-space movement for a camera yaw. */
export function rotateInputByCameraYaw(x: number, z: number, yaw: number): { x: number; z: number } {
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return {
    x: x * cosine - z * sine,
    z: x * sine + z * cosine,
  };
}

export class InputSnapshotSystem implements FixedSystem {
  constructor(
    private readonly input: Pick<InputController, "sample" | "dispose">,
    private readonly movementReferenceYaw: () => number = () => 0,
  ) {}
  fixedUpdate(world: Parameters<FixedSystem["fixedUpdate"]>[0]): void {
    const raw = this.input.sample();
    const normalized = normalizeInput(raw.x, raw.z);
    const movement = rotateInputByCameraYaw(normalized.x, normalized.z, this.movementReferenceYaw());
    for (const entity of world.entities) if (entity.playerControl) {
      entity.playerControl.moveX = movement.x;
      entity.playerControl.moveZ = movement.z;
      entity.playerControl.active = Math.hypot(movement.x, movement.z) > 0.01;
      entity.playerControl.jump = raw.jump;
    }
  }
  dispose(): void { this.input.dispose(); }
}

export class PlayerMovementSystem implements FixedSystem {
  constructor(private readonly seed?: number | string) {}

  fixedUpdate(world: Parameters<FixedSystem["fixedUpdate"]>[0], deltaSeconds: number): void {
    for (const entity of world.entities) {
      if (!entity.transform || !entity.previousTransform || !entity.playerControl || !entity.velocity) continue;
      Object.assign(entity.previousTransform, entity.transform);
      const speedMultiplier = this.seed === undefined
        ? 1
        : sampleWetlandSpeedMultiplier(this.seed, entity.transform.x, entity.transform.z);
      Object.assign(entity.transform, integrateMovement(
        entity.transform, entity.playerControl, entity.velocity, deltaSeconds, undefined, entity.jump?.grounded,
        speedMultiplier,
      ));
      if (entity.playerControl.jump && entity.jump?.grounded) entity.jump.grounded = false;
    }
  }
}

/** Blocks players at tree trunks while allowing movement beneath their crowns. */
export class TreeCollisionSystem implements FixedSystem {
  constructor(private readonly seed: number | string, private readonly chunks?: GeneratedChunkRepository) {}

  fixedUpdate(world: Parameters<FixedSystem["fixedUpdate"]>[0]): void {
    for (const entity of world.entities) {
      if (!entity.transform || !entity.previousTransform || !entity.playerControl) continue;
      if (entity.previousTransform.x === entity.transform.x
        && entity.previousTransform.z === entity.transform.z) continue;
      const resolved = resolveTreeTrunkMovement(this.seed, entity.previousTransform, entity.transform, undefined, this.chunks);
      if (entity.velocity) {
        if (resolved.x !== entity.transform.x) entity.velocity.x = 0;
        if (resolved.z !== entity.transform.z) entity.velocity.z = 0;
      }
      Object.assign(entity.transform, resolved);
    }
  }
}

/**
 * Resolves swept structure obstacles, then contextual floors and ceilings. Terrain
 * grounding follows this system, so an underlying bank remains available without
 * ever turning a deck into a globally sampled height column.
 */
export class StructureCollisionSystem implements FixedSystem {
  constructor(private readonly chunks: GeneratedChunkRepository) {}
  fixedUpdate(world: Parameters<FixedSystem["fixedUpdate"]>[0]): void {
    for (const entity of world.entities) {
      if (!entity.transform || !entity.previousTransform || !entity.terrainFollower) continue;
      const nearby = queryStructureCollisions(this.chunks, entity.previousTransform, entity.transform);
      if (!nearby.length) { if (entity.structureSupport) entity.structureSupport.surfaceId = undefined; continue; }
      const result = resolveStructureMovement(entity.previousTransform, entity.transform, nearby,
        entity.terrainFollower.heightOffset, entity.structureSupport?.surfaceId);
      Object.assign(entity.transform, result.transform);
      if (entity.structureSupport) entity.structureSupport.surfaceId = result.support?.id;
      if (result.support && entity.velocity?.y && entity.velocity.y < 0) entity.velocity.y = 0;
      if (result.support && entity.jump) entity.jump.grounded = true;
    }
  }
}

/** Grounds moving entities on the generated terrain, including river beds. */
export class TerrainSamplingSystem implements FixedSystem {
  constructor(private readonly seed: number | string, private readonly activeTerrain?: { queryActiveTerrainSurface(x: number, z: number): ActiveTerrainSurfaceHit | undefined }) {}

  fixedUpdate(world: Parameters<FixedSystem["fixedUpdate"]>[0]): void {
    for (const entity of world.entities) {
      if (!entity.transform || !entity.previousTransform || !entity.terrainFollower) continue;
      if (entity.structureSupport?.surfaceId) {
        if (entity.jump) entity.jump.grounded = true;
        continue;
      }
      let activeSample = this.activeTerrain?.queryActiveTerrainSurface(entity.transform.x, entity.transform.z);
      if (!activeSample && this.activeTerrain) {
        const restored = this.activeTerrain.queryActiveTerrainSurface(entity.previousTransform.x, entity.previousTransform.z);
        if (restored) {
          entity.transform.x = entity.previousTransform.x;
          entity.transform.z = entity.previousTransform.z;
          activeSample = restored;
        } else {
          if (entity.jump) entity.jump.grounded = false;
          continue;
        }
      }
      const sample = activeSample ?? sampleTerrain(this.seed, entity.transform.x, entity.transform.z);
      const groundY = sample.height + entity.terrainFollower.heightOffset;
      if (entity.transform.y <= groundY && (!entity.velocity || entity.velocity.y <= 0)) {
        entity.transform.y = groundY;
        if (entity.velocity) entity.velocity.y = 0;
        if (entity.jump) entity.jump.grounded = true;
      } else if (entity.jump) {
        entity.jump.grounded = false;
      }
    }
  }
}
