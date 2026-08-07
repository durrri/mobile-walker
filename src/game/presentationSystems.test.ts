import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createEcsWorld } from "../ecs/createEcsWorld";
import { CHUNK_SIZE } from "../world/chunkCoordinates";
import { CameraPresentationSystem, PlayerShadowPresentationSystem } from "./presentationSystems";
import { dampAngle, normalizeAngle, shortestAngleDifference } from "./cameraOrientation";

function fixture(aspect = 16 / 9) {
  const camera = new THREE.PerspectiveCamera(60, aspect);
  const world = createEcsWorld();
  const renderable = new THREE.Group();
  renderable.position.set(2, 3, 4);
  world.add({ renderable, cameraTarget: { height: 4.5, distance: 6.5 }, playerControl: { moveX: 0, moveZ: 0, active: false, jump: false } });
  let input = { zoomDelta: 0, tiltDelta: 0 };
  const system = new CameraPresentationSystem(camera, {
    sampleCamera: () => { const value = input; input = { zoomDelta: 0, tiltDelta: 0 }; return value; },
  });
  return { camera, world, system, setInput: (zoomDelta: number, tiltDelta: number) => { input = { zoomDelta, tiltDelta }; } };
}

describe("CameraPresentationSystem", () => {
  it("starts from a restored player heading", () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9);
    const heading = Math.PI / 3;
    const system = new CameraPresentationSystem(camera, undefined, heading);

    expect(system.getEffectiveYaw()).toBeCloseTo(heading);
    system.setCameraOrientationMode("follow-movement");
    expect(system.getMovementReferenceYaw()).toBeCloseTo(heading);
  });

  describe("PlayerShadowPresentationSystem", () => {
    it("uses the current sunlight direction and shared solar-shadow strength every frame", () => {
      const world = createEcsWorld();
      const renderable = new THREE.Group();
      renderable.position.set(2, 0, 4);
      world.add({ renderable, playerControl: { moveX: 0, moveZ: 0, active: false, jump: false } });
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(1, 8),
        new THREE.MeshBasicMaterial({ transparent: true }),
      );
      const sunlight = { direction: new THREE.Vector3(0, 1, 0), solarShadowStrength: 1 };
      const system = new PlayerShadowPresentationSystem("player-shadow-test", shadow, sunlight);

      system.prepareRender(world);
      const overheadX = shadow.position.x;
      sunlight.direction.set(1, 1, 0).normalize();
      sunlight.solarShadowStrength = 0.25;
      system.prepareRender(world);

      expect(shadow.position.x).toBeLessThan(overheadX);
      expect((shadow.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.09);
    });
  });

  it("starts at the configured default angle and zoom and smooths subsequent changes", () => {
    const { camera, world, system, setInput } = fixture();
    system.prepareRender(world, 0, 0);
    expect(system.getDebugDetails().angleDegrees).toBeCloseTo(22);
    expect(system.getDebugDetails().zoomLevel).toBeCloseTo(0.05);
    const initialHeight = camera.position.y;
    setInput(1, 0);
    system.prepareRender(world, 0, 1 / 60);
    expect(camera.position.y).toBeGreaterThan(initialHeight);
    expect(camera.position.y).toBeLessThan(70);
  });

  it.each([16 / 9, 9 / 16])("frames the complete footprint at maximum zoom for aspect %s", (aspect) => {
    const { camera, world, system, setInput } = fixture(aspect);
    setInput(100, 0);
    system.prepareRender(world, 0, 0);
    const distance = camera.position.distanceTo(new THREE.Vector3(2, 3.7, 4));
    const limitingHalfFov = Math.min(THREE.MathUtils.degToRad(30), Math.atan(Math.tan(THREE.MathUtils.degToRad(30)) * aspect));
    expect(distance * Math.sin(limitingHalfFov)).toBeGreaterThanOrEqual(Math.SQRT2 * 24 - 1e-8);
    expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
  });

  it("clamps tilt between a near-eye-level view and a finite 90-degree overhead endpoint", () => {
    const { camera, world, system, setInput } = fixture();
    setInput(100, 100);
    system.prepareRender(world, 0, 0);
    expect(camera.position.x).toBeCloseTo(2);
    expect(camera.position.z).toBeCloseTo(4);
    expect(camera.position.y).toBeGreaterThan(3.7);
    expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
    expect(camera.quaternion.toArray().every(Number.isFinite)).toBe(true);

    setInput(-200, -200);
    system.prepareRender(world, 0, 0);
    const lookAt = new THREE.Vector3(2, 3.7, 4);
    const direction = camera.position.clone().sub(lookAt);
    expect(THREE.MathUtils.radToDeg(Math.atan2(direction.y, direction.z))).toBeCloseTo(5);
    expect(camera.position.y).toBeGreaterThan(lookAt.y);
    expect(camera.position.y).toBeLessThan(4.5);
    expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
  });

  it("does not snap when the resident neighborhood crosses a chunk boundary", () => {
    const { camera, world, system, setInput } = fixture();
    const target = world.entities.find((entity) => entity.cameraTarget && entity.renderable)!;
    const loadedCenter = () => ({
      x: (Math.floor(target.renderable!.position.x / CHUNK_SIZE) + 0.5) * CHUNK_SIZE,
      z: CHUNK_SIZE / 2,
    });

    setInput(1, 0);
    target.renderable!.position.x = CHUNK_SIZE - 0.01;
    system.prepareRender(world, 0, 0);
    const centerBefore = loadedCenter();
    const positionBefore = camera.position.clone();
    const directionBefore = camera.getWorldDirection(new THREE.Vector3());

    target.renderable!.position.x = CHUNK_SIZE + 0.01;
    const centerAfter = loadedCenter();
    system.prepareRender(world, 0, 1 / 60);
    const positionChange = camera.position.distanceTo(positionBefore);
    const directionChange = camera.getWorldDirection(new THREE.Vector3()).angleTo(directionBefore);

    expect(centerAfter.x - centerBefore.x).toBe(CHUNK_SIZE);
    expect(positionChange).toBeLessThan(CHUNK_SIZE / 4);
    expect(directionChange).toBeLessThan(0.1);
  });

  it("yaws toward sideways movement by the configured strength", () => {
    const { camera, world, system } = fixture();
    const target = world.entities.find((entity) => entity.cameraTarget)!;
    target.playerControl = { moveX: 1, moveZ: 0, active: true, jump: false };
    system.setMovementYawStrength(90);
    system.prepareRender(world, 0, 0);

    const direction = camera.getWorldDirection(new THREE.Vector3());
    expect(new THREE.Vector2(direction.x, direction.z).normalize().x).toBeCloseTo(1);
    expect(direction.z).toBeCloseTo(0);

    system.setMovementYawStrength(0);
    system.prepareRender(world, 0, 0);
    expect(camera.getWorldDirection(direction).x).toBeCloseTo(0);
    expect(direction.z).toBeCloseTo(-Math.cos(THREE.MathUtils.degToRad(22)));
  });

  it("returns smoothly to north after north-locked lateral movement stops", () => {
    const { world, system } = fixture();
    const target = world.entities.find((entity) => entity.cameraTarget)!;
    target.playerControl = { moveX: 1, moveZ: 0, active: true, jump: false };
    system.prepareRender(world, 0, 0);
    const turned = system.getEffectiveYaw();
    target.playerControl.active = false;
    system.prepareRender(world, 0, 1 / 60);
    expect(system.getEffectiveYaw()).toBeGreaterThan(0);
    expect(system.getEffectiveYaw()).toBeLessThan(turned);
  });

  it("follows sustained world-space movement but ignores short, weak, and stopped input", () => {
    const { world, system } = fixture();
    const target = world.entities.find((entity) => entity.cameraTarget)!;
    system.setCameraOrientationMode("follow-movement");
    system.prepareRender(world, 0, 1 / 60);
    target.playerControl = { moveX: 0.2, moveZ: 0, active: true, jump: false };
    for (let i = 0; i < 20; i++) system.prepareRender(world, 0, 1 / 60);
    expect(system.getEffectiveYaw()).toBeCloseTo(0);
    target.playerControl.moveX = 1;
    for (let i = 0; i < 7; i++) system.prepareRender(world, 0, 1 / 60);
    expect(Math.abs(system.getEffectiveYaw())).toBeLessThan(0.05);
    for (let i = 0; i < 40; i++) system.prepareRender(world, 0, 1 / 60);
    expect(system.getEffectiveYaw()).toBeGreaterThan(0.8);
    const stopped = system.getEffectiveYaw();
    target.playerControl.active = false;
    target.playerControl.moveX = target.playerControl.moveZ = 0;
    for (let i = 0; i < 30; i++) system.prepareRender(world, 0, 1 / 60);
    expect(system.getEffectiveYaw()).toBeCloseTo(stopped);
  });

  it("scales follow yaw speed with analog input distance", () => {
    const partial = fixture();
    const full = fixture();
    partial.system.setCameraOrientationMode("follow-movement");
    full.system.setCameraOrientationMode("follow-movement");
    const partialTarget = partial.world.entities.find((entity) => entity.cameraTarget)!;
    const fullTarget = full.world.entities.find((entity) => entity.cameraTarget)!;
    partialTarget.playerControl = { moveX: 0.5, moveZ: 0, active: true, jump: false };
    fullTarget.playerControl = { moveX: 1, moveZ: 0, active: true, jump: false };

    for (let i = 0; i < 30; i++) {
      partial.system.prepareRender(partial.world, 0, 1 / 60);
      full.system.prepareRender(full.world, 0, 1 / 60);
    }

    expect(partial.system.getEffectiveYaw()).toBeGreaterThan(0);
    expect(partial.system.getEffectiveYaw()).toBeLessThan(full.system.getEffectiveYaw());
  });

  it("applies the triangular angular demand after an identical completed intent delay", () => {
    const initialTurnFor = (degrees: number): number => {
      const { world, system } = fixture();
      const target = world.entities.find((entity) => entity.cameraTarget)!;
      system.setCameraOrientationMode("follow-movement");
      system.prepareRender(world, 0, 0); // Preserve mode-switch yaw.
      const heading = THREE.MathUtils.degToRad(degrees);
      target.playerControl = {
        moveX: Math.sin(heading), moveZ: -Math.cos(heading), active: true, jump: false,
      };
      system.prepareRender(world, 0, 0); // Adopt the direction without advancing intent time.
      for (let frame = 0; frame < 9; frame++) system.prepareRender(world, 0, 1 / 60);
      const before = system.getEffectiveYaw();
      system.prepareRender(world, 0, 1 / 60);
      return Math.abs(shortestAngleDifference(before, system.getEffectiveYaw()));
    };

    const frontDeadZone = initialTurnFor(7);
    const rising = initialTurnFor(45);
    const peak = initialTurnFor(90);
    const descending = initialTurnFor(140);
    const nearBackpedal = initialTurnFor(150);
    const backpedalBoundary = initialTurnFor(155);
    const backward = initialTurnFor(180);

    expect(frontDeadZone).toBeCloseTo(0);
    expect(rising).toBeGreaterThan(0);
    expect(rising).toBeLessThan(peak);
    expect(descending).toBeLessThan(peak);
    expect(nearBackpedal).toBeGreaterThan(0);
    expect(nearBackpedal).toBeLessThan(descending);
    expect(backpedalBoundary).toBeCloseTo(0);
    expect(backward).toBeCloseTo(0);
  });

  it.each([180, 160, -160])("keeps camera heading stable for %s-degree backpedaling", (degrees) => {
    const { world, system } = fixture();
    const target = world.entities.find((entity) => entity.cameraTarget)!;
    system.setCameraOrientationMode("follow-movement");
    system.prepareRender(world, 0, 0);
    const heading = THREE.MathUtils.degToRad(degrees);
    target.playerControl = {
      moveX: Math.sin(heading), moveZ: -Math.cos(heading), active: true, jump: false,
    };
    system.prepareRender(world, 0, 0);
    for (let i = 0; i < 30; i++) system.prepareRender(world, 0, 1 / 60);
    expect(system.getEffectiveYaw()).toBeCloseTo(0);
    expect(system.getMovementReferenceYaw()).toBeCloseTo(0);
    expect(target.playerControl.moveZ).toBeGreaterThan(0);
  });

  it("clears backpedal intent and applies a fresh delay before a slow rear turn", () => {
    const { world, system } = fixture();
    const target = world.entities.find((entity) => entity.cameraTarget)!;
    system.setCameraOrientationMode("follow-movement");
    system.prepareRender(world, 0, 0);
    const moveAt = (degrees: number) => {
      const heading = THREE.MathUtils.degToRad(degrees);
      target.playerControl = { moveX: Math.sin(heading), moveZ: -Math.cos(heading), active: true, jump: false };
    };

    moveAt(120);
    for (let i = 0; i < 8; i++) system.prepareRender(world, 0, 1 / 60);
    moveAt(180);
    system.prepareRender(world, 0, 0);
    for (let i = 0; i < 3; i++) system.prepareRender(world, 0, 1 / 60);
    const backpedalHeading = system.getEffectiveYaw();
    expect(backpedalHeading).toBeCloseTo(0);

    moveAt(150);
    system.prepareRender(world, 0, 0);
    for (let i = 0; i < 8; i++) system.prepareRender(world, 0, 1 / 60);
    expect(system.getEffectiveYaw()).toBeCloseTo(backpedalHeading);
    for (let i = 0; i < 2; i++) system.prepareRender(world, 0, 1 / 60);
    expect(system.getEffectiveYaw()).toBeGreaterThan(backpedalHeading);
  });

  it("preserves heading on mode changes, then smoothly returns north", () => {
    const { world, system } = fixture();
    const target = world.entities.find((entity) => entity.cameraTarget)!;
    target.playerControl = { moveX: 1, moveZ: 0, active: true, jump: false };
    system.prepareRender(world, 0, 0);
    const before = system.getEffectiveYaw();
    system.setCameraOrientationMode("follow-movement");
    system.prepareRender(world, 0, 1 / 60);
    expect(system.getEffectiveYaw()).toBeCloseTo(before);
    system.setCameraOrientationMode("north-locked");
    target.playerControl.active = false;
    system.prepareRender(world, 0, 1 / 60);
    expect(system.getEffectiveYaw()).toBeCloseTo(before);
    system.prepareRender(world, 0, 1 / 60);
    expect(Math.abs(system.getEffectiveYaw())).toBeLessThan(Math.abs(before));
  });

  it("exposes camera-relative input yaw only in movement mode", () => {
    const { world, system } = fixture();
    const target = world.entities.find((entity) => entity.cameraTarget)!;
    target.playerControl = { moveX: 1, moveZ: 0, active: true, jump: false };
    expect(system.getMovementReferenceYaw()).toBe(0);
    system.setCameraOrientationMode("follow-movement");
    for (let i = 0; i < 60; i++) system.prepareRender(world, 0, 1 / 60);
    expect(system.getMovementReferenceYaw()).toBeGreaterThan(0.8);
  });

  it("handles zero vectors and chunk crossings in follow mode without discontinuity or NaN", () => {
    const { camera, world, system } = fixture();
    const target = world.entities.find((entity) => entity.cameraTarget && entity.renderable)!;
    system.setCameraOrientationMode("follow-movement");
    target.playerControl = { moveX: Number.EPSILON, moveZ: 0, active: true, jump: false };
    target.renderable!.position.x = CHUNK_SIZE - 0.001;
    system.prepareRender(world, 0, 0);
    const before = camera.position.clone();
    target.renderable!.position.x = CHUNK_SIZE + 0.001;
    system.prepareRender(world, 0, 1 / 60);
    expect(camera.position.distanceTo(before)).toBeLessThan(1);
    expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
  });
});

describe("camera angle helpers", () => {
  it("interpolates across the angle boundary on the shortest path", () => {
    const from = Math.PI - 0.1, to = -Math.PI + 0.1;
    expect(shortestAngleDifference(from, to)).toBeCloseTo(0.2);
    expect(Math.abs(shortestAngleDifference(dampAngle(from, to, 5, 0.1), to))).toBeLessThan(0.2);
    expect(normalizeAngle(Number.NaN)).toBe(0);
  });
});
