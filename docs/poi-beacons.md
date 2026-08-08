# POI beacon domain ownership (N5a)

Beacon facilities are deterministic world data. A generated POI's optional
`beacon` definition declares its semantic profile, supported `fire` and
`lantern` fixtures, and their structure-local-derived world anchors. It uses the
existing generated POI `id`; there is no second POI identity. Structure geometry
and beacon anchors share `poiLocalToWorld`, and the definition contains no
Three.js or player-mutated data.

`PoiBeaconState` is the single mutable gameplay owner. It stores only lit
fixtures, sparsely by generated POI ID, and exposes query, light, extinguish, and
validated set operations. Unsupported fixtures return `"unsupported"` and do
not create state. Fire and lantern are separate physical states: changing one
never changes the other. The store has no clock input, timers, or automatic
day/night behavior (the **no invisible caretaker** invariant).

Save schema version 3 persists sorted sparse beacon records in the authoritative
game-state document. Versions 1 and 2 migrate with no lit fixtures. Invalid
beacon records are discarded without invalidating otherwise sound player and
collection state, while the existing world-seed check prevents cross-world
state leakage. Resetting the game-state document therefore resets beacons too.

The store is created for the gameplay lifetime and is not attached to generated
chunks, meshes, render objects, or discovery. Chunk load/unload cannot change
it. No subscription mechanism is included: there is no renderer consumer yet,
and later presentation can query the small authoritative store when it already
processes a relevant POI without adding event churn or global scanning.
Rendering must remain a read-only consumer of the immutable definition and
mutable gameplay state. Discovery remains a separate future concern.

This foundation intentionally implements no fixture meshes, fire, smoke,
lighting, visibility distances, LOD, interaction UI, or time-driven visuals.
