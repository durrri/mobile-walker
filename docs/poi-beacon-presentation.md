# POI beacon presentation (N5b)

N5a remains authoritative: `GeneratedPoi.beacon` supplies immutable semantics,
supported fixtures, the existing POI identity, and deterministic world anchors;
`PoiBeaconState` alone owns mutable fire and lantern state. N5b reads those two
sources when a generated chunk enters presentation lifetime. It does not infer a
lit state, persist one, or react to the clock.

## Presentation tiers and lifecycle

Each supported fixture gets a small nearby fixture mesh. A lit lantern adds a
warm, unlit-material-independent marker, so its signal does not require a real
light slot. A lit fire adds one low-poly flame and a fixed three-mesh smoke
plume. Unlit fires have neither flame nor smoke. The smoke shapes are bounded,
do not emit particles, and currently do not move or model weather. Shared
geometry and materials avoid per-frame allocation.

This N5b implementation is the near/full representation. A future distance-tier
system may substitute cheaper mid/far representations while consuming the same
`GeneratedPoi.beacon` and `PoiBeaconState` truth; neither the light manager nor
current chunk distance owns those future LOD decisions.

Chunk presentation activation queries the existing state and builds handles at
the definition's anchors. Retirement removes each handle and its light
candidate without touching gameplay state; reload reconstructs it. Duplicate
activation is idempotent. `refreshPoi` is the targeted bridge for a future
interaction/UI after it changes `PoiBeaconState`; there is no event bus or
world-wide scan.

## Real local lights

`BeaconLightManager` is the one owner of actual local lights. It retains a pool
of **four** shadow-free `PointLight`s (an initial iPhone-oriented tuning value,
not final product policy). Any number of active fixtures may remain visibly
lit, while only the best candidates occupy the pool. Candidates already carry
priority, range, and intensity, so allocation has no knowledge of cabin,
farmhouse, waterside, or watchtower types.

Ranking is deterministic using `distance - priority * 10 - retention credit`,
then stable POI identity plus fixture kind as the exact-score tie-break. The
small retained-selection distance credit prevents near-boundary churn.
Reconciliation occurs only after a
candidate change or at least 0.25 world units of camera motion; it does not
traverse the scene. Pool entries are repositioned/disabled and never allocated
per frame. These lights never cast shadows.

## Cost and assumptions

The incremental draw submissions are: lit lantern **2** (fixture + glow); lit
fire **5** (fixture + flame + three smoke puffs), of which the smoke plume is
**3**. Four active `PointLight`s add no geometry draw calls, though lighting
shader cost applies to illuminated objects. Per-frame beacon CPU work is one
camera-distance threshold check; sorting/updating runs only when candidates or
camera position meaningfully change. There is no post-processing bloom,
particle allocation, chunk generation in the render path, or global POI scan.

Environment time, direct solar light, `HemisphereLight`, night-brightness,
fog, and sky ownership are unchanged. Future visual weighting may consume the
existing environment presentation state, but this first pass adds none.

## Explicit non-goals

This infrastructure does not add interaction, fuel/resources, discovery,
quests, map/diary behavior, automatic evening ignition, moon/stars, weather or
wind, local-light shadows, production LOD, bloom, or rewards. N6 is responsible
for stronger structure-specific/tower beacon hierarchy and final tuning.
