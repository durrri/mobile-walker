import { describe, expect, it } from "vitest";
import { generateChunk, type GeneratedChunkData } from "./generateChunk";
import { RIVER_R6_FIXTURES } from "./riverR6Fixtures";
import { resetWorldGenerationCachesForDiagnostics } from "./worldGenerationDiagnostics";
import { tessellateWorldRiverWaterChunk, type WorldRiverWaterGeometry } from "./worldRiverWater";
import { DEFAULT_RIVER_GENERATION_CONFIG, getWorldRiverGeneration, validateSmoothedSpineSeparation } from "./worldRiverGeneration";

const seed = "r6-extended";
const key = (coordinate: { x: number; z: number }) => `${coordinate.x},${coordinate.z}`;
const independentOrder = (coordinates: readonly { x: number; z: number }[]) => {
  resetWorldGenerationCachesForDiagnostics();
  return new Map(coordinates.map(coordinate => [key(coordinate), structuredClone(generateChunk(seed, coordinate))]));
};

describe("R6 extended river validation", () => {
  it("keeps smoothed macro and final topology separated across representative seeds", () => {
    for(const worldSeed of [1,2,3,5,8,13,21,34,55,89,144,233]){
      const generated=getWorldRiverGeneration({...DEFAULT_RIVER_GENERATION_CONFIG,worldSeed});
      expect(validateSmoothedSpineSeparation(generated.macroSpine,generated.config).valid).toBe(true);
      expect(validateSmoothedSpineSeparation(generated.meanderedSpine,generated.config).valid).toBe(true);
    }
  });
  it("compares independently generated snapshots across representative orders", () => {
    const coordinates = [...new Map(RIVER_R6_FIXTURES.map(f => [key(f.chunk), f.chunk])).values()];
    const orders = [coordinates, [...coordinates].reverse(),
      coordinates.filter((_, i) => i % 2 === 0).concat(coordinates.filter((_, i) => i % 2 === 1))];
    const snapshots = orders.map(independentOrder);
    for (const snapshot of snapshots.slice(1)) expect(snapshot).toEqual(snapshots[0]);
  }, 120_000);

  it("keeps the formerly problematic strongest-bend mesh buffers byte-for-byte stable", () => {
    const coordinate = RIVER_R6_FIXTURES.find(f => f.name === "strongest-bend")!.chunk;
    const generateIndependent = () => {
      resetWorldGenerationCachesForDiagnostics();
      const mesh = generateChunk(seed, coordinate).terrainMesh;
      return { positions: new Uint8Array(mesh.positions.buffer.slice(0)), indices: new Uint8Array(mesh.indices.buffer.slice(0)) };
    };
    const baseline = generateIndependent();
    for (let repetition = 0; repetition < 5; repetition += 1) expect(generateIndependent()).toEqual(baseline);
  }, 120_000);

  it("reproduces canonical chunk and water data after independent cache-cleared regeneration", () => {
    const fixtures = RIVER_R6_FIXTURES.filter(f => ["strongest-bend", "bridge", "dry-far"].includes(f.name));
    const regenerate = (): Map<string, { chunk: GeneratedChunkData; water: WorldRiverWaterGeometry }> => {
      resetWorldGenerationCachesForDiagnostics();
      return new Map(fixtures.map(fixture => [fixture.name, {
        chunk: structuredClone(generateChunk(seed, fixture.chunk)),
        water: structuredClone(tessellateWorldRiverWaterChunk(fixture.chunk)),
      }]));
    };
    const baseline = regenerate();
    for (let cycle = 0; cycle < 5; cycle += 1) expect(regenerate()).toEqual(baseline);
  }, 120_000);
});
