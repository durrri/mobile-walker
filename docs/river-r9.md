# R9 deterministic variable river width

`WorldRiverOwner` now retains the single immutable full-water-width profile for its accepted final spine. The versioned flow is seed → macro spine → regional meanders → final spine → width profile → carving, water, terrain strips, placement relationships, gameplay, and bridges. Width lookup is linear interpolation on a global arc-length lattice and never depends on chunks or caches.

The target is the 4 wu base width multiplied by continuously blended `sampleBiome` weights (mountain .78, highlands .88, forest/lake 1, plains 1.15, wetland 1.30), a seeded aperiodic ±6.5% value-noise field, and measured final-spine bend response capped at +18%. Lake is intentionally transitional: lake basins remain separate logic and cannot inflate the channel. Long biome smoothing and the explicit 0.035 wu/wu gradient limit avoid steps and pulsing.

Safety generation measures non-local final-spine sample pairs once. Six deterministic symmetric correction passes enforce the pair half-width sum plus 2 wu dry neck, corrections are reduction-only feathered for 12 wu, and gradient limiting only reduces values so it cannot reopen an overlap. The profile reports targets, components, accepted values, and clamped count. Width configuration is immutable and included in owner identity; world generation is version 9 while persisted player-state schema is unchanged.

Banks use a bounded hybrid: the authoritative water half-width varies, while the 1.25 wu bank and 2.25 wu terrain falloff remain fixed. This preserves narrow-reach shoreline structure without making wide lowland falloffs excessive. Water mesh frames, terrain carving and strips, relationships/gameplay, and bridge bank anchors all sample the same profile. Debug remains presentation-only and lazy; the retained profile contains plain numeric diagnostics but no debug geometry.

R9 is symmetric. Strong bends receive modest measured-geometry widening, not outer-bank erosion or inner point bars. Width supplies a canyon-like regional signal in rugged biomes but does not add vertical canyon generation or hydrological guarantees.
