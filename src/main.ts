import "./style.css";

import { Game } from "./core/Game";
import { getBrowserStorage, resetGameState } from "./game/persistence";
import { installGameGestureProtection } from "./game/gameGestureProtection";
import {
  clampNeighborhoodOffset,
  MAX_NEIGHBORHOOD_OFFSET,
  MIN_NEIGHBORHOOD_OFFSET,
  type ChunkNeighborhoodOffsets,
} from "./world/chunkCoordinates";
import {
  CAMERA_ORIENTATION_STORAGE_KEY, FOLLOW_RESPONSIVENESS_STORAGE_KEY,
  isCameraOrientationMode, isFollowResponsiveness,
  type CameraOrientationMode, type FollowResponsiveness,
} from "./game/cameraOrientation";
import {
  MAX_MOVEMENT_SPEED_MULTIPLIER,
  normalizeMovementSpeedMultiplier,
  playerSpeedForMultiplier,
  restoreMovementSpeedMultiplier,
} from "./player/movement";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
const restartButton = document.querySelector<HTMLButtonElement>("#restart-button");
const resetProgressButton = document.querySelector<HTMLButtonElement>("#reset-progress-button");
const settingsButton = document.querySelector<HTMLButtonElement>("#settings-button");
const settingsPanel = document.querySelector<HTMLElement>("#settings-panel");
const debugButton = document.querySelector<HTMLButtonElement>("#debug-button");
const debugPanel = document.querySelector<HTMLElement>("#debug-panel");
const wireframeInput = document.querySelector<HTMLInputElement>("#debug-wireframe");
const biomesInput = document.querySelector<HTMLInputElement>("#debug-biomes");
const poiDirectionsInput = document.querySelector<HTMLInputElement>("#debug-poi-directions");
const terrainOcclusionInput = document.querySelector<HTMLInputElement>("#debug-terrain-occlusion");
const occlusionMapInput = document.querySelector<HTMLInputElement>("#debug-occlusion-map");
const poisInput = document.querySelector<HTMLSelectElement>("#debug-pois");
const riverSpineInput = document.querySelector<HTMLSelectElement>("#debug-river-spine");
const cameraInput = document.querySelector<HTMLInputElement>("#debug-camera");
const performanceInput = document.querySelector<HTMLInputElement>("#debug-performance");
const shadowsInput = document.querySelector<HTMLInputElement>("#debug-shadows");
const movementYawInput = document.querySelector<HTMLInputElement>("#movement-yaw");
const movementYawValue = document.querySelector<HTMLOutputElement>("#movement-yaw-value");
const movementSpeedInput = document.querySelector<HTMLInputElement>("#movement-speed");
const movementSpeedValue = document.querySelector<HTMLOutputElement>("#movement-speed-value");
const orientationControl = document.querySelector<HTMLElement>("#camera-orientation");
const responsivenessControl = document.querySelector<HTMLElement>("#follow-responsiveness");
const movementYawSettings = document.querySelector<HTMLElement>("#movement-yaw-settings");
const responsivenessSettings = document.querySelector<HTMLElement>("#follow-responsiveness-settings");
const sunlightVerticalInput = document.querySelector<HTMLInputElement>("#sunlight-vertical");
const sunlightHorizontalInput = document.querySelector<HTMLInputElement>("#sunlight-horizontal");
const sunlightVerticalValue = document.querySelector<HTMLOutputElement>("#sunlight-vertical-value");
const sunlightHorizontalValue = document.querySelector<HTMLOutputElement>("#sunlight-horizontal-value");
const offsetOutputs = Object.fromEntries(["west", "east", "north", "south"].map((direction) => [
  direction, document.querySelector<HTMLOutputElement>(`#offset-${direction}`),
])) as Record<keyof ChunkNeighborhoodOffsets, HTMLOutputElement | null>;
const offsetButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-offset-direction][data-offset-change]")];

