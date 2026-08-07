# Mobile Walker

A mobile-first 3D web game foundation built with TypeScript, Vite, Three.js, and
Miniplex. It includes a small playable walking scene that demonstrates a
frame-rate-independent ECS simulation and interpolated Three.js presentation.

Play the published game at <https://durrri.github.io/mobile-walker/>.

## Getting started

```bash
npm ci
npm run dev
```

Use `npm install` when intentionally adding or updating dependencies, and
commit the resulting `package-lock.json` changes.

## Scripts

- `npm run dev` starts the Vite development server.
- `npm run build` type-checks the project and creates a root-based production build.
  It has the same output base as `npm run build:cloudflare`.
- `npm run build:cloudflare` creates the root-based (`/`) static build for
  Cloudflare production and preview deployments.
- `npm run build:pages` creates the GitHub Pages build with assets under
  `/mobile-walker/`.
- `npm run typecheck` runs TypeScript without emitting files.
- `npm test` runs the Vitest unit test suite once.
- `npm run preview` serves the production build locally.

## CI

Every pull request runs `npm ci`, `npm run typecheck`, and `npm run build:cloudflare`
through GitHub Actions.

## Architecture

- `src/core/` owns application lifecycle and the fixed-timestep game loop.
- `src/ecs/` owns entity types, the Miniplex world, and ordered systems.
- `src/rendering/` owns Three.js scene setup and viewport management.
- `src/player/` collects browser input and owns testable movement math and
  player simulation systems.
- `src/world/` owns pure seeded chunk generation and the presentation-only
  chunk streamer/mesh factory.
- `src/game/` composes the demo entities and presentation systems.

Player position, heading, and collected waypoints are restored from browser `localStorage`
when the same generated world is opened again. A versioned, world-seed-scoped
snapshot is saved once per second while playing and immediately when the page is
hidden or unloaded. Invalid or unavailable storage is ignored so it cannot block
the game from starting.

Simulation runs at a fixed 60 Hz. Browser events update raw input asynchronously;
the first fixed system captures and normalizes one snapshot, preventing render
refresh rate from changing movement speed. Systems are registered in this order:

1. **Fixed:** input snapshot.
2. **Fixed:** player movement (also saves the previous transform).
3. **Render:** stream the player's local chunk neighborhood.
4. **Render:** transform history interpolation.
5. **Render:** third-person camera presentation, using the interpolated target.

Simulation transforms, velocity, controls, bounds, and camera settings are plain
data. Three.js objects are attached only as a presentation bridge and are never
read by movement or collision systems. Pure `normalizeInput`, `integrateMovement`,
and `interpolateTransform` functions provide unit-testable math boundaries.

## Deterministic world generation

### River and Night Milestone

**Governing rule:** The river exists in world space. Chunks only query and render
the portion of the world they cover. R1 (world-space ownership) through R5d (final gameplay migration) are implemented.
The world spine drives authoritative terrain carving, water, banks, bridges,
vegetation, collectibles, wetland-pool exclusion, POI hydrology, navigation,
movement classification, and safe-position decisions. The fixed-column river
module and its generated compatibility records have been deleted.

The editable architectural fixture uses world-unit control points `(-24,96)`,
`(-8,70)`, `(20,48)`, `(48,38)`, `(65,36)`, `(45,12)`, `(12,-8)`, `(-25,-22)`,
`(-52,-45)`, `(-44,-72)`, and `(-12,-112)`. It is a standard non-uniform
centripetal Catmull–Rom chain, evaluated with Barry–Goldman interpolation using
square-root chord knots (`alpha=0.5`) and extrapolated endpoints, deliberately a full
2D `P(s)={x,z}` rather than `x=f(z)`, so horizontal reaches and arbitrary chunk
edge crossings remain representable. Normalized public progress follows the
prebuilt approximate arc-length table; the left normal is `(-tangent.z,
tangent.x)`. Nearest queries choose candidates from the reusable world-bounds
segment grid, project onto its polyline, then refine on the spline. Bounds queries
return ordered, potentially shared intervals and accept a margin. R5a world-river
bridges, R5b ordinary-object exclusion, and R5c POIs/navigation are complete.
R5d gameplay queries and final legacy removal are complete. R6 certification and
stabilization is complete when its gate is accepted; R7 procedural macro path is
next. All active river
consumers must use the world-owned river before procedural paths, secondary
meanders, variable width, or river lakes are introduced.

The debug selector is production-default Off. Spine adds controls/helpers and
the curve; Ribbon adds a constant-width, presentation-only ribbon and diagnostic
chunk grid; Detailed adds uniform-distance marks, tangent/normal indicators, and
index bounds. Debug vertices sample the authoritative carved terrain-height function
at their own world X/Z and add a small surface offset; ordinary depth testing
keeps hills and structures occluding them. Objects are created lazily and disposed
on every mode change. No debug view supplies gameplay classification or collision.

