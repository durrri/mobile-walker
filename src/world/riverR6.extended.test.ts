import { describe, expect, it } from "vitest";
import { generateChunk } from "./generateChunk";
import { RIVER_R6_FIXTURES } from "./riverR6Fixtures";
import { tessellateWorldRiverWaterChunk } from "./worldRiverWater";

const canonical = (coordinate: { x: number; z: number }) => generateChunk("r6-extended", coordinate);

describe("R6 extended river validation", () => {
  it("is independent across broad representative generation orders", () => {
    const coordinates = [...new Map(RIVER_R6_FIXTURES.map(f => [`${f.chunk.x},${f.chunk.z}`, f.chunk])).values()];
    const orders = [coordinates, [...coordinates].reverse(), coordinates.filter((_, i) => i % 2 === 0).concat(coordinates.filter((_, i) => i % 2 === 1))];
    const baseline = new Map(orders[0]!.map(c => [`${c.x},${c.z}`, canonical(c)]));
    for (const order of orders.slice(1)) for (const coordinate of order) {
      expect(canonical(coordinate)).toEqual(baseline.get(`${coordinate.x},${coordinate.z}`));
    }
  }, 120_000);

  it("reproduces generated and water data through repeated unload/reload equivalents", () => {
    const fixtures = RIVER_R6_FIXTURES.filter(f => ["strongest-bend", "bridge", "dry-far"].includes(f.name));
    const baseline = fixtures.map(f => ({ chunk: canonical(f.chunk), water: tessellateWorldRiverWaterChunk(f.chunk) }));
    for (let cycle = 0; cycle < 5; cycle += 1) fixtures.slice().reverse().forEach((fixture, index) => {
      expect(canonical(fixture.chunk)).toEqual(baseline[index === 0 ? 2 : index === 2 ? 0 : 1]!.chunk);
      expect(tessellateWorldRiverWaterChunk(fixture.chunk)).toEqual(baseline[index === 0 ? 2 : index === 2 ? 0 : 1]!.water);
    });
  }, 120_000);
});