if (!canvas || !restartButton || !resetProgressButton || !settingsButton || !settingsPanel || !debugButton || !debugPanel || !wireframeInput || !biomesInput || !poiDirectionsInput || !terrainOcclusionInput || !occlusionMapInput || !poisInput || !riverSpineInput || !cameraInput || !performanceInput || !shadowsInput || !movementYawInput || !movementYawValue || !movementSpeedInput || !movementSpeedValue || !orientationControl || !responsivenessControl || !movementYawSettings || !responsivenessSettings || !sunlightVerticalInput || !sunlightHorizontalInput || !sunlightVerticalValue || !sunlightHorizontalValue || Object.values(offsetOutputs).some((output) => !output) || offsetButtons.length !== 8) {
  throw new Error("The game interface could not be found.");
}

const NEIGHBORHOOD_STORAGE_KEY = "mobile-walker:neighborhood-offsets";
const SUNLIGHT_STORAGE_KEY = "mobile-walker:sunlight-angles";
const MOVEMENT_YAW_STORAGE_KEY = "mobile-walker:movement-yaw";
const MOVEMENT_SPEED_STORAGE_KEY = "mobile-walker:movement-speed";
const storage = getBrowserStorage();
let orientationMode: CameraOrientationMode = "north-locked";
let followResponsiveness: FollowResponsiveness = "normal";
try {
  const saved = storage.getItem(CAMERA_ORIENTATION_STORAGE_KEY);
  if (isCameraOrientationMode(saved)) orientationMode = saved;
  const savedResponse = storage.getItem(FOLLOW_RESPONSIVENESS_STORAGE_KEY);
  if (isFollowResponsiveness(savedResponse)) followResponsiveness = savedResponse;
} catch { /* Invalid or unavailable settings retain safe defaults. */ }
try {
  movementSpeedInput.value = String(restoreMovementSpeedMultiplier(storage.getItem(MOVEMENT_SPEED_STORAGE_KEY)));
} catch { /* Invalid or unavailable settings fall back to the value in the interface. */ }
try {
  const savedMovementYawSetting = storage.getItem(MOVEMENT_YAW_STORAGE_KEY);
  if (savedMovementYawSetting !== null) {
    const savedMovementYaw = Number(savedMovementYawSetting);
    if (Number.isFinite(savedMovementYaw) && savedMovementYaw >= 0 && savedMovementYaw <= 90) {
      movementYawInput.value = String(savedMovementYaw);
    }
  }
} catch { /* Invalid or unavailable settings fall back to the value in the interface. */ }
try {
  const savedOffsets = JSON.parse(storage.getItem(NEIGHBORHOOD_STORAGE_KEY) ?? "null") as Partial<ChunkNeighborhoodOffsets> | null;
  if (savedOffsets) for (const [direction, output] of Object.entries(offsetOutputs)) {
    const value = savedOffsets[direction as keyof ChunkNeighborhoodOffsets];
    if (typeof value === "number" && Number.isFinite(value)) output!.value = String(clampNeighborhoodOffset(value));
  }
} catch { /* Invalid or unavailable settings fall back to the values in the interface. */ }
try {
  const savedAngles = JSON.parse(storage.getItem(SUNLIGHT_STORAGE_KEY) ?? "null") as { vertical?: unknown; horizontal?: unknown } | null;
  if (typeof savedAngles?.vertical === "number" && Number.isFinite(savedAngles.vertical)) sunlightVerticalInput.value = String(Math.min(90, Math.max(10, savedAngles.vertical)));
  if (typeof savedAngles?.horizontal === "number" && Number.isFinite(savedAngles.horizontal)) sunlightHorizontalInput.value = String(Math.min(360, Math.max(0, savedAngles.horizontal)));
} catch { /* Invalid or unavailable settings fall back to the values in the interface. */ }

