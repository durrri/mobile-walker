# River and Night milestone — R5a world-river bridges

## Status and dependency order

R5a migrates bridge candidates, placement, structure geometry, collision, and bridge-owned approach/exclusion zones to the world-owned river. R5b (vegetation and general object river exclusion) is next, R5c migrates river-relative POIs and navigation, and R5d migrates gameplay water queries before removing the legacy river. **All active river consumers must migrate to the world-owned river before variable width, procedural meanders, secondary meanders, or river lakes are introduced.**

## Legacy audit

The retired bridge producer used `isRiverColumn`, one candidate per legacy chunk row, the chunk-local `sampleRiverCrossSection`, a north/south boundary assumption, and an east/west-like crossing derived from `centerX`. Candidate IDs and spacing restarted at chunk rows; only the `x = 0` column could own a bridge. It copied the legacy channel width plus `RIVER_BANK_WIDTH`/`RIVER_TRANSITION_WIDTH`, sampled natural rather than authoritative carved terrain, and generation gathered only north/south owners. Its oriented POI footprints already supplied deck/approach exclusion, while the shared structure definition supplied deck, rail, support and foundation collision. Rendering already rotated a common local component group, although that rotation had only been exercised near the fixed orientation. POI solid zones were checked after POIs were generated, establishing the remaining POI-before-bridge ordering.

Active legacy records are deliberately retained for R5b vegetation/object exclusion, R5c POIs/navigation, and R5d gameplay water classification and movement. Legacy water and bridge rendering are disabled; bridge generation has no import from `river.ts`, `isRiverColumn`, or the legacy cross-section.

## World-river bridge rules

* **Candidate lattice:** one candidate every 40 world units of global arc length with a deterministic seed phase. Identity is `bridge:<seed hex>:d<global lattice index>`. Spatial queries use the river segment index and bounded distance indices; the lattice never restarts per chunk.
* **Frame:** tangent points along increasing river distance. The deterministic left normal `(-tangent.z, tangent.x)` is both the bridge longitudinal axis and the left-bank direction. Meshes, collision, landings, debug guides, shadows, and oriented zones share it.
* **Span:** `2 × (water half-width + complete authoritative bank width + 0.75 landing/foundation margin)`. It is currently constant but the candidate stores local water half-width and bank extent for a future width provider.
* **Elevation:** authoritative terrain is sampled at both bank landings and beyond both approaches. Deck top is the higher landing (or water plus clearance) plus 0.18. Foundations and ramps share these sampled landing heights. This prevents burial and water intersection; unusually mismatched terrain is rejected rather than floated.
* **Suitability:** candidates within 18 units of endpoints, with more than 0.32 radians of frame change over the crossing corridor, landing difference over 1.35, approach slope over 0.22, or unstable banks are deterministically rejected. Seeded rarity and existing solid-POI overlap remain deterministic diagnostics. The river is never modified.
* **Ownership:** the centre's `worldToChunk` result is the sole owner. A 3 × 3 owner-neighbourhood query exposes exact definitions and zones to intersecting chunks without duplicating rendering or collision records.
* **Exclusion:** rotated rectangles cover the deck/structure clearance and short left/right landing approaches. Their exact oriented footprints are authoritative; collision bounds remain rotated broad-phase AABBs.

## Debug and performance

Detailed POI debug mode lazily creates disposable line geometry for candidate tangents, bridge axes, bank landings, and approaches. Candidate records additionally expose arc distance/progress, local width, landing/deck heights, curvature, bounds, owner, acceptance and rejection reason. Debug objects remain presentation-only and are absent from normal generated output.

Candidate lookup is bounded by the spatial river index. It does not traverse the scene, regenerate per frame, or scan the complete spine per chunk. Existing shared bridge materials and one component group per accepted bridge are unchanged, so R5a adds no draw calls, rendered components, or collision records per bridge; candidate records are transient except when debug data is requested. The fixture counts and timings are reported with validation results for this change.