The milestone is: **R1–R5d complete**; **R6 certification and stabilization**;
**R7 procedural macro path** next; **R8 secondary meanders** after R7; **R9
variable width**; **R10 river-connected lakes**; and **R11 standalone-lake
integration and final water rules**.

`generateChunk(seed, coordinate)` is a pure data boundary: the normalized seed
and integer `(x, z)` coordinate completely determine its plain-object result.
Random-looking values are addressed by global integer lattice keys, rather than
drawn from mutable state, so generation order, entity iteration order, the clock,
and `Math.random()` cannot influence a chunk. Mathematical floor division keeps
world-to-chunk conversion correct on the negative side of the origin.

The single manually authored river is owned in world space and crosses arbitrary
chunk columns and edges. Chunks query indexed spine segments and render only the
terrain and water fragments within their bounds. Gameplay uses the same carved
terrain and water footprint, without fixed-axis assumptions or rendered-mesh
raycasts. Standalone lakes and wetland pools retain their independent hydrology.
The streamer generates plain chunk data first and passes it to a Three.js mesh
factory; geometries are disposed when chunks unload while shared materials live
for the streamer's lifetime.

### Rendering fog and material inventory

The camera draws up to 225 units away, independently of the scene's Three.js
linear `Fog`, which retains its pale-green background/color and 130/150 near/far
values. A small `onBeforeCompile` patch changes
only the standard fog distance: it is horizontal world-space X/Z distance from
the player's interpolated visible position. The visibility volume is therefore
a vertical cylinder. Camera yaw, tilt, zoom, height, and orbit position cannot
move the boundary; the usual Three.js `smoothstep` and fog-color blend remain.

The repository-wide material policy is deliberately explicit:

* Fog-aware world geometry uses `MeshStandardMaterial`: terrain, river channel
  and water, transparent wetland pools, instanced trunks/foliage/bushes/flowers,
  POI buildings, bridges, mushrooms, and the player. World-space blob shadows
  use transparent `MeshBasicMaterial` and receive the same patch. Alpha,
  transparency, depth, blending, and render order are otherwise untouched.
* Diagnostic chunk/POI/bridge lines and translucent candidate meshes use
  `LineBasicMaterial`/`MeshBasicMaterial` with `fog: false`. DOM HUD, biome and
  POI direction guides, settings, and debug panels have no Three.js material.
* There are currently no Lambert, Phong, Physical, Points, Sprite,
  `ShaderMaterial`, `RawShaderMaterial`, material subclasses, displaced,
  skinned, or morph-target world paths. Ordinary and transformed meshes plus
  `InstancedMesh` are supported; the patch derives X/Z after the standard
  transformed vertex and instance/batch matrices.

Future ordinary world materials must be registered once with
`ThreeRenderer.prepareWorldObject` when created or activated. This preserves
standard material shaders and shares one centre uniform across every material.
Intentional diagnostic/UI exceptions must set `fog: false`; a custom shader is
not implicitly supported and must explicitly implement the same shared
world-X/Z distance. Tests audit the patch, opt-out, cache key, shader chunk
contract, constants, shared uniform, and lifecycle so a new path cannot silently
fall back to camera-depth fog.

### POI generation and presentation

World generation is layered in a fixed order: terrain/elevation, biomes,
hydrology, POI selection, vegetation with POI exclusions, and rendering.
`src/world/poi.ts` owns plain-data POI definitions, globally addressed candidate
cells, suitability scoring, terrain-footprint analysis, stable IDs, ownership,
spacing, footprints, and exclusion zones. Definitions carry their placement
policy, so adding a landmark does not require changes to biome, hydrology,
vegetation, or chunk rendering code. Candidate randomness is hash-addressed by
seed and cell rather than consumed from mutable random state.

Bridges use a reusable **span-POI** model rather than masquerading as ordinary
point landmarks. Worker-side generation samples the river spine and channel
cross-section, derives a tangent and perpendicular crossing axis, places bank
anchors beyond the water and channel shoulders, samples bank and approach
terrain, and resolves rarity, spacing, stability, and building conflicts with a
stable global candidate identity. The crossing centre owns the bridge exactly
once, even when its deck, approaches, exclusion zones, or shadow cross a chunk
boundary. Optional connection slots preserve both approach anchors for future
paths and roads.

Bridge **archetype**, **span**, and **scale** are independent. River geometry
sets the anchor-to-anchor span; the pedestrian footbridge, heavy timber bridge,
or stone bridge definition sets materials, deck width, profile, variants,
clearance, rarity, and biome preferences; the generated scale records span,
width, and profile separately. Current variants are bare-plank, rope-railed and
low-railed footbridges; simple-beam, trestle and reinforced timber bridges; and
shallow-span, single-arch and hump-backed stone bridges. Every archetype's soft
span rules include the current channel, so forest, wetland, plains, and highland
context—not a width class—can produce different structures over the same river.
Future variable-width cross-sections can feed those existing soft suitability
rules and structural scale/support choices without changing ownership,
selection, approach, exclusion, or rendering contracts.

