# River R7/R8 generation architecture

## Finite envelope and ownership

Generation version 12 uses the finite world envelope `[-2000, 2000] × [-10000, 0]`. The 10,000 units are the north-to-south endpoint displacement, not an arc-length cap. `WorldRiverOwner` creates one immutable seed-owned generation product per session: retained route plan, macro spine, final R8 spine, and authoritative width profile. Chunk order, caches, camera/debug state, and player movement do not enter generation. Production consumers share that owner's final-spine identity.

The complete immutable generation configuration is serialized as cache identity. `routeSegmentLength` is the nominal world-space step of the macro control polygon. `routeBoundaryMargin` is both the planner steering boundary and reserved influence clearance; the default 260 units exceeds worst configured R8 displacement, maximum water half-width, bank/falloff influence, and numerical clearance. Segment, curvature, separation, endpoint-protection, R8, resampling, and suitability fields are likewise active and cache-keyed.

## Procedural R7 route plan and authoritative smoothing

R7 no longer uses fixed Z stations or a lightly perturbed anchor template. For each seed, keyed hashes of `(seed, algorithm version, reach index, local segment index, salt)` independently choose:

- a reach count of 8–11;
- each broad behavior and its direction;
- quiet-downstream headings;
- southeast/southwest diagonal headings;
- occasional eastward or westward near-horizontal headings;
- recovery and endpoint-approach reaches;
- bounded transition rates and reach durations.

No mutable random stream or retry loop is used. Behaviors are not compulsory per seed: composition, ordering, count, direction, duration, and heading vary. A bounded heading delta evolves the control polygon smoothly. Boundary recovery steers inward, while a deterministic smooth endpoint-budget correction distributes the remaining displacement across the route and reaches the exact south endpoint. A final deterministic lateral scale protects the configured internal margin without changing reach order.

The retained plan's `controlPoints` are the **sole authoritative macro control polygon**. `RiverSpine` applies centripetal Catmull–Rom exactly once. There is no guide-spine/resample/second-smoothing approximation. Arc-length lookup, frame sampling, and the spatial index all derive from that one macro spine.

## Meanders and enforced acceptance

R8 remains a separate sparse regional layer in macro arc-length space. It adds local tangent/normal displacement only inside seed-keyed faded belts; it does not create R7's broad lateral route. Long gaps remain untouched. The longer river uses at most 18 belts with 90–180-unit wavelength configuration and bounded long-route control density.

Macro acceptance measures control-segment length, one-unit sampled curvature, finite endpoints/frames, bounds, and smoothed non-local separation. Final acceptance restores the previous `0.12` curvature guard and one-world-unit separation sampling. Separation and intersection checks use deterministic bounded spatial cells rather than a quadratic global scan. Bounded amplitude correction records explicit reasons. If acceptance still fails, the validated boundary-to-boundary centreline remains the deterministic emergency fallback.

Route behavior labels and regional target bend radii are planning metadata, not guarantees. Published geometry is guaranteed only by measured final acceptance.

## Bounded consumers and performance

Water, width, carving, terrain strips, bridges, gameplay, collision, and debug operate in local tangent/normal frames. Terrain strip construction retains a global 0.5-unit lattice for seam identity, but a chunk now converts its bounded spine-index result into only the global frame intervals that can touch that chunk. The previous implementation rebuilt every offset over the complete 10 km frame array for every river chunk; that accidental full-spine work caused the reviewed multi-second constrained-chunk regression.

Debug remains lazy, capped, presentation-only, and disposable. Its readout includes macro/final length, X occupancy, route/traverse counts, corrections, fallback state, and width diagnostics.

## Measured behavior and limitations

The default seed has meaningful lateral occupancy, sustained diagonals, and a sustained near-horizontal reach; the finite route arc length is greater than 10,000. Portfolio tests, rather than a fixed template, establish eastward and westward traverse capability, quiet/downstream and diagonal runs, varied compositions, separation, and a low fallback rate. Exact measurements are versioned test/benchmark output rather than authored coordinates.

The planner deliberately favors safe, monotone-downstream topology; it can spend long distances nearly horizontal but does not currently create large upstream macro loops. Strong local reversals remain an uncommon R8 feature.
