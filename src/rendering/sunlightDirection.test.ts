import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  BLOB_SHADOW_MAX_STRETCH,
  BLOB_SHADOW_MAX_OFFSET_SCALE,
  BLOB_SHADOW_MIN_STRETCH,
  blobShadowProjection,
  blobShadowProjectionForCaster,
  STATIC_SHADOW_GEOMETRY_ANGLE_THRESHOLD_DEGREES,
  StaticShadowGeometryRefreshPolicy,
  SunlightDirection,
} from "./sunlightDirection";

describe("directional blob-shadow projection", () => {
  it("reverses rotation and offset direction when horizontal sunlight reverses", () => {
    const first = blobShadowProjection(new THREE.Vector3(1, 1, -2));
    const reverse = blobShadowProjection(new THREE.Vector3(-1, 1, 2));

    expect(reverse.directionX).toBeCloseTo(-first.directionX);
    expect(reverse.directionZ).toBeCloseTo(-first.directionZ);
    expect(Math.abs(THREE.MathUtils.euclideanModulo(reverse.rotationY - first.rotationY, Math.PI * 2) - Math.PI))
      .toBeLessThan(1e-6);
  });

  it("lengthens toward the horizon without exceeding configured limits", () => {
    const high = blobShadowProjection(new THREE.Vector3(1, 8, 0));
    const low = blobShadowProjection(new THREE.Vector3(8, 1, 0));

    expect(low.stretch).toBeGreaterThan(high.stretch);
    expect(high.stretch).toBeGreaterThanOrEqual(BLOB_SHADOW_MIN_STRETCH);
    expect(low.stretch).toBeLessThanOrEqual(BLOB_SHADOW_MAX_STRETCH);
  });

  it("moves farther from its caster as the sun approaches the horizon", () => {
    const overhead = blobShadowProjection(new THREE.Vector3(0, 1, 0));
    const high = blobShadowProjection(new THREE.Vector3(1, 8, 0));
    const twentyTwoDegrees = blobShadowProjection(new THREE.Vector3(
      Math.cos(THREE.MathUtils.degToRad(22)),
      Math.sin(THREE.MathUtils.degToRad(22)),
      0,
    ));
    const fifteenDegrees = blobShadowProjection(new THREE.Vector3(
      Math.cos(THREE.MathUtils.degToRad(15)),
      Math.sin(THREE.MathUtils.degToRad(15)),
      0,
    ));
    const low = blobShadowProjection(new THREE.Vector3(
      Math.cos(THREE.MathUtils.degToRad(10)),
      Math.sin(THREE.MathUtils.degToRad(10)),
      0,
    ));

    expect(overhead.offsetScale).toBe(0);
    expect(twentyTwoDegrees.offsetScale).toBeCloseTo(1 / Math.tan(THREE.MathUtils.degToRad(22)));
    expect(fifteenDegrees.offsetScale).toBeGreaterThan(twentyTwoDegrees.offsetScale);
    expect(low.offsetScale).toBeGreaterThan(fifteenDegrees.offsetScale);
    expect(low.offsetScale).toBeLessThanOrEqual(BLOB_SHADOW_MAX_OFFSET_SCALE);
    expect(twentyTwoDegrees.offsetScale).toBeGreaterThan(high.offsetScale);
  });

  it("keeps a nearly overhead projection short, finite, and azimuth-stable", () => {
    const projection = blobShadowProjection(new THREE.Vector3(1e-12, 10, -1e-12), 0.73);

    expect(projection.stretch).toBeCloseTo(BLOB_SHADOW_MIN_STRETCH);
    expect(Object.values(projection).every(Number.isFinite)).toBe(true);
    expect(projection.rotationY).toBeCloseTo(0.73);
  });

  it("does not notify consumers repeatedly for an unchanged direction", () => {
    const sunlight = new SunlightDirection();
    const changed = vi.fn();
    sunlight.subscribe(changed);

    sunlight.set(new THREE.Vector3(-4, 8, 5));
    sunlight.set(new THREE.Vector3(-4, 8, 5));
    expect(changed).not.toHaveBeenCalled();
    sunlight.set(new THREE.Vector3(4, 8, -5));
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("publishes a bounded solar-shadow strength independently of direction", () => {
    const sunlight = new SunlightDirection();
    const changed = vi.fn();
    sunlight.subscribeSolarShadowStrength(changed);

    sunlight.setSolarShadowStrength(0);
    sunlight.setSolarShadowStrength(-1);
    sunlight.setSolarShadowStrength(2);

    expect(sunlight.solarShadowStrength).toBe(1);
    expect(changed).toHaveBeenCalledTimes(2);
  });
});

describe("static shadow geometry refresh policy", () => {
  const directionAt = (degrees: number) => new THREE.Vector3(
    Math.sin(THREE.MathUtils.degToRad(degrees)), Math.cos(THREE.MathUtils.degToRad(degrees)), 0,
  );

  it("only refreshes visible static shadows after the angular threshold", () => {
    const policy = new StaticShadowGeometryRefreshPolicy(directionAt(0), 1);

    expect(policy.shouldRefreshForDirection(directionAt(STATIC_SHADOW_GEOMETRY_ANGLE_THRESHOLD_DEGREES / 2))).toBe(false);
    expect(policy.shouldRefreshForDirection(directionAt(STATIC_SHADOW_GEOMETRY_ANGLE_THRESHOLD_DEGREES + 0.1))).toBe(true);
    expect(policy.shouldRefreshForDirection(directionAt(STATIC_SHADOW_GEOMETRY_ANGLE_THRESHOLD_DEGREES + 0.2))).toBe(false);
  });

  it("suppresses night movement and refreshes with the current direction at sunrise", () => {
    const policy = new StaticShadowGeometryRefreshPolicy(directionAt(0), 1);

    expect(policy.shouldRefreshForShadowStrength(0, directionAt(0))).toBe(false);
    expect(policy.shouldRefreshForDirection(directionAt(120))).toBe(false);
    expect(policy.shouldRefreshForDirection(directionAt(240))).toBe(false);
    expect(policy.shouldRefreshForShadowStrength(0.1, directionAt(240))).toBe(true);
    expect(policy.shouldRefreshForDirection(directionAt(240.1))).toBe(false);
  });
});

describe("caster blob projection",()=>{
  it("uses caster height and stays bounded from overhead to horizon",()=>{
    const high=blobShadowProjectionForCaster(new THREE.Vector3(1,20,0),.82,{maximumOffset:3.5});
    const low=blobShadowProjectionForCaster(new THREE.Vector3(20,1,0),.82,{maximumOffset:3.5});
    expect(low.offsetDistance).toBeGreaterThan(high.offsetDistance);
    expect(low.offsetDistance).toBeLessThanOrEqual(3.5);
    expect(blobShadowProjectionForCaster(new THREE.Vector3(0,1,0),.82).offsetDistance).toBe(0);
    expect(blobShadowProjectionForCaster(new THREE.Vector3(1,1,0),1.64).offsetDistance)
      .toBeCloseTo(blobShadowProjectionForCaster(new THREE.Vector3(1,1,0),.82).offsetDistance*2);
    const reverse=blobShadowProjectionForCaster(new THREE.Vector3(-20,1,0),.82);
    expect(reverse.directionX).toBe(-low.directionX);
    expect(Number.isFinite(low.offsetDistance)).toBe(true);
  });
});