Generated POIs contain no Three.js state. `PoiMeshFactory` is a separate
presentation registry that converts those records into named disposable object
groups; `ChunkMeshFactory` only composes them into the owning chunk. A POI origin
has exactly one owning chunk even when its footprint crosses a boundary.
Neighboring generation contributes exclusion zones before trees, bushes,
flowers, and pools are placed, without altering biome or terrain data. Candidate,
rejection, footprint, stable-ID, and entrance information remains available as
plain debug data, with accepted-only and full-candidate visualization levels.

## Controls

- **Desktop:** move with <kbd>WASD</kbd> or the arrow keys and jump with
  <kbd>Space</kbd>.
- **Touch / pointer:** press anywhere on the scene and drag in the direction you
  want to walk. Release to stop. Drag distance controls the input strength until
  it reaches full speed. Tap, lift, then press again to jump; keep the second
  press held and drag to move while jumping.
- **Camera gestures:** pinch with two fingers to zoom, and drag two fingers
  vertically to tilt between the standard view and a directly overhead view.

### Camera orientation

The Camera settings offer a touch-friendly **North / Movement** segmented
control. **North** (the default) keeps north as the reference frame: east/west
motion temporarily applies the persisted Movement yaw strength, then the view
smoothly returns north. **Movement** follows sustained world-space desired
player motion after filtering and a short intent delay, preserves its last
heading when the player stops, and continuously reorients directional input to
the current view. This camera-relative scheme is the common third-person/mobile
standard: up/forward always means away from the camera, even after the camera
has turned during a long press. Its separate **Slow / Normal / Fast** segmented
control selects the persisted Follow responsiveness. Only the setting relevant
to the active mode is shown.

Movement mode uses a continuous triangular angular-error curve: it does not
rotate within 8 degrees of forward, increases turn demand linearly to its peak
at a side-facing 90-degree input, then decreases linearly toward backward.
From 155 through 180 degrees, input becomes stable backpedaling. In that sector,
the player can move backward-left or backward-right relative to the current
view without rotating the camera; moving outside it naturally starts a fresh,
delayed turn.

The curve's configurable control points are its 8-degree front dead-zone angle,
90-degree peak angle, 76.5-degree peak shaped-error value, and 155-degree
backpedal-start angle. There is intentionally no 45-degree shoulder point in
this initial curve. Responsiveness and joystick-distance strength scale the
shaped turn demand independently.

Both orientation mode and follow responsiveness are restored from browser
storage when their saved values are valid; unavailable or malformed storage
falls back to North and Normal. In Movement mode, raw stick, drag, and keyboard
input is converted from screen space to world space using the latest camera yaw
before `playerControl.moveX` / `moveZ` is updated. North mode retains its fixed
world axes. Camera orientation changes yaw only: zoom, elevation, smoothing,
interpolation, and chunk-boundary continuity are retained. Streaming-neighborhood
offsets remain independently user-configurable and are never rotated or
rewritten by the camera mode.

#### Available POI types

The registry currently provides four deliberately uncommon building discoveries:

- **Plains farmhouse** — requires a predominantly plains footprint, gentle and
  even dry terrain, and generous separation from every other POI. Its stable
  seeded rotation, fenced clearing, and explicit approach are generated data.
- **Lake house with dock** — uses global biome/lake sampling to find a dry
  shoreline, turns its entrance and view toward the water, and extends its dock
  to the fixed lake surface. River channels and submerged or steep house
  foundations are rejected; lake water continues to be rendered by the normal
  hydrology layer.
- **Small forest cabin** — prefers forest, but may occupy wetland only when its
  complete compact clearing is free of rivers, lakes, and ordinary wetland
  pools. It has no fence, uses a low forest foundation or short wetland stilts,
  and excludes ordinary vegetation from a small clearing.
- **Highland watchtower** — prefers locally prominent highland terrain, with
  suitable mountain foothills as a fallback. Multi-radius terrain-ring samples
  drive prominence scoring; a stable compact base, dedicated watchtower-to-
  watchtower spacing, and substantial building spacing preserve its tall,
  unfenced silhouette.

Future types are registered with `registerPoiDefinition` in the plain-data POI
registry. A definition supplies a unique type ID and label, clearly named rarity
and cross-type minimum spacing, footprint dimensions, biome/hydrology and
terrain rules, and a renderer key. Register the matching presentation callback
with `PoiMeshFactory.register`; terrain and biome generation must not contain
building meshes.

Every generated POI exposes named solid, clearing, entrance-approach, and (when
applicable) dock zones. Solid and vegetation-exclusion zones are collected from
neighboring chunks before trees, bushes, flowers, mushrooms/collectibles, and
pools are placed, so an exclusion remains continuous across a chunk boundary.
POIs may exclude or influence ordinary vegetation through these zones, but POI
records and renderers never generate or own tree meshes.

Stable IDs combine the world seed, registered type, and global candidate-cell
address. They do not depend on streaming or generation order, allowing later
save data to attach persistent gameplay state—such as an opened door, looted
container, or discovered landmark—to a building without storing its geometry.
