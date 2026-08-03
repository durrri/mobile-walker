# River and Night milestone — R5b object placement

## Status and roadmap

R5a world-river bridges and R5b vegetation/general-object exclusion are complete. R5c is next and owns river-dependent POIs and navigation. R5d then migrates gameplay water classification, movement, safe-position consumers, and removes the remaining legacy river where it is no longer needed. Procedural macro paths, secondary meanders, variable width, connected/standalone lakes, swimming, and day/night remain out of scope.

## Authoritative environmental bands

`sampleWorldRiverEnvironment(x, z)` is a pure world-space query backed by the indexed parametric spine and the shared carving configuration. Boundaries are inclusive on their inner band:

| Centreline distance | Zone | Ordinary-object rule |
| --- | --- | --- |
| `0 .. 2.0` (`waterHalfWidth`) | water | no ordinary objects |
| `2.0 .. 2.2` (`waterHalfWidth + shoreTransitionWidth`) | shore transition/lip | mostly clear |
| `2.2 .. 3.25` (`waterHalfWidth + bankWidth`) | walkable bank | small vegetation allowed |
| `3.25 .. 5.5` (`+ falloffWidth`) | outer falloff | normal biome density, with no river thinning |
| beyond `5.5` | unaffected | normal biome behavior |

The sample also reports signed side, water-edge/lip/inner-bank distances, progress, and arc distance. Chunk generation creates one bounds query expanded for the maximum footprint and reuses its nearby segment set for terrain and all object candidates. Empty segment sets are the dry-chunk fast path. There is no Three.js, scene traversal, full-spine-per-candidate scan, or per-frame placement query. Detailed river debug already batches the water, lip, inner-bank, and falloff boundaries; POI detail mode batches bridge candidate/approach diagnostics. Rejected objects are removed from generated arrays, not hidden by presentation.

## Category policy and deterministic thinning

The central policy is composed after POI/structure and bridge exclusion and before existing biome/category acceptance:

* Pine and broadleaf trees, large shrubs/bushes, large rocks, and obstructive decorative props are rejected in water, shoreline, and walkable bank.
* Small rocks are rejected in water/shoreline and survive on the bank at a deterministic **22%** rate.
* Flowers/tiny vegetation are rejected in water, survive shoreline at a deterministic **10%** rate, and use ordinary density on the bank.
* Collectibles are rejected in water/shoreline and allowed on the bank because they are reachable, point-like pickups and do not block movement.
* Wetland pools are rejected in water/shoreline, preventing accidental river overlap; beyond the immediate shoreline their existing wetland behavior and standalone-lake behavior are unchanged.
* Every category delegates without any density modifier in outer falloff and outside influence. In particular, trees and large objects resume their exact ordinary biome policy immediately beyond the inner-bank end.

Thinning hashes normalized world seed, category salt, and stable candidate lattice identity. It never consumes a mutable random stream, so adding a category cannot perturb another category.

## Footprints and exclusion composition

Clearance is measured from the candidate's nearest radial footprint edge: trees **0.65 wu** (a modest trunk/lower-canopy convention, not full canopy), large rocks **0.55**, large shrubs **0.40**, decorative props **0.35**, collectibles **0.20**, small rocks **0.18**, and point flowers **0**. Pools supply their generated maximum ellipse radius (up to approximately **0.98 wu**) rather than the nominal category fallback of 0.70. The radial convention is symmetric on bends and arbitrary orientations and intentionally permits modest canopy overhang while preventing trunks and substantial geometry from reaching controlled shore.

The deterministic order is: candidate identity → existing POI/structure exclusion → bridge deck/clearance/approach exclusion → world-river footprint/category policy → existing lake, snow, terrain, biome and density rules → generated array. POI and bridge zones use the same pre-existing oriented zone predicate, so bridge approaches override flowers and collectibles that the general bank policy would otherwise allow.

## Audit and remaining legacy consumers

Active ordinary-object producers (`vegetation`, pine compatibility generation, collectibles, and wetland pools) no longer import or call `isRiverAt`, `isRiverColumn`, legacy chunk sections, or legacy width constants. The old river remains intentionally available for R5c/R5d consumers: POI river suitability/distance and lake-shore checks; gameplay terrain surface classification; legacy presentation records in `generateChunk`; and the biome debug column mask. Those consumers are not placement authority for ordinary objects.

## Density/performance record

R5b does not globally alter biome chances. The only count changes are candidate rejections/thinning inside water, shore, controlled bank, independent POI/bridge zones, and pool footprint overlap. Outer-falloff and dry chunks execute the identical pre-existing biome probability path. A three-run local Node generation sample (seed `r5b-report`, August 2026 development container) recorded:

| Chunk | Mean generation | Pine | Leaf | Bush | Flower | Collectible | Pool | Total objects |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| river lowland `(0,1)` | 234.25 ms | 11 | 8 | 28 | 89 | 2 | 0 | 138 |
| forested river `(1,2)` | 903.34 ms | 3 | 2 | 13 | 60 | 2 | 0 | 80 |
| dry `(8,8)` | 118.12 ms | 8 | 2 | 16 | 45 | 2 | 0 | 73 |

These are cold generation measurements dominated by existing terrain/POI work and are not a frame-rate benchmark; no runtime/frame placement pass was added. The current generators address 64 pine, 49 broadleaf, 100 bush, 400 flower, 2 collectible, and 36 possible pool lattice candidates per chunk before their existing biome/rarity filters. River rejection counts depend on how those stable candidates intersect each band; rejected records are intentionally not retained in normal output. The debug-only zone/policy tests exercise and count rejection classes without increasing streamed chunk payload. A pre-R5b object-count baseline was not captured in this branch, so no unsupported aggregate delta or FPS claim is made.
