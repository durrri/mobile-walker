# River R7/R8 generation architecture

## R7 macro route

Generation version 11 uses the finite `[-2000, 2000] × [-10000, 0]` world envelope. The 10,000-unit value is the boundary-to-boundary Z displacement, not an arc-length limit. A configured 260-unit internal margin reserves room for centripetal Catmull–Rom overshoot, R8 normal displacement, maximum channel width, and bank influence.

R7 begins with an immutable, inspectable, low-frequency **two-dimensional route plan**. Its named reaches own quiet downstream travel, southeast/southwest diagonals, and sustained eastward and westward near-horizontal traverses. Plan nodes and their small variations are random-access hashes of the normalized world seed, algorithm version, and explicit node/decision indices; there is no mutable PRNG stream and no chunk-order input. A seed-keyed mirror gives portfolio variation without removing either traverse direction.

The sparse behavior plan is joined with a centripetal Catmull–Rom guide and sampled by arc length into bounded world-space segments. That makes heading evolve gradually around broad decisions rather than independently jittering waypoints. Lateral reaches can spend substantial route length making little southward progress because later downstream reaches retain enough endpoint budget. The north and south endpoints are exact. The complete route is generated once by `WorldRiverOwner`, never per chunk.

Configuration now describes the implementation: `routeSegmentLength` controls guide sampling, `routeBoundaryMargin` protects the envelope, and `minSegmentLength`, `maxSegmentLength`, and `macroCurvatureLimit` are measured acceptance guards. The obsolete fixed-Z `macroWaypointSpacing` and X-only `lateralMacroVariation` settings were removed. Every geometry field remains in the serialized cache identity.

Acceptance checks finite endpoints/frames, control segment lengths, sampled curvature, bounds, self-intersection, and non-local separation on the smoothed curve. Separation uses a deterministic spatial grid rather than a global quadratic scan. Corrections and their reasons are retained. A validated straight boundary centreline remains the bounded emergency fallback, but representative normal routes are expected to publish without it.

## Ownership and versioning

The immutable configuration owns the seed, generation version, bounds, route-plan controls, geometry guards, resampling, and meander ranges. Its complete serialized value, including mode, is the cache key. Production constructs one `WorldRiverOwner` from the game seed and retains the route plan, macro spine, final spine, and width profile for the session. Chunks and all terrain, water, bridge, POI, collision, navigation, gameplay, and debug consumers receive the same final-spine identity. Cache resets are diagnostic only; streaming history, player/camera movement, and debug state cannot affect geometry.

`RiverSpine` retains centripetal Catmull–Rom smoothing, an arc-length lookup, and a bounded spatial index. Macro and final spines remain separate immutable products.

## R8 meander layer

R8 remains a separate local/regional normal-displacement layer. It does not create the macro traverses. A seed-stable activity plan places at most 18 smoothly faded 110–240-unit belts along the much longer route, leaving long quiet gaps. Strong regions remain uncommon. Wavelength and displacement are evaluated in the macro spine's local tangent/normal frame, so north–south, diagonal, and almost east–west reaches behave identically with respect to local geometry.

A bounded amplitude-reduction loop protects final bounds, non-local separation, and measured curvature. Final acceptance resamples the actual smoothed result, checks finite non-zero frames, and records correction/fallback state. Width, carving, bridge, and consumer code likewise use local spine frames rather than world-axis assumptions.

## Debug and performance

Debug remains lazy, presentation-only, bounded, and disposable. Its geometry is capped/decimated for the 10 km envelope. Metadata exposes macro/final lengths, macro X occupancy, retained reach/traverse counts, correction reasons, and fallback state in addition to local meander and width information.

Global topology and width safety work occur during one-time owner construction. Ordinary chunk and point queries use retained spatial indexes and bounded local contexts; global generation is never moved into chunk paths.
