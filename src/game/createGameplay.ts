import * as THREE from "three";

import type { EcsWorld } from "../ecs/createEcsWorld";
import type { SystemScheduler } from "../ecs/SystemScheduler";
import { InputController } from "../player/InputController";
import { InputSnapshotSystem, PlayerMovementSystem, StructureCollisionSystem, TerrainSamplingSystem, TreeCollisionSystem } from "../player/systems";
import type { ThreeRenderer } from "../rendering/ThreeRenderer";
import { ChunkStreamingSystem } from "../world/ChunkStreamingSystem";
import { PoiBeaconPresentation } from "../rendering/poiBeaconPresentation";
import { CameraPresentationSystem, PlayerFogPresentationSystem, PlayerShadowPresentationSystem, TransformInterpolationSystem } from "./presentationSystems";
import { createBlobShadowMaterial, createPlayerShadowGeometry, markBlobShadow } from "../rendering/blobShadows";
import { CollectionSystem, createCollectionState, ExplorationPresentationSystem, ProximityDetectionSystem } from "./exploration";
import { BiomeDebugPresentationSystem } from "./biomeDebug";
import { getBrowserStorage, loadGameState, PersistenceSystem } from "./persistence";
import { findSafeRestoredTransformFromCanonicalWorld } from "../world/safePlayerPosition";
import { PLAYER_COLLISION_RADIUS } from "../world/treeCollision";
import { PoiDebugPresentationSystem } from "./poiDebug";
import { RiverSpineDebugView } from "./riverSpineDebug";
import { sampleTerrainHeight } from "../world/terrainSampling";
import { getWorldRiverOwner } from "../world/worldRiverOwner";
import { PoiBeaconState } from "./poiBeaconState";

export interface GameplayControllers {
  readonly chunks: ChunkStreamingSystem;
  readonly biomeDebug: BiomeDebugPresentationSystem;
  readonly poiDebug: PoiDebugPresentationSystem;
  readonly camera: CameraPresentationSystem;
  readonly persistence: PersistenceSystem;
  readonly exploration: ExplorationPresentationSystem;
  readonly playerShadow: THREE.Mesh;
  readonly playerMovement: PlayerMovementSystem;
  readonly riverSpineDebug: RiverSpineDebugView;
  /** Gameplay-owned beacon truth; rendering and chunk streaming may only consume it. */
  readonly poiBeacons: PoiBeaconState;
  /** Targeted refresh bridge for future gameplay/UI mutations; never owns state. */
  readonly beaconPresentation: PoiBeaconPresentation;
}

