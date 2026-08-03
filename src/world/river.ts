import { CHUNK_SIZE, type ChunkCoordinate } from "./chunkCoordinates";
import { hashFloat } from "./random";

export interface RiverBoundary {
  readonly edge: "north" | "south";
  /** World-space x coordinate, shared verbatim by the chunks touching this boundary. */
  readonly x: number;
  readonly width: number;
  /** World-space water elevation, shared by both chunks at this boundary. */
  readonly surfaceElevation: number;
}

export interface RiverPoint {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly surfaceElevation: number;
}

/** @deprecated Legacy gameplay river. worldRiverSpine is the future authority;
 * terrain and water migration is intentionally deferred to later milestones. */
export function isRiverColumn(coordinate: Pick<ChunkCoordinate, "x">): boolean {
  return coordinate.x === 0;
}

/**
 * Samples a boundary from its world-grid identity, not from either owning chunk.
 * Thus (x,z).south is exactly (x,z+1).north, including at negative coordinates.
 */
export function sampleRiverBoundary(seed: number, coordinate: ChunkCoordinate, edge: "north" | "south"): RiverBoundary {
  const boundaryZ = coordinate.z + (edge === "south" ? 1 : 0);
  const column = coordinate.x;
  const x = (column + 0.18 + hashFloat(seed, column, boundaryZ, 71) * 0.64) * CHUNK_SIZE;
  const width = 1.4 + hashFloat(seed, column, boundaryZ, 89) * 1.5;
  const surfaceElevation = -0.12 + hashFloat(seed, column, boundaryZ, 97) * 0.18;
  return { edge, x, width, surfaceElevation };
}

export function sampleRiverSpine(seed: number, coordinate: ChunkCoordinate, subdivisions = 5): readonly RiverPoint[] {
  const north = sampleRiverBoundary(seed, coordinate, "north");
  const south = sampleRiverBoundary(seed, coordinate, "south");
  const points: RiverPoint[] = [];
  for (let index = 0; index <= subdivisions; index += 1) {
    const t = index / subdivisions;
    const bend = index === 0 || index === subdivisions
      ? 0
      : (hashFloat(seed, coordinate.x, coordinate.z, index, 107) - 0.5) * 1.25;
    points.push({
      x: north.x + (south.x - north.x) * t + bend,
      z: (coordinate.z + t) * CHUNK_SIZE,
      width: north.width + (south.width - north.width) * t,
      surfaceElevation: north.surfaceElevation
        + (south.surfaceElevation - north.surfaceElevation) * t,
    });
  }
  return points;
}
