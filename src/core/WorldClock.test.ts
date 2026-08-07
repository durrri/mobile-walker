import { describe, expect, it } from "vitest";

import { WorldClock } from "./WorldClock";
import {
  AUTHORED_SUNRISE_HOURS,
  AUTHORED_SUNSET_HOURS,
  deriveAuthoredDailySolarPhase,
  deriveEnvironmentTime,
} from "./environmentTime";

const clockOptions = { dayDurationSeconds: 120, initialDayPhase: 0.5, maximumNoonSolarElevationDegrees: 60 };

describe("WorldClock", () => {
  it("has identical state for identical initial configuration", () => {
    expect(new WorldClock(clockOptions).state).toEqual(new WorldClock(clockOptions).state);
  });

  it("advances deterministically and wraps at the configured day duration", () => {
    const clock = new WorldClock({ ...clockOptions, initialDayPhase: 0.9 });
    clock.advance(24);
    expect(clock.state.normalizedDayPhase).toBeCloseTo(0.1);
    expect(clock.state.timeOfDayHours).toBeCloseTo(2.4);
  });

  it("has equivalent state for equivalent elapsed time partitioned into reasonable deltas", () => {
    const oneStep = new WorldClock(clockOptions);
    const manySteps = new WorldClock(clockOptions);
    oneStep.advance(10);
    for (let index = 0; index < 100; index += 1) manySteps.advance(0.1);
    expect(manySteps.state.normalizedDayPhase).toBeCloseTo(oneStep.state.normalizedDayPhase, 12);
  });

  it("does not advance while paused and allows direct time scrubbing", () => {
    const clock = new WorldClock(clockOptions);
    clock.setPaused(true);
    clock.advance(30);
    expect(clock.state.normalizedDayPhase).toBeCloseTo(0.5);
    clock.setTimeOfDayHours(18);
    expect(clock.state).toMatchObject({ normalizedDayPhase: 0.75, timeOfDayHours: 18 });
  });
});

describe("environment time model", () => {
  it("uses the configured noon maximum elevation and derives azimuth only from time", () => {
    const noon = deriveEnvironmentTime(0.5, { maximumNoonSolarElevationDegrees: 67 });
    const sunrise = deriveEnvironmentTime(AUTHORED_SUNRISE_HOURS / 24, { maximumNoonSolarElevationDegrees: 67 });
    const sunset = deriveEnvironmentTime(AUTHORED_SUNSET_HOURS / 24, { maximumNoonSolarElevationDegrees: 67 });
    expect(noon.solarElevationDegrees).toBe(67);
    expect(noon.solarAzimuthDegrees).toBe(51);
    expect(sunrise.solarAzimuthDegrees).toBeGreaterThan(90);
    expect(sunrise.solarAzimuthDegrees).toBeLessThan(180);
    expect(sunset.solarAzimuthDegrees).toBeGreaterThan(180);
    expect(sunset.solarAzimuthDegrees).toBeLessThan(360);
  });

  it("is finite through the complete day and remains continuous at the wrap", () => {
    for (let phase = 0; phase <= 1; phase += 0.01) {
      const environment = deriveEnvironmentTime(phase, { maximumNoonSolarElevationDegrees: 51 });
      expect([
        environment.normalizedDayPhase, environment.timeOfDayHours, environment.visualDayPhase,
        environment.solarPhase, environment.solarAzimuthDegrees, environment.solarElevationDegrees,
        environment.maximumNoonSolarElevationDegrees,
      ].every(Number.isFinite)).toBe(true);
    }
    const before = deriveEnvironmentTime(1 - 1e-9, { maximumNoonSolarElevationDegrees: 51 });
    const after = deriveEnvironmentTime(0, { maximumNoonSolarElevationDegrees: 51 });
    expect(before.solarElevationDegrees).toBeCloseTo(after.solarElevationDegrees, 6);
    expect(before.solarAzimuthDegrees).toBeCloseTo(after.solarAzimuthDegrees, 5);
  });

  it("uses one deterministic authored phase mapping with extended evening daylight", () => {
    expect(deriveAuthoredDailySolarPhase(18)).toEqual(deriveAuthoredDailySolarPhase(18));
    expect(deriveAuthoredDailySolarPhase(6.25).phase).toBe("sunrise");
    const evening = deriveEnvironmentTime(18 / 24, { maximumNoonSolarElevationDegrees: 51 });
    const sunset = deriveEnvironmentTime(AUTHORED_SUNSET_HOURS / 24, { maximumNoonSolarElevationDegrees: 51 });
    const beforeSunset = deriveEnvironmentTime((AUTHORED_SUNSET_HOURS - 0.01) / 24, { maximumNoonSolarElevationDegrees: 51 });

    expect(evening.solarElevationDegrees).toBeGreaterThan(0);
    expect(beforeSunset.solarElevationDegrees).toBeGreaterThan(0);
    expect(sunset.solarElevationDegrees).toBeCloseTo(0, 8);
    expect(deriveEnvironmentTime(12 / 24, { maximumNoonSolarElevationDegrees: 67 }).solarElevationDegrees).toBe(67);
  });

  it("keeps the authored solar direction continuous and time-derived across sunrise, sunset, and midnight", () => {
    for (const hour of [AUTHORED_SUNRISE_HOURS, 12, AUTHORED_SUNSET_HOURS, 24]) {
      const before = deriveEnvironmentTime((hour - 1e-5) / 24, { maximumNoonSolarElevationDegrees: 51 });
      const after = deriveEnvironmentTime((hour + 1e-5) / 24, { maximumNoonSolarElevationDegrees: 51 });
      expect(after.solarElevationDegrees).toBeCloseTo(before.solarElevationDegrees, 3);
      expect(after.solarAzimuthDegrees).toBeCloseTo(before.solarAzimuthDegrees, 2);
    }
  });
});