export function createGameplay(
  world: EcsWorld,
  systems: SystemScheduler,
  renderer: ThreeRenderer,
  inputElement: HTMLElement,
  dragIndicator?: HTMLElement,
): GameplayControllers {
  const worldSeed = "mobile-walker-v2";
  const riverOwner = getWorldRiverOwner(worldSeed);
  const storage = getBrowserStorage();
  const savedState = loadGameState(storage, worldSeed);
  const poiBeacons = new PoiBeaconState(savedState?.poiBeacons);
  // Restoration precedes chunk streaming, so query canonical deterministic
  // collision records rather than depending on rendered/resident chunks.
  const initialTransform = findSafeRestoredTransformFromCanonicalWorld(
    worldSeed,
    savedState?.player ?? { x: 0, y: 0.76, z: 0, yaw: 0 },
    0.76,
    PLAYER_COLLISION_RADIUS,
    0.5,
    5,
  );
  const player = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.38, 0.75, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0xf28f8f, flatShading: true, roughness: 0.9 }),
  );
  body.castShadow = true;
  player.add(body);

  const eyeGeometry = new THREE.SphereGeometry(0.105, 12, 8);
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0xfffbf2, roughness: 0.65 });
  const pupilGeometry = new THREE.SphereGeometry(0.048, 10, 8);
  const pupilMaterial = new THREE.MeshStandardMaterial({ color: 0x31473a, roughness: 0.75 });
  for (const x of [-0.14, 0.14]) {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.position.set(x, 0.42, 0.32);
    const pupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
    pupil.position.set(0, 0, 0.09);
    eye.add(pupil);
    player.add(eye);
  }
  renderer.scene.add(player);
  renderer.prepareWorldObject(player);
  const playerShadow = markBlobShadow(new THREE.Mesh(
    createPlayerShadowGeometry(), createBlobShadowMaterial(0.36),
  ));
  playerShadow.scale.set(0.58, 1, 0.43);
  renderer.scene.add(playerShadow);
  renderer.prepareWorldObject(playerShadow);

  world.add({
    transform: { ...initialTransform },
    previousTransform: { ...initialTransform },
    velocity: { x: 0, y: 0, z: 0 },
    playerControl: { moveX: 0, moveZ: 0, active: false, jump: false },
    jump: { grounded: true },
    terrainFollower: { heightOffset: 0.76 },
    structureSupport: {},
    cameraTarget: { height: 4.5, distance: 6.5 },
    renderable: player,
  });
  world.add({ collectionState: createCollectionState(savedState?.collectedIds) });
  // Fixed order: snapshot event state, then integrate.
  const input = new InputController(inputElement, dragIndicator);
  const camera = new CameraPresentationSystem(renderer.camera, input, savedState?.playerHeading);
  systems.addFixedSystem(new InputSnapshotSystem(input, () => camera.getMovementReferenceYaw()));
  const playerMovement = new PlayerMovementSystem(worldSeed);
  systems.addFixedSystem(playerMovement);
  const persistence = new PersistenceSystem(storage, worldSeed, poiBeacons, 1, () => camera.getEffectiveYaw());
  // Generate data before constructing meshes; then interpolate visuals and derive the camera pose.
  // The camera remains south of the player and looks north (negative world Z),
  // so spend the additional streaming row where it expands the visible view.
  const streamingOffsets = { west: 1, east: 1, south: 1, north: 4 } as const;
  const beaconPresentation = new PoiBeaconPresentation(renderer.scene, poiBeacons);
  const chunks = new ChunkStreamingSystem(renderer.scene, worldSeed, 1, {
    offsets: streamingOffsets,
    sunlightDirection: renderer.sunlightDirection,
    prepareWorldObject: (object) => renderer.prepareWorldObject(object),
    onChunkPresented: data => { for (const poi of data.pois) beaconPresentation.activatePoi(poi); },
    onChunkRetired: data => { for (const poi of data.pois) beaconPresentation.retirePoi(poi.id); },
  });
  systems.addFixedSystem(new TreeCollisionSystem(worldSeed, chunks.repository));
  systems.addFixedSystem(new StructureCollisionSystem(chunks.repository));
  systems.addFixedSystem(new TerrainSamplingSystem(worldSeed, chunks));
  systems.addFixedSystem(new ProximityDetectionSystem());
  systems.addFixedSystem(new CollectionSystem());
  systems.addFixedSystem(persistence);
  systems.addRenderSystem(chunks);
  systems.addRenderSystem({ prepareRender: () => beaconPresentation.update(renderer.camera.position), dispose: () => beaconPresentation.dispose() });
  const mushroomCount = document.querySelector<HTMLElement>("#mushroom-count");
  if (!mushroomCount) throw new Error("The mushroom counter could not be found.");
  const exploration = new ExplorationPresentationSystem(renderer.scene, worldSeed, 1, streamingOffsets, mushroomCount, chunks.repository, (object) => renderer.prepareWorldObject(object));
  systems.addRenderSystem(exploration);
  systems.addRenderSystem(new TransformInterpolationSystem());
  systems.addRenderSystem(new PlayerFogPresentationSystem((x, z) => renderer.playerCentredFog.update(x, z)));
  systems.addRenderSystem(new PlayerShadowPresentationSystem(worldSeed, playerShadow, renderer.sunlightDirection));
  systems.addRenderSystem(camera);
  const biomeOverlay = document.querySelector<HTMLElement>("#biome-guide");
  const biomeLabel = document.querySelector<HTMLElement>("#current-biome-name");
  if (!biomeOverlay || !biomeLabel) throw new Error("Biome guide elements could not be found.");
  const biomeDebug = new BiomeDebugPresentationSystem(worldSeed, biomeOverlay, biomeLabel, () => camera.getFacingYaw(), riverOwner.spine);
  systems.addRenderSystem(biomeDebug);
  const poiOverlay = document.querySelector<HTMLElement>("#poi-guide");
  if (!poiOverlay) throw new Error("The POI guide element could not be found.");
  const poiDebug = new PoiDebugPresentationSystem(chunks.repository, poiOverlay, () => camera.getFacingYaw());
  systems.addRenderSystem(poiDebug);
  const riverSpineDebug = new RiverSpineDebugView(
    renderer.scene,
    riverOwner.spine,
    (x, z) => sampleTerrainHeight(worldSeed, x, z),
    riverOwner.macroSpine,
    riverOwner.generation,
    riverOwner.widthProfile,
  );
  return { chunks, biomeDebug, poiDebug, camera, persistence, exploration, playerShadow, playerMovement, riverSpineDebug, poiBeacons, beaconPresentation };
}
