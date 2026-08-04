# River and Night milestone — R6 certification and stabilization

## Gate result and scope

R6 certifies the manually authored, constant-width world river as the hard baseline before its spine source changes. The automated gate covers dependency ownership, deterministic fixtures, terrain and water seams, generation order, cache/reload equivalence, streaming replacement and disposal, gameplay/terrain/water agreement, structure ownership, object exclusion, navigation, and safe restoration. R1–R5d remain intact. R7 (procedural macro path) is next; meanders, variable width, connected lakes, standalone-lake redesign, swimming/current, and night features remain out of scope.

## Active API and dependency certificate

| API | Intended consumers |
| --- | --- |
| `worldRiverSpine`, `RiverSpine` | bounded spatial queries, authored frames, debug cues |
| `createWorldRiverCarvingContext`, `sampleWorldRiverCarving`, `applyWorldRiverCarving` | terrain field and cross-section landmarks |
| `sampleTerrainHeight`, `sampleChannelTerrainHeightInContext` | generation, movement grounding, safe restoration, debug placement |
| `sampleWorldRiverWater`, `tessellateWorldRiverWaterChunk` | shared water footprint and rendered chunk ribbon |
| `createWorldRiverEnvironmentContext`, `sampleWorldRiverEnvironment` | vegetation, collectibles, pools, and zone policy |
| `createWorldRiverRelationshipContext`, `sampleWorldRiverRelationship` | POI hydrology and navigation relationships |
| `generateBridges`, `generatePois` | globally identified owner records and shared structure definitions |
| `createWorldRiverGameplayContext`, `sampleWorldRiverGameplay`, `isInsideWorldRiverWater` | movement, water classification, and safety scans |

The TypeScript-AST import audit rejects active production imports of a module named `river`, while a symbol audit rejects the retired fixed-column API. The legacy module and compatibility records are deleted. Consumers use plain world data: no authoritative rendered-mesh raycast or scene traversal exists. Standalone lakes continue through their separate lake APIs.

## Permanent authored fixtures

`riverR6Fixtures.ts` owns ten compact fixtures: near-straight north/south (progress 0.06), diagonal (0.22), near-horizontal (0.34), strongest bend (control point 4), canyon-like (0.73), bridge corridor (0.49), POI-adjacent corridor (0.82), dry far `(160,160)`, old column-zero dry `(1,160)`, and a river reach outside column zero (control point 4). These stable world-space/progress fixtures are the R7/R8 comparison baseline; labels describe representative validation corridors and do not promise an accepted structure in every seed.

## Certification evidence

* **Seams:** strict tests cover east/west and north/south shared terrain edges, bends, falloff, dry terrain, clipped water geometry, river strip constraints, winding, and corner/diagonal cases. Shared positions sample the same authoritative field. The constrained single terrain surface avoids overlapping coarse/refined surfaces and T-junctions.
* **Generation order:** pure `generateChunk(seed, coordinate)` output compares equal forward/reverse in the default suite. Extended validation resets every generation memo before each fixture-order, reverse-order, and alternating-distant-order run; it deep-clones each independently generated result before comparison. A focused strongest-bend assertion compares position and index buffer bytes across five independent cache-cleared generations.
* **Streaming/disposal:** semantic promise resolution and render-boundary calls prove residents remain until a replacement is ready. Replacement activation and retirement share a render boundary; cache reversal avoids regeneration. Geometry/debug disposal is exactly once, double-dispose is harmless, and resident/scene counts stabilize. Tests use no sleeps.
* **Regeneration/persistence:** five cache-cleared cycles independently regenerate and snapshot chunk data and water tessellation. Runtime repository/data-cache reuse remains a separate streaming lifecycle contract. Persistence safety tests reject water/solids, preserve supported walkable decks, and obtain restored Y from authoritative terrain or structure height. No Three.js object is serialized.
* **Cross-system consistency:** terrain vertices sample the movement field; gameplay grounding remains terrain rather than water surface; environment, gameplay, and rendered water use `WORLD_RIVER_CARVING.waterHalfWidth`; bridges/POIs render and collide from shared definitions and rotations; structural exclusions precede river object allowances. Ordinary objects are absent from water, shoreline clearing remains category-specific, small bank vegetation is allowed, and normal biome policy resumes at outer falloff.
* **Debug:** spine/ribbon/detail, terrain wireframe, bridge/POI candidate frames, navigation and biome river cues remain lazy, bounded, presentation-only, readable above sampled terrain, and disposable. Debug-data generation is opt-in and does not alter canonical generated data.

