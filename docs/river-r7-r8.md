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

R8 samples only R7 arc length and offsets along each local macro normal. A seeded dominant sine and a
22% harmonic form a smooth band-limited signal; smoothstep endpoint envelopes preserve entry/exit.
The configured 48–80 unit wavelengths remain well above constant river width. A bounded global
amplitude-reduction loop (75% per pass, never below 25%) protects the corridor deterministically.
Macro and final buffers are stored directly; production carving, water, placement, bridges, POIs,
navigation, and gameplay receive the final alias and never add local noise.

Detailed river debug renders the subdued grey R7 route, bright cyan R8 route, and at most 41 purple
displacement connectors. Layers toggle independently and a compact metadata readout avoids raw arrays.

R6 is complete. R7 procedural macro path and R8 secondary meanders are complete, followed by R9
variable width, R10 river-connected lakes, and R11 standalone-lake integration/final water rules.
