# River R4 presentation

R4 makes the world-owned spine and the R3 carving cross-section authoritative for rendered river water. Water is a four-unit-wide ribbon at Y = -0.18; it is not a flood fill. Terrain remains the visible bank, so coarse, polygonal shoreline intersections are an accepted temporary limitation pending post-R4 visual inspection.

The water uses a one-world-unit global arc-length lattice. Each chunk queries the existing spine bounds index, generates the same global strip, and deterministically clips its triangles to the exact chunk rectangle. Boundary vertices and distance-based UVs are therefore identical regardless of streaming or generation order. A chunk owns one batched mesh, and its geometry follows normal chunk disposal; the material is shared by the mesh factory.

The legacy `river` record remains generated for bridges, collision/classification, vegetation exclusion, POIs, and other R5 consumers. Its old water ribbon and bank/channel meshes are no longer instantiated. Standalone lake and wetland presentation remains unchanged. Detailed river debug mode shows the mathematical channel/falloff edges, chunk grid, frames, and every global water lattice sample.

At one-unit spacing the approximately 300-unit authored fixture uses roughly 600 un-clipped strip vertices and 600 triangles globally. A typical active neighborhood has at most one batched water draw call per intersecting chunk and no per-frame rebuild. Exact clipping avoids transparent overlap and its memory is limited to the intersecting chunk fragments. Runtime frame-rate measurement and shoreline refinement remain visual follow-up work.
