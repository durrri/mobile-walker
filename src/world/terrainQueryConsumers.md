# Terrain query consumer classification

The runtime ownership model is: world seed -> immutable world-generation context -> continuous procedural terrain/carving functions -> immutable generated chunk terrain mesh -> rendering and runtime terrain query consumers.

## A. Generation-time procedural query

These consumers create immutable world/chunk products and may keep using `sampleTerrainHeight`, `sampleNaturalTerrainHeight`, or river-carving context queries: chunk height-field and irregular-river vertices, terrain occlusion, POI terrain footprint analysis, lake-house dock landing placement, local prominence, vegetation/tree/collectible grounding, bridge/POI structure generation, wetland placement, tests that validate procedural generation, and diagnostics that inspect the design field.

## B. Runtime physical terrain query

Player terrain grounding and terrain collision now query the active chunk system through `queryActiveTerrainSurface(worldX, worldZ)`. The result comes from the activated chunk's immutable `terrainMesh.positions` and `terrainMesh.indices`, not from procedural sampling.

## C. Approximate world-scale query

Restored-position safety, exploration/presentation previews, biome/POI/river debug overlays, blob-shadow/building-shadow draping, and pre-generation navigation-style lookups may intentionally sample the procedural field when they operate before chunks are active or outside active chunks. These are approximate/design-field queries, not exact runtime terrain physics.

## D. Non-terrain walkable surface

Bridge decks, approaches, porches, floors, docks, foundations, ceilings, railings, trunks, and other explicit structure/tree collision records remain separate physical candidates. Structure support is resolved before terrain grounding so accessible non-terrain surfaces can override the terrain candidate without making terrain a height-column override.