const game = new Game(canvas);
const removeGameGestureProtection = installGameGestureProtection(canvas);
const selectSegment = (control: HTMLElement, value: string): void => {
  for (const button of control.querySelectorAll<HTMLButtonElement>("button[role=radio]")) {
    const selected = button.dataset.value === value;
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
};
const updateOrientation = (mode: CameraOrientationMode): void => {
  orientationMode = mode;
  selectSegment(orientationControl, mode);
  movementYawSettings.hidden = mode !== "north-locked";
  responsivenessSettings.hidden = mode !== "follow-movement";
  game.setCameraOrientationMode(mode);
  try { storage.setItem(CAMERA_ORIENTATION_STORAGE_KEY, mode); } catch { /* Gameplay remains live without storage. */ }
};
const updateResponsiveness = (value: FollowResponsiveness): void => {
  followResponsiveness = value;
  selectSegment(responsivenessControl, value);
  game.setFollowResponsiveness(value);
  try { storage.setItem(FOLLOW_RESPONSIVENESS_STORAGE_KEY, value); } catch { /* Gameplay remains live without storage. */ }
};
const activateSegment = (event: Event): void => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-value]");
  if (!button) return;
  if (button.parentElement === orientationControl && isCameraOrientationMode(button.dataset.value)) updateOrientation(button.dataset.value);
  if (button.parentElement === responsivenessControl && isFollowResponsiveness(button.dataset.value)) updateResponsiveness(button.dataset.value);
  button.focus();
};
const navigateSegment = (event: KeyboardEvent): void => {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const control = event.currentTarget as HTMLElement;
  const buttons = [...control.querySelectorAll<HTMLButtonElement>("button[data-value]")];
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : current + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1);
  next = (next + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next].click();
};
const restartGame = (): void => window.location.reload();
const resetProgress = (): void => { resetGameState(getBrowserStorage()); window.location.reload(); };
const toggleSettingsPanel = (): void => {
  const open = settingsPanel.hidden;
  settingsPanel.hidden = !open;
  settingsButton.setAttribute("aria-expanded", String(open));
  if (open) {
    debugPanel.hidden = true;
    debugButton.setAttribute("aria-expanded", "false");
  }
};
const toggleDebugPanel = (): void => {
  const open = debugPanel.hidden;
  debugPanel.hidden = !open;
  debugButton.setAttribute("aria-expanded", String(open));
  if (open) {
    settingsPanel.hidden = true;
    settingsButton.setAttribute("aria-expanded", "false");
  }
};
const updateDebugView = (): void => game.setDebugView({
  wireframe: wireframeInput.checked,
  biomeGuide: biomesInput.checked,
  disableTerrainOcclusion: terrainOcclusionInput.checked,
  occlusionMap: occlusionMapInput.checked,
  pois: poisInput.value as "off" | "accepted" | "candidates",
});
const updateRiverSpineDebug = (): void => game.setRiverSpineDebugMode(riverSpineInput.value as "off"|"spine"|"ribbon"|"detailed");
const updateCameraDetails = (): void => game.setCameraDetailsEnabled(cameraInput.checked);
const updatePoiDirections = (): void => game.setPoiDirectionsEnabled(poiDirectionsInput.checked);
const updatePerformanceView = (): void => game.setPerformanceViewEnabled(performanceInput.checked);
const updateShadows = (): void => game.setShadowsEnabled(shadowsInput.checked);
const updateMovementYaw = (): void => {
  const degrees = Math.min(90, Math.max(0, Number(movementYawInput.value)));
  movementYawInput.value = String(degrees);
  movementYawValue.value = `${degrees}°`;
  game.setMovementYawStrength(degrees);
  try { storage.setItem(MOVEMENT_YAW_STORAGE_KEY, String(degrees)); } catch { /* Gameplay remains live without storage. */ }
};
const updateMovementSpeed = (): void => {
  const multiplier = normalizeMovementSpeedMultiplier(Number(movementSpeedInput.value));
  movementSpeedInput.value = String(multiplier);
  movementSpeedValue.value = `${multiplier}×`;
  game.setPlayerMovementSpeed(playerSpeedForMultiplier(multiplier));
  try { storage.setItem(MOVEMENT_SPEED_STORAGE_KEY, String(multiplier)); } catch { /* Gameplay remains live without storage. */ }
};
const updateSunlight = (): void => {
  const angles = { vertical: Number(sunlightVerticalInput.value), horizontal: Number(sunlightHorizontalInput.value) };
  sunlightVerticalValue.value = `${angles.vertical}°`;
  sunlightHorizontalValue.value = `${angles.horizontal}°`;
  game.setSunlightAngles(angles);
  try { storage.setItem(SUNLIGHT_STORAGE_KEY, JSON.stringify(angles)); } catch { /* Gameplay remains live without storage. */ }
};
const updateNeighborhood = (): void => {
  const offsets = Object.fromEntries(Object.entries(offsetOutputs).map(([direction, output]) => {
    const value = clampNeighborhoodOffset(Number(output!.value));
    output!.value = String(value);
    return [direction, value];
  })) as unknown as ChunkNeighborhoodOffsets;
  for (const button of offsetButtons) {
    const direction = button.dataset.offsetDirection as keyof ChunkNeighborhoodOffsets;
    const change = Number(button.dataset.offsetChange);
    button.disabled = change < 0
      ? offsets[direction] <= MIN_NEIGHBORHOOD_OFFSET
      : offsets[direction] >= MAX_NEIGHBORHOOD_OFFSET;
  }
  game.setNeighborhoodOffsets(offsets);
  try { storage.setItem(NEIGHBORHOOD_STORAGE_KEY, JSON.stringify(offsets)); } catch { /* Gameplay remains live without storage. */ }
};
const changeNeighborhoodOffset = (event: MouseEvent): void => {
  const button = event.currentTarget as HTMLButtonElement;
  const direction = button.dataset.offsetDirection as keyof ChunkNeighborhoodOffsets;
  offsetOutputs[direction]!.value = String(Number(offsetOutputs[direction]!.value) + Number(button.dataset.offsetChange));
  updateNeighborhood();
};

