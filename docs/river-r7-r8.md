# River R7/R8 generation architecture

## R7 macro route

Generation version 7 uses a bounded `[-96, 96] × [-128, 128]` corridor. The river enters the north
boundary at `(0, 128)` and exits the south boundary at `(0, -128)`; outside that finite domain the
existing spatial query simply reports no local segments. Equally spaced forward stations receive
random-access, seed-hashed lateral targets. A squared-sine endpoint envelope and two deterministic
relaxation passes retain broad direction changes while protecting endpoint headings. Monotonic station
progress prevents reversal, loops, and control-polygon intersections by construction. There are no
unbounded retries: validation has a straight station interpolation fallback.

The presentation-neutral `RiverSpine` applies centripetal Catmull–Rom smoothing, builds an arc-length
lookup, and exposes immutable resampled points and a bounded spatial index. R7 remains available as
`worldRiverMacroSpine`; the authored R6 route remains `authoredR6RiverSpine`.

## Ownership and versioning

The immutable configuration owns the seed, generation version, corridor, segment/curvature guards,
resampling, and future meander ranges. Its complete serialized value (including explicit generation
mode) is the generation cache key. `resetWorldRiverGenerationCaches` is diagnostic-only. Production
constructs one retained generation result and all consumers share its active spine.

## R8 meander layer

R8 first creates a seed-stable, inspectable set of regional activity belts separated by genuinely quiet
macro reaches. Each belt records its macro-distance interval, fade lengths, strength, gentle/strong
profile, wavelength, minimum target bend radius, and correction status. An optional suitability callback
and stable suitability ID provide a future biome hook without coupling the domain generator to biomes.

Inside a gentle belt, a dominant sine and 16% harmonic form broad S-curves. Strong belts use a separate
heading-controlled construction: a smooth local downstream reparameterization can briefly reverse
heading while a larger lateral curve makes a deep bend, then both offsets return with zero-slope fades.
The configured 48–80 unit wavelengths remain well above constant river width. A bounded global
amplitude-reduction loop (75% per pass, never below 25%) protects the corridor and non-adjacent channel
separation deterministically. Endpoint protection is independent of every regional fade.
Macro and final buffers are stored directly; production carving, water, placement, bridges, POIs,
navigation, and gameplay receive the final alias and never add local noise.

Detailed river debug renders the subdued grey R7 route, bright cyan R8 route, and at most 41 purple
displacement connectors only in active belts. Orange cross-lines mark belt boundaries. Layers toggle
independently and a compact metadata readout includes local strength/profile without exposing raw arrays.

For generation version 8's reference seed, the 262.45-unit macro contains two gentle belts totaling
111.13 units, no strong belt (strong belts are intentionally uncommon), and 151.32 quiet units. The
resulting final spine is 265.00 units. Other seeds vary belt lengths, strengths, profiles, and placement.

R6 is complete. R7 procedural macro path and R8 secondary meanders are complete, followed by R9
variable width, R10 river-connected lakes, and R11 standalone-lake integration/final water rules.
