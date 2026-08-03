import { describe, expect, it } from "vitest";
import { generateChunk, type GeneratedChunkData } from "./generateChunk";
import type { ChunkCoordinate } from "./chunkCoordinates";

type Axis = "east-west" | "north-south";

function assertSharedEdge(
  first: GeneratedChunkData,
  second: GeneratedChunkData,
  axis: Axis,
): void {
  const side = first.terrainVerticesPerSide;
  expect(second.terrainVerticesPerSide).toBe(side);
  for (let index = 0; index < side; index += 1) {
    const firstIndex = axis === "east-west" ? index * side + side - 1 : (side - 1) * side + index;
    const secondIndex = axis === "east-west" ? index * side : index;
    expect(first.terrainHeights[firstIndex]).toBeCloseTo(second.terrainHeights[secondIndex]!, 12);
  }
}

function validatePair(firstCoordinate: ChunkCoordinate, secondCoordinate: ChunkCoordinate, axis: Axis): void {
  const seed = "explicit-r3-seams";
  const first = generateChunk(seed, firstCoordinate);
  const second = generateChunk(seed, secondCoordinate);
  assertSharedEdge(first, second, axis);

  const reversedSecond = generateChunk(seed, secondCoordinate);
  const reversedFirst = generateChunk(seed, firstCoordinate);
  assertSharedEdge(reversedFirst, reversedSecond, axis);
  expect(generateChunk(seed, firstCoordinate).terrainHeights).toEqual(first.terrainHeights);
}

describe("world river carved terrain seams", () => {
  it("matches independently generated edges for crossings, falloff, bends and dry terrain", () => {
    const cases: readonly [ChunkCoordinate, ChunkCoordinate, Axis][] = [
      [{ x: 2, z: 2 }, { x: 3, z: 2 }, "east-west"],
      [{ x: 1, z: -1 }, { x: 1, z: 0 }, "north-south"],
      // This horizontal edge is touched by the outer falloff but not the channel.
      [{ x: 0, z: -2 }, { x: 0, z: -1 }, "north-south"],
      [{ x: 10, z: 10 }, { x: 11, z: 10 }, "east-west"],
      // The authored reversal around (65, 36) is the fixture's strongest bend.
      [{ x: 3, z: 2 }, { x: 4, z: 2 }, "east-west"],
    ];
    for (const testCase of cases) validatePair(...testCase);
  }, 30_000);
});
