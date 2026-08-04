import { worldToChunk, type ChunkCoordinate } from "./chunkCoordinates";
import { worldRiverSpine } from "./worldRiverSpine";

export type RiverR6FixtureKind = "reach" | "dry" | "legacy-column-dry";
export interface RiverR6Fixture {
  readonly name: string;
  readonly kind: RiverR6FixtureKind;
  readonly position: Readonly<{ x: number; z: number }>;
  readonly progress?: number;
  readonly chunk: ChunkCoordinate;
  readonly purpose: string;
}

const reach = (name: string, progress: number, purpose: string): RiverR6Fixture => {
  const position = worldRiverSpine.samplePosition(progress);
  return Object.freeze({ name, kind: "reach", progress, position: Object.freeze(position),
    chunk: Object.freeze(worldToChunk(position.x, position.z)), purpose });
};
const fixed = (name: string, kind: Exclude<RiverR6FixtureKind, "reach">, x: number, z: number, purpose: string): RiverR6Fixture =>
  Object.freeze({ name, kind, position: Object.freeze({ x, z }), chunk: Object.freeze(worldToChunk(x, z)), purpose });

/** Compact, stable authored baseline. Progress values intentionally describe shape, not implementation samples. */
export const RIVER_R6_FIXTURES: readonly RiverR6Fixture[] = Object.freeze([
  reach("north-south", 0.06, "near-straight northern reach"),
  reach("diagonal", 0.22, "diagonal crossing"),
  reach("near-horizontal", 0.34, "near-horizontal eastern reach"),
  reach("strongest-bend", worldRiverSpine.progressAtControlPoint(4), "strongest authored bend"),
  reach("canyon", 0.73, "high-terrain canyon-like reach"),
  reach("bridge", 0.49, "representative bridge candidate corridor"),
  reach("poi-adjacent", 0.82, "representative POI relationship corridor"),
  fixed("dry-far", "dry", 160, 160, "dry chunk far from river influence"),
  fixed("old-column-zero-dry", "legacy-column-dry", 1, 160, "old x=0 chunk column without river"),
  reach("outside-column-zero", worldRiverSpine.progressAtControlPoint(4), "river reach outside legacy x=0 column"),
]);
