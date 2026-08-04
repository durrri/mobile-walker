import * as THREE from "three";

import type { RenderSystem } from "../ecs/System";
import type { Entity } from "../ecs/Entity";
import type { InputController } from "../player/InputController";
import { CHUNK_SIZE } from "../world/chunkCoordinates";
import { interpolateTransform } from "./interpolation";
import { sampleTerrainHeight } from "../world/terrainSampling";
import { conformBlobShadowToTerrain } from "../rendering/blobShadows";
import { blobShadowProjectionForCaster, type SunlightDirection } from "../rendering/sunlightDirection";
import {
  dampAngle, FOLLOW_BACKPEDAL_START_RADIANS, FOLLOW_DIRECTION_FILTER_RESPONSE,
  FOLLOW_FRONT_DEAD_ZONE_RADIANS,
  FOLLOW_MOVEMENT_DEAD_ZONE, FOLLOW_MOVEMENT_INTENT_DELAY_SECONDS, FOLLOW_RESPONSE_DAMPING,
  followMovementStrength, shapeFollowAngularError,
  normalizeAngle, shortestAngleDifference,
  type CameraOrientationMode, type FollowResponsiveness,
} from "./cameraOrientation";
export const PLAYER_SHADOW_EFFECTIVE_CASTER_HEIGHT = 0.82;

/** Runs after interpolation so fog follows the visible pose, never simulation or camera state. */
export class PlayerFogPresentationSystem implements RenderSystem {
  constructor(private readonly update: (x: number, z: number) => void) {}
  prepareRender(world: Parameters<RenderSystem["prepareRender"]>[0]): void {
    const player = world.entities.find((entity) => entity.playerControl && entity.renderable);
    if (player?.renderable) this.update(player.renderable.position.x, player.renderable.position.z);
  }
}

export class TransformInterpolationSystem implements RenderSystem {
  prepareRender(world: Parameters<RenderSystem["prepareRender"]>[0], interpolation: number): void {
    for (const entity of world.entities) {
      if (!entity.transform || !entity.previousTransform || !entity.renderable) continue;
      const pose = interpolateTransform(entity.previousTransform, entity.transform, interpolation);
      entity.renderable.position.set(pose.x, pose.y, pose.z);
      entity.renderable.rotation.y = pose.yaw;
    }
  }
}

export class PlayerShadowPresentationSystem implements RenderSystem {
  constructor(
    private readonly seed: number | string,
    private readonly shadow: THREE.Mesh,
    private readonly sunlight: Pick<SunlightDirection, "direction"> =
      { direction: new THREE.Vector3(-4, 8, 5).normalize() },
  ) {}

  prepareRender(world: Parameters<RenderSystem["prepareRender"]>[0]): void {
    const player = world.entities.find((entity) => entity.playerControl && entity.renderable);
    if (!player?.renderable) return;
    const { x, z } = player.renderable.position;
    const projection = blobShadowProjectionForCaster(this.sunlight.direction,PLAYER_SHADOW_EFFECTIVE_CASTER_HEIGHT,{fallbackAzimuth:this.shadow.rotation.y,maximumOffset:3.5});
    const offset = projection.offsetDistance;
    this.shadow.position.set(x + projection.directionX * offset, 0, z + projection.directionZ * offset);
    this.shadow.rotation.y = projection.rotationY;
    this.shadow.scale.set(0.58 * projection.stretch, 1, 0.43);
    conformBlobShadowToTerrain(
      this.shadow,
      (sampleX, sampleZ) => sampleTerrainHeight(this.seed, sampleX, sampleZ),
    );
  }
}

