# River milestone R5d — gameplay queries and legacy retirement

## Audit and migration

The R5d repository audit classified the remaining consumers as follows:

1. **Migrate now:** `terrainSampling` surface classification, player terrain-following tests, and restored-player safety. These now query the world-owned spine/carving/environment field.
2. **Delete:** `river.ts`, `isRiverColumn`, boundary/row spine generation, `sampleRiverCrossSection`, `isRiverAt`, legacy width/depth constants, generated `river` records, and the unused legacy ribbon/channel mesh builders.
3. **Historical/test-only:** fixed-column seam, cross-section, collision, and presentation tests were removed rather than moved because they protected retired behavior. The permanent import audit prevents their production return.
4. **Remain independently owned:** lake biome water/basin sampling and deterministic wetland pools. Neither is a river compatibility path.

No historical production module remains.

## Gameplay API and contract

`worldRiverGameplay.ts` is the presentation-neutral gameplay boundary. `sampleWorldRiverGameplay` returns the environment zone, water/channel/shore/bank booleans, signed water-edge distance, authoritative terrain height, water datum and depth, arc progress/distance, nearest point, tangent, and normal. `isInsideWorldRiverWater` is the cheap boolean boundary. Callers doing repeated local queries can create a bounded indexed `WorldRiverGameplayContext`; queries never traverse scenes, raycast rendered meshes, or regenerate geometry.

Water remains visual and classificatory only: the authoritative carved terrain is the collision/grounding surface, including below water. Entering water does not snap the player to the water datum and adds no swimming, current, drowning, stamina, or speed rule. Structure collision runs before terrain grounding. A reachable bridge deck remains the support surface; otherwise terrain is used, so the river below a deck and an available underpass remain independently classifiable.

Restored-position search rejects world-river water, standalone-lake water, wetland pool ellipses, and collision solids. Walkable banks and outer falloff are treated like ordinary terrain. The existing deterministic nearest-ring search, terrain grounding, yaw preservation, and bounded fallback remain unchanged. Structure decks are valid when the unified structure collision owner reports a walkable support; supports, railings, foundations, walls, and other solids take precedence when they overlap a walkable slab.

Restoration happens before `ChunkStreamingSystem` has populated its repository. The production entry point therefore creates a bounded canonical structure-safety query that deterministically generates and caches bridge and POI collision definitions by owner chunk. These are the same presentation-neutral definitions later stored in `GeneratedChunkRepository`; no scene object or rendered mesh is consulted. Once chunks stream, movement continues to consume those definitions through `queryStructureCollisions`. Integration tests compare pre-stream canonical classification with classification over the equivalent resident records.

## Performance

Both direct and bounded paths use the spine spatial index; there is no full-spine per-frame scan. Chunk generation continues to reuse one bounded context. Safety scans reuse deterministic wetland-pool cache entries and perform no rendering allocations. A local 10,000-query release-like Node/Vitest sampling run averaged under 0.03 ms per gameplay query; a worst-case default 5 m safe-position scan remains bounded to 390 candidates and measured under 4 ms after pool-cache warm-up. The rich sample returns small point/frame records; the boolean helper avoids the terrain sample and rich result allocation. No measurable runtime frame-time change is expected because locomotion currently needs authoritative terrain rather than a rich river sample.

## Permanent suite decisions

Permanent coverage is consolidated into parameterized representative straight, diagonal, near-horizontal, and bend reaches, direct/bounded agreement, terrain-versus-water grounding, safe restoration, structure collision, lakes/wetlands, seams/streaming, and a source-import audit. Legacy cross-section and fixed-column tests were deleted. Existing many-chunk seam, regeneration, streaming, and generation-order suites remain the extended validation; no new exhaustive default matrix was added.

## Roadmap

- R5a world-river bridges — complete.
- R5b vegetation and ordinary-object exclusion — complete.
- R5c POIs and navigation — complete.
- R5d gameplay queries and final legacy removal — complete when this change is accepted.
- R6 full seam, streaming, regeneration, and generation-order validation — next.

The governing rule remains: every active system uses the world-owned river before further river-shape complexity is introduced.
