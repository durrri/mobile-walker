import type { PlayerControlComponent, TransformComponent, VelocityComponent } from "../ecs/Entity";

export const PLAYER_SPEED = 4;
export const MAX_PLAYER_SPEED = 8;
export const MIN_MOVEMENT_SPEED_MULTIPLIER = 1;
export const MAX_MOVEMENT_SPEED_MULTIPLIER = MAX_PLAYER_SPEED / PLAYER_SPEED;
export const DEFAULT_MOVEMENT_SPEED_MULTIPLIER = 1;
export const JUMP_SPEED = 5.5;
export const GRAVITY = 14;

/** Keeps the player within the movement envelope covered by swept collision and terrain activation. */
export function constrainPlayerSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return PLAYER_SPEED;
  return Math.min(MAX_PLAYER_SPEED, Math.max(PLAYER_SPEED, speed));
}

export function normalizeMovementSpeedMultiplier(multiplier: number): number {
  if (!Number.isFinite(multiplier)) return DEFAULT_MOVEMENT_SPEED_MULTIPLIER;
  return Math.min(MAX_MOVEMENT_SPEED_MULTIPLIER, Math.max(
    MIN_MOVEMENT_SPEED_MULTIPLIER,
    Math.round(multiplier),
  ));
}

/** Treat malformed or out-of-range persisted values as an unset preference. */
export function restoreMovementSpeedMultiplier(value: string | null): number {
  const multiplier = Number(value);
  return Number.isInteger(multiplier)
    && multiplier >= MIN_MOVEMENT_SPEED_MULTIPLIER
    && multiplier <= MAX_MOVEMENT_SPEED_MULTIPLIER
    ? multiplier
    : DEFAULT_MOVEMENT_SPEED_MULTIPLIER;
}

export function playerSpeedForMultiplier(multiplier: number): number {
  return constrainPlayerSpeed(PLAYER_SPEED * normalizeMovementSpeedMultiplier(multiplier));
}

export function normalizeInput(x: number, z: number): { x: number; z: number } {
  const length = Math.hypot(x, z);
  if (length <= 1) return { x, z };
  return { x: x / length, z: z / length };
}

/** Pure movement boundary, suitable for unit tests without a DOM or Three.js. */
export function integrateMovement(
  transform: TransformComponent,
  control: PlayerControlComponent,
  velocity: VelocityComponent,
  deltaSeconds: number,
  speed = PLAYER_SPEED,
  grounded = true,
  terrainSpeedMultiplier = 1,
): TransformComponent {
  velocity.x = control.moveX * speed * terrainSpeedMultiplier;
  if (grounded) velocity.y = control.jump ? JUMP_SPEED : 0;
  velocity.y -= GRAVITY * deltaSeconds;
  velocity.z = control.moveZ * speed * terrainSpeedMultiplier;
  return {
    x: transform.x + velocity.x * deltaSeconds,
    y: transform.y + velocity.y * deltaSeconds,
    z: transform.z + velocity.z * deltaSeconds,
    yaw: control.active ? Math.atan2(control.moveX, control.moveZ) : transform.yaw,
  };
}
