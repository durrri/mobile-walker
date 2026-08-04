# River R7/R8 generation architecture

## R7 macro route

Generation version 8 uses a bounded `[-96, 96] × [-128, 128]` corridor. The river enters the north
boundary at `(0, 128)` and exits the south boundary at `(0, -128)`; outside that finite domain the
existing spatial query simply reports no local segments. Equally spaced forward stations receive
random-access, seed-hashed lateral targets. A squared-sine endpoint envelope and two deterministic
relaxation passes retain broad direction changes while protecting endpoint headings. Monotonic station
progress prevents reversal, loops, and control-polygon intersections by construction. There are no unbounded retries. Control-segment lengths are checked against the configured minimum/maximum and sampled curvature is checked against `macroCurvatureLimit`; rejection deterministically selects a straight boundary-to-boundary station fallback and records both the rejected guard and fallback reason.

The presentation-neutral `RiverSpine` applies centripetal Catmull–Rom smoothing, builds an arc-length
lookup, and exposes immutable resampled points and a bounded spatial index. R7 remains available as
`worldRiverMacroSpine`; the authored R6 route remains `authoredR6RiverSpine`.

## Ownership and versioning

The immutable configuration owns the seed, generation version, corridor, segment/curvature guards,
resampling, and future meander ranges. Its complete serialized value (including explicit generation
mode) is the generation cache key. `resetWorldRiverGenerationCaches` is diagnostic-only. Production constructs a `WorldRiverOwner` from the actual game seed. The owner retains one generation result, macro spine and final spine for that session. Chunks carry the same cache-key identity; terrain, water meshes, bridges, POIs, object exclusion, gameplay safety and debug receive the owner's final spine. Two seeds cannot share an owner or a geometry-dependent cache entry. Module-level reference aliases remain test diagnostics, not production ownership.

## R8 meander layer

R8 first creates a seed-stable, inspectable set of regional activity belts separated by genuinely quiet
macro reaches. Each belt records its macro-distance interval, fade lengths, strength, gentle/strong
profile, wavelength, minimum target bend radius, and correction status. An optional suitability callback
and stable suitability ID provide a future biome hook without coupling the domain generator to biomes.

Inside a gentle belt, a dominant sine and 16% harmonic form broad S-curves. Strong belts use a separate
heading-controlled construction: a smooth local downstream reparameterization can briefly reverse
heading while a larger lateral curve makes a deep bend, then both offsets return with zero-slope fades.
`targetBendRadius` is profile intent metadata, not an acceptance guarantee. Acceptance is measured from the final one-unit resampling: sampled curvature must not exceed `curvatureGuard`, and the result reports `measuredMinimumBendRadius`. The permanent strong construction still exercises a 165-degree local heading reversal.
The configured 48–80 unit wavelengths remain well above constant river width. A bounded global
amplitude-reduction loop (75% per pass down to 2%) protects bounds, non-adjacent channel separation, and measured curvature deterministically. If reduction cannot satisfy a guard, the final layer falls back to the validated macro spine; `usedFallback` and immutable correction reasons report the actual path taken. Endpoint protection is independent of every regional fade.
Macro and final buffers are stored directly; production carving, water, placement, bridges, POIs,
navigation, and gameplay receive the final alias and never add local noise.

Detailed river debug renders the subdued grey R7 route, bright cyan R8 route, and at most 41 purple
displacement connectors only in active belts. Orange cross-lines mark belt boundaries. Layers toggle
independently and a compact metadata readout includes local strength/profile without exposing raw arrays.

For generation version 8's reference seed, the 262.45-unit macro contains two gentle belts totaling
111.13 units, no strong belt (strong belts are intentionally uncommon), and three quiet reaches of
47.88, 43.66, and 59.78 units (151.32 total). The
resulting final spine is 265.00 units. Other seeds vary belt lengths, strengths, profiles, and placement.

## Final performance validation

The final cache-cleared, seed-owned benchmark reports cold median/p95 milliseconds of dry
129.96/181.64, diagonal 362.44/574.24, canyon 385.98/446.54, bridge 372.74/417.69, and
POI-adjacent 358.59/420.01. Cached retained-data lookup remains effectively zero; gameplay queries
are 0.040 ms median and safe-position searches 8.634 ms median. The largest median stage is
208.01 ms (bridge terrain triangulation), approximately 3 ms above the historical 205 ms reference;
this bounded constrained-triangulation cost and the dry POI/bridge scan are the remaining measured
limitations. River-owner lookup and spine generation do not run per chunk after session creation.

R6 is complete. R7 procedural macro path and R8 secondary meanders are complete, followed by R9
variable width, R10 river-connected lakes, and R11 standalone-lake integration/final water rules.