export class CameraPresentationSystem implements RenderSystem {
  static readonly defaultMovementYawDegrees = 10;
  private static readonly minimumElevation = THREE.MathUtils.degToRad(5);
  private static readonly defaultElevation = THREE.MathUtils.degToRad(22);
  private readonly desired = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly debugDirection = new THREE.Vector3();
  private zoom = 0.05;
  private tilt: number | undefined;
  private movementYaw = 0;
  private followHeading = 0;
  private filteredMovement = { x: 0, z: -1 };
  private directionalIntentDuration = 0;
  private intentHeading: number | undefined;
  private orientationMode: CameraOrientationMode = "north-locked";
  private followResponsiveness: FollowResponsiveness = "normal";
  private preserveYawForNextFrame = false;
  private movementYawStrength = THREE.MathUtils.degToRad(CameraPresentationSystem.defaultMovementYawDegrees);

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input?: Pick<InputController, "sampleCamera">,
    initialHeading = 0,
  ) {
    const heading = normalizeAngle(initialHeading);
    this.movementYaw = heading;
    this.followHeading = heading;
    this.filteredMovement = { x: Math.sin(heading), z: -Math.cos(heading) };
  }

  getDebugDetails(): { angleDegrees: number; zoomLevel: number; height: number } {
    const direction = this.camera.getWorldDirection(this.debugDirection);
    return {
      angleDegrees: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(-direction.y, -1, 1))),
      zoomLevel: this.zoom,
      height: this.camera.position.y,
    };
  }

  setMovementYawStrength(degrees: number): void {
    this.movementYawStrength = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(degrees, 0, 90));
  }

  setCameraOrientationMode(mode: CameraOrientationMode): void {
    if (mode === this.orientationMode) return;
    const effectiveYaw = this.orientationMode === "north-locked" ? this.movementYaw : this.followHeading;
    this.orientationMode = mode;
    this.movementYaw = effectiveYaw;
    this.followHeading = effectiveYaw;
    this.filteredMovement = { x: Math.sin(effectiveYaw), z: -Math.cos(effectiveYaw) };
    this.directionalIntentDuration = 0;
    this.intentHeading = undefined;
    this.preserveYawForNextFrame = true;
  }

  setFollowResponsiveness(responsiveness: FollowResponsiveness): void {
    this.followResponsiveness = responsiveness;
  }

  getEffectiveYaw(): number { return this.orientationMode === "north-locked" ? this.movementYaw : this.followHeading; }

  /** Current horizontal angle of the rendered camera view, including camera smoothing. */
  getFacingYaw(): number {
    const direction = this.camera.getWorldDirection(this.debugDirection);
    return normalizeAngle(Math.atan2(direction.x, -direction.z));
  }

  /** Yaw used to keep directional controls aligned with the current view. */
  getMovementReferenceYaw(): number { return this.orientationMode === "follow-movement" ? this.followHeading : 0; }

  private updateYaw(target: Entity, deltaSeconds: number): number {
    if (this.preserveYawForNextFrame) {
      this.preserveYawForNextFrame = false;
      return this.orientationMode === "north-locked" ? this.movementYaw : this.followHeading;
    }
    const movement = target.playerControl;
    if (this.orientationMode === "north-locked") {
      const targetYaw = (movement?.active ? movement.moveX : 0) * this.movementYawStrength;
      this.movementYaw = dampAngle(this.movementYaw, targetYaw, 8, deltaSeconds);
      return this.movementYaw;
    }
    const x = movement?.moveX ?? 0, z = movement?.moveZ ?? 0;
    const magnitude = Math.hypot(x, z);
    if (magnitude < FOLLOW_MOVEMENT_DEAD_ZONE) {
      this.directionalIntentDuration = 0;
      this.intentHeading = undefined;
      return this.followHeading;
    }
    const nx = x / magnitude, nz = z / magnitude;
    const observedHeading = Math.atan2(nx, -nz);
    if (this.intentHeading !== undefined
      && Math.abs(shortestAngleDifference(this.intentHeading, observedHeading)) > Math.PI / 4) {
      this.directionalIntentDuration = 0;
    }
    this.intentHeading = observedHeading;
    const filterAmount = deltaSeconds <= 0 ? 1 : 1 - Math.exp(-FOLLOW_DIRECTION_FILTER_RESPONSE * deltaSeconds);
    this.filteredMovement.x += (nx - this.filteredMovement.x) * filterAmount;
    this.filteredMovement.z += (nz - this.filteredMovement.z) * filterAmount;
    const filteredLength = Math.hypot(this.filteredMovement.x, this.filteredMovement.z);
    if (filteredLength < 1e-6) return this.followHeading;
    this.filteredMovement.x /= filteredLength;
    this.filteredMovement.z /= filteredLength;
    const desiredHeading = Math.atan2(this.filteredMovement.x, -this.filteredMovement.z);
    const rawDifference = shortestAngleDifference(this.followHeading, desiredHeading);
    const absoluteDifference = Math.abs(rawDifference);
    if (absoluteDifference >= FOLLOW_BACKPEDAL_START_RADIANS) {
      // Backward input remains camera-relative, but cannot bank intent for a
      // delayed turn when the stick leaves this stable backpedal sector.
      this.directionalIntentDuration = 0;
      this.intentHeading = undefined;
      return this.followHeading;
    }
    if (absoluteDifference <= FOLLOW_FRONT_DEAD_ZONE_RADIANS) {
      this.directionalIntentDuration = Math.max(0, this.directionalIntentDuration - deltaSeconds * 2);
      return this.followHeading;
    }
    this.directionalIntentDuration += Math.max(0, deltaSeconds);
    if (this.directionalIntentDuration < FOLLOW_MOVEMENT_INTENT_DELAY_SECONDS) return this.followHeading;
    // Player movement preserves analog input magnitude, so use that same drag
    // distance to make a short joystick drag turn the camera more gradually.
    // Start at zero beyond the movement dead zone so the first lateral input
    // does not introduce a sudden minimum camera rotation rate.
    const response = FOLLOW_RESPONSE_DAMPING[this.followResponsiveness]
      * followMovementStrength(magnitude);
    const shapedError = shapeFollowAngularError(absoluteDifference);
    const shapedTargetHeading = this.followHeading + Math.sign(rawDifference) * shapedError;
    this.followHeading = normalizeAngle(dampAngle(
      this.followHeading, shapedTargetHeading, response, deltaSeconds,
    ));
    return this.followHeading;
  }

  prepareRender(world: Parameters<RenderSystem["prepareRender"]>[0], _interpolation: number, deltaSeconds: number): void {
    const target = world.entities.find((entity) => entity.cameraTarget && entity.renderable);
    if (!target?.cameraTarget || !target.renderable) return;
    const cameraInput = this.input?.sampleCamera() ?? { zoomDelta: 0, tiltDelta: 0 };
    this.zoom = THREE.MathUtils.clamp(this.zoom + cameraInput.zoomDelta, 0, 1);
    const position = target.renderable.position;
    const baseLookY = position.y + 0.7;
    const baseRise = target.cameraTarget.height - 0.7;
    const baseDistance = Math.hypot(baseRise, target.cameraTarget.distance);
    const baseElevation = Math.atan2(baseRise, target.cameraTarget.distance);
    if (this.tilt === undefined) {
      this.tilt = CameraPresentationSystem.defaultElevation < baseElevation
        ? -(baseElevation - CameraPresentationSystem.defaultElevation)
          / (baseElevation - CameraPresentationSystem.minimumElevation)
        : (CameraPresentationSystem.defaultElevation - baseElevation)
          / (Math.PI / 2 - baseElevation);
    }
    this.tilt = THREE.MathUtils.clamp(this.tilt + cameraInput.tiltDelta, -1, 1);
    const halfFootprint = CHUNK_SIZE * 1.5;
    const verticalHalfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * this.camera.aspect);
    const framingDistance = Math.SQRT2 * halfFootprint
      / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov));
    const distance = THREE.MathUtils.lerp(baseDistance, framingDistance, this.zoom);
    const elevation = this.tilt < 0
      ? THREE.MathUtils.lerp(baseElevation, CameraPresentationSystem.minimumElevation, -this.tilt)
      : THREE.MathUtils.lerp(baseElevation, Math.PI / 2, this.tilt);
    const cameraYaw = normalizeAngle(this.updateYaw(target, deltaSeconds));
    const horizontalDistance = Math.cos(elevation) * distance;
    // The interpolated render position is continuous across chunk boundaries. In
    // particular, do not use the streaming neighborhood's quantized midpoint as
    // a look target: switching resident neighborhoods would make the view snap.
    this.lookAt.set(position.x, baseLookY, position.z);
    this.desired.set(
      this.lookAt.x - Math.sin(cameraYaw) * horizontalDistance,
      this.lookAt.y + Math.sin(elevation) * distance,
      this.lookAt.z + Math.cos(cameraYaw) * horizontalDistance,
    );
    const smoothing = 1 - Math.exp(-8 * deltaSeconds);
    this.camera.position.lerp(this.desired, deltaSeconds === 0 ? 1 : smoothing);
    this.camera.lookAt(this.lookAt);
  }
}