Rendered triangle interiors approximate the smooth authoritative height field. The accepted presentation/walkability tolerance remains **0.12 world units** for representative interiors; exact vertices and shared edges have strict agreement. This is a visual approximation, not permission to loosen seam or classification assertions.

## Suite consolidation

`npm test` is the permanent fast regression gate and explicitly excludes extended/performance diagnostics. Existing focused R1–R5d public-behavior tests were retained rather than duplicated. `riverR6Certification.test.ts` consolidates fixture identity and water/environment/gameplay/terrain agreement. The import audit was upgraded from regex import matching to TypeScript AST import inspection. No enduring public-behavior test was removed.

`npm run test:extended` owns broad independently generated fixture-order permutations, a byte-level strongest-bend regression, and five canonical-regeneration cycles. `npm run benchmark:river` owns timing and count diagnostics so normal CI has no fragile performance threshold. Future many-seed grids, long traversals, statistical placement, and memory stress belong in the extended suite.

## Performance baseline

The benchmark prints machine-readable `R6_BASELINE` JSON. Each fixture receives an untimed JIT/module warm-up, after which every one of **10** cold samples is preceded by `resetWorldGenerationCachesForDiagnostics()`. That supported reset clears POI generation/candidate/prominence, bridge generation, wetland-pool, river terrain-strip, and water-lattice memos. Runtime streaming's retained data cache is intentionally separate: cached lookup timings measure returning its already-generated plain object without invoking `generateChunk`.

Reference run (Node 22 container, 2026-08-04), median/p95 using nearest-rank `ceil(p*n)` and the mean of the middle pair for the median: dry **108.3 / 153.6 ms**, diagonal **361.0 / 454.2 ms**, canyon **332.7 / 381.4 ms**, bridge corridor **391.8 / 499.6 ms**, and POI-adjacent **269.0 / 298.3 ms** cold. Cached retained-data lookup was **0.000–0.001 ms median / 0.001–0.013 ms p95**. The corresponding meshes were 128, 1,222, 1,116, 1,240, and 443 triangles.

Diagnostic stage medians show the largest uninterrupted synchronous stage: dry POI/bridge work **75.0 ms**; diagonal terrain/carving/triangulation **204.9 ms**; canyon triangulation **171.9 ms**; bridge-corridor triangulation **197.9 ms**; and POI-adjacent triangulation **111.9 ms**. Mesh creation medians were **2.27, 4.02, 3.57, 2.52, and 2.15 ms** respectively. The hot gameplay query measured **0.052 / 0.060 ms** and safe search **5.02 / 6.19 ms**. Stage diagnostics are opt-in through the otherwise-unused `generateChunk` diagnostics callback.

Memory is explicitly a Node-process diagnostic, not game/GPU memory: heap started at **18.865 MiB**, ended at **94.073 MiB**, and changed by **+75.208 MiB** during this benchmark process. Timings and memory are comparison snapshots, not assertions; topology/count fields make the run auditable and no environment-sensitive unit threshold is imposed.

R6 exposed and fixed one real defect: `clean-pslg` deliberately uses a randomized internal sweep structure, so equal geometry could receive different point/triangle buffer ordering on a strong-bend chunk. Generation now canonicalizes point, constraint, and triangle ordering after cleaning. The extended order/reload test is the enduring regression.

## Accepted limitations and deferred debt

The authored spine and constant width are intentional. Banks can be broad/flat, the shoreline is stylized, and rendered triangles approximate the smooth field. There is no swimming/current gameplay or river-connected lake. Standalone lakes remain separate. Broader browser GPU draw-call profiling, long-duration heap instrumentation, exhaustive structure-near-seam fixtures, and automated screenshot comparison remain deferred diagnostics rather than correctness gaps.

## Manual post-merge inspection

1. Travel north and south along the river and cross several east/west and north/south seams.
2. Cross on foot; walk both banks; cross over and under bridges, including a diagonal bridge.
3. Inspect a river-adjacent POI and the vegetation transition through outer falloff.
4. Enable river detail and terrain wireframe, then disable them while streaming.
5. Reverse repeatedly across one boundary and make a long diagonal traversal.
6. Restore beside water and on a supported walkable deck; verify terrain/deck Y.
7. Inspect old column zero for retired-river artifacts and observe frame rate/generation pauses.
