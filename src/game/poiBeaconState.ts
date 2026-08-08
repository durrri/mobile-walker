import type { GeneratedPoi, PoiBeaconFixtureKind } from "../world/poi";

export interface PoiBeaconFixtureState {
  readonly fireLit: boolean;
  readonly lanternLit: boolean;
}

export interface PersistedPoiBeaconState {
  readonly poiId: string;
  readonly litFixtures: readonly PoiBeaconFixtureKind[];
}

export type PoiBeaconMutationResult = "changed" | "unchanged" | "unsupported";
const ALL_OFF: PoiBeaconFixtureState = Object.freeze({ fireLit: false, lanternLit: false });

/**
 * The sole mutable owner of POI signal state. It is sparse, independent of chunk
 * residency, and deliberately has no time or presentation input.
 */
export class PoiBeaconState {
  private readonly litByPoi = new Map<string, Set<PoiBeaconFixtureKind>>();

  constructor(initial: readonly PersistedPoiBeaconState[] = []) {
    for (const entry of initial) {
      const fixtures = new Set(entry.litFixtures);
      if (fixtures.size) this.litByPoi.set(entry.poiId, fixtures);
    }
  }

  getState(poiId: string): PoiBeaconFixtureState {
    const lit = this.litByPoi.get(poiId);
    if (!lit) return ALL_OFF;
    return Object.freeze({ fireLit: lit.has("fire"), lanternLit: lit.has("lantern") });
  }

  setFixture(poi: Pick<GeneratedPoi, "id" | "beacon">, fixture: PoiBeaconFixtureKind, lit: boolean): PoiBeaconMutationResult {
    if (!poi.beacon?.fixtures.some(definition => definition.kind === fixture)) return "unsupported";
    const current = this.litByPoi.get(poi.id);
    if ((current?.has(fixture) ?? false) === lit) return "unchanged";
    if (lit) {
      const next = current ?? new Set<PoiBeaconFixtureKind>();
      next.add(fixture);
      this.litByPoi.set(poi.id, next);
    } else {
      current?.delete(fixture);
      if (!current?.size) this.litByPoi.delete(poi.id);
    }
    return "changed";
  }

  light(poi: Pick<GeneratedPoi, "id" | "beacon">, fixture: PoiBeaconFixtureKind): PoiBeaconMutationResult {
    return this.setFixture(poi, fixture, true);
  }

  extinguish(poi: Pick<GeneratedPoi, "id" | "beacon">, fixture: PoiBeaconFixtureKind): PoiBeaconMutationResult {
    return this.setFixture(poi, fixture, false);
  }

  serialize(): readonly PersistedPoiBeaconState[] {
    return [...this.litByPoi.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([poiId, fixtures]) => ({
      poiId,
      litFixtures: (["fire", "lantern"] as const).filter(fixture => fixtures.has(fixture)),
    }));
  }
}
