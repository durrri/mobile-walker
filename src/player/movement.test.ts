import { describe, expect, it } from "vitest";

import {
  DEFAULT_MOVEMENT_SPEED_MULTIPLIER,
  MAX_MOVEMENT_SPEED_MULTIPLIER,
  MAX_PLAYER_SPEED,
  PLAYER_SPEED,
  constrainPlayerSpeed,
  integrateMovement,
  normalizeInput,
  playerSpeedForMultiplier,
  restoreMovementSpeedMultiplier,
} from "./movement";

describe("normalizeInput", () => {
  it("normalizes diagonal input to unit magnitude", () => {
    const input = normalizeInput(1, 1);

    expect(Math.hypot(input.x, input.z)).toBeCloseTo(1);
    expect(input.x).toBeCloseTo(Math.SQRT1_2);
    expect(input.z).toBeCloseTo(Math.SQRT1_2);
  });

  it("preserves analog input below unit magnitude", () => {
    expect(normalizeInput(0.3, -0.4)).toEqual({ x: 0.3, z: -0.4 });
  });
});

describe("integrateMovement", () => {
  it("uses the default speed and composes terrain multipliers", () => {
    const velocity = { x: 0, y: 0, z: 0 };
    const result = integrateMovement(
      { x: 0, y: 1, z: 0, yaw: 0 },
      { moveX: 1, moveZ: 0, active: true, jump: false },
      velocity,
      1,
      playerSpeedForMultiplier(MAX_MOVEMENT_SPEED_MULTIPLIER),
      true,
      0.55,
    );

    expect(playerSpeedForMultiplier(DEFAULT_MOVEMENT_SPEED_MULTIPLIER)).toBe(PLAYER_SPEED);
    expect(playerSpeedForMultiplier(MAX_MOVEMENT_SPEED_MULTIPLIER)).toBe(MAX_PLAYER_SPEED);
    expect(result.x).toBeCloseTo(MAX_PLAYER_SPEED * 0.55);
  });

  it("restores only valid stored movement speed preferences", () => {
    expect(restoreMovementSpeedMultiplier(String(MAX_MOVEMENT_SPEED_MULTIPLIER))).toBe(MAX_MOVEMENT_SPEED_MULTIPLIER);
    for (const value of [null, "not-a-number", "1.5", "0", "3", "Infinity"]) {
      expect(restoreMovementSpeedMultiplier(value)).toBe(DEFAULT_MOVEMENT_SPEED_MULTIPLIER);
    }
  });

  it("keeps the movement-speed API finite and within collision-safe bounds", () => {
    expect(constrainPlayerSpeed(Number.NaN)).toBe(PLAYER_SPEED);
    expect(constrainPlayerSpeed(Number.POSITIVE_INFINITY)).toBe(PLAYER_SPEED);
    expect(constrainPlayerSpeed(-1)).toBe(PLAYER_SPEED);
    expect(constrainPlayerSpeed(MAX_PLAYER_SPEED * 2)).toBe(MAX_PLAYER_SPEED);
  });

  it("preserves yaw while input is inactive", () => {
    const velocity = { x: 9, y: 9, z: 9 };
    const result = integrateMovement(
      { x: 1, y: 2, z: 3, yaw: 1.25 },
      { moveX: 0, moveZ: 0, active: false, jump: false },
      velocity,
      0.5,
    );

    expect(result.yaw).toBe(1.25);
  });

  it("updates velocity from the current controls", () => {
    const velocity = { x: 0, y: 5, z: 0 };

    integrateMovement(
      { x: 0, y: 0, z: 0, yaw: 0 },
      { moveX: 0.25, moveZ: -0.5, active: true, jump: false },
      velocity,
      0.1,
      8,
    );

    expect(velocity).toEqual({ x: 2, y: -1.4000000000000001, z: -4 });
  });

  it("applies a terrain speed multiplier to horizontal movement only", () => {
    const velocity = { x: 0, y: 0, z: 0 };
    const result = integrateMovement(
      { x: 0, y: 2, z: 0, yaw: 0 },
      { moveX: 0.6, moveZ: 0.8, active: true, jump: false },
      velocity,
      1,
      4,
      true,
      0.5,
    );

    expect(result.x).toBeCloseTo(1.2);
    expect(result.z).toBeCloseTo(1.6);
    expect(velocity.y).toBe(-14);
  });

  it("moves the same distance over equal time at different frame rates", () => {
    const control = { moveX: 0.6, moveZ: 0.8, active: true, jump: false };
    const simulate = (steps: number) => {
      let transform = { x: 0, y: 2, z: 0, yaw: 0 };
      const velocity = { x: 0, y: 0, z: 0 };
      for (let step = 0; step < steps; step += 1) {
        transform = integrateMovement(transform, control, velocity, 1 / steps);
      }
      return transform;
    };

    const atThirtyFps = simulate(30);
    const atOneHundredTwentyFps = simulate(120);
    expect(atThirtyFps.x).toBeCloseTo(atOneHundredTwentyFps.x);
    expect(atThirtyFps.z).toBeCloseTo(atOneHundredTwentyFps.z);
    expect(Math.hypot(atThirtyFps.x, atThirtyFps.z)).toBeCloseTo(4);
  });

  it("launches a grounded player and applies gravity in the air", () => {
    const velocity = { x: 0, y: 0, z: 0 };
    const launched = integrateMovement(
      { x: 0, y: 1, z: 0, yaw: 0 },
      { moveX: 0, moveZ: 0, active: false, jump: true },
      velocity,
      0.1,
    );
    expect(launched.y).toBeGreaterThan(1);
    const upwardVelocity = velocity.y;

    integrateMovement(launched, { moveX: 0, moveZ: 0, active: false, jump: false }, velocity, 0.1, 4, false);
    expect(velocity.y).toBeLessThan(upwardVelocity);
  });
});