restartButton.addEventListener("click", restartGame);
resetProgressButton.addEventListener("click", resetProgress);
settingsButton.addEventListener("click", toggleSettingsPanel);
debugButton.addEventListener("click", toggleDebugPanel);
for (const input of [wireframeInput, biomesInput, terrainOcclusionInput, occlusionMapInput, poisInput]) input.addEventListener("change", updateDebugView);
riverSpineInput.addEventListener("change", updateRiverSpineDebug);
poiDirectionsInput.addEventListener("change", updatePoiDirections);
cameraInput.addEventListener("change", updateCameraDetails);
performanceInput.addEventListener("change", updatePerformanceView);
shadowsInput.addEventListener("change", updateShadows);
movementYawInput.addEventListener("input", updateMovementYaw);
movementSpeedInput.addEventListener("input", updateMovementSpeed);
orientationControl.addEventListener("click", activateSegment);
orientationControl.addEventListener("keydown", navigateSegment);
responsivenessControl.addEventListener("click", activateSegment);
responsivenessControl.addEventListener("keydown", navigateSegment);
sunlightVerticalInput.addEventListener("input", updateSunlight);
sunlightHorizontalInput.addEventListener("input", updateSunlight);
for (const button of offsetButtons) button.addEventListener("click", changeNeighborhoodOffset);
updateNeighborhood();
updateResponsiveness(followResponsiveness);
updateOrientation(orientationMode);
game.start();
updateShadows();
updateMovementSpeed();
updateMovementYaw();
updateSunlight();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    restartButton.removeEventListener("click", restartGame);
    resetProgressButton.removeEventListener("click", resetProgress);
    settingsButton.removeEventListener("click", toggleSettingsPanel);
    debugButton.removeEventListener("click", toggleDebugPanel);
    for (const input of [wireframeInput, biomesInput, terrainOcclusionInput, occlusionMapInput, poisInput]) input.removeEventListener("change", updateDebugView);
    riverSpineInput.removeEventListener("change", updateRiverSpineDebug);
    poiDirectionsInput.removeEventListener("change", updatePoiDirections);
    cameraInput.removeEventListener("change", updateCameraDetails);
    performanceInput.removeEventListener("change", updatePerformanceView);
    shadowsInput.removeEventListener("change", updateShadows);
    movementYawInput.removeEventListener("input", updateMovementYaw);
    movementSpeedInput.removeEventListener("input", updateMovementSpeed);
    orientationControl.removeEventListener("click", activateSegment);
    orientationControl.removeEventListener("keydown", navigateSegment);
    responsivenessControl.removeEventListener("click", activateSegment);
    responsivenessControl.removeEventListener("keydown", navigateSegment);
    sunlightVerticalInput.removeEventListener("input", updateSunlight);
    sunlightHorizontalInput.removeEventListener("input", updateSunlight);
    for (const button of offsetButtons) button.removeEventListener("click", changeNeighborhoodOffset);
    removeGameGestureProtection();
    game.dispose();
  });
}
