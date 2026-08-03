import type { RenderSystem } from "../ecs/System";
import type { GeneratedChunkRepository } from "../world/GeneratedChunkRepository";
import { BRIDGE_ARCHETYPES, type BridgeArchetype } from "../world/bridges";
import { getPoiDefinitions } from "../world/poi";
import { worldToOverlayDisplacement } from "./biomeDebug";
import { collapseDirectionIndicator, makeDirectionIndicatorExpandable } from "./directionIndicator";

export interface PoiDirection {
  readonly typeId: string;
  readonly x: number;
  readonly z: number;
  readonly distance: number;
}

/** Formats the horizontal world-space distance to a POI in metres. */
export function formatPoiDistance(distance: number): string {
  return `${Math.round(distance)} m`;
}

interface PoiGuideDefinition { readonly id: string; readonly label: string; readonly debugColor: number }

const BRIDGE_GUIDE_PRESENTATION: Readonly<Record<BridgeArchetype, Omit<PoiGuideDefinition, "id">>> = {
  "pedestrian-footbridge": { label: "Pedestrian footbridge", debugColor: 0xc58b4d },
  "heavy-timber-bridge": { label: "Heavy timber bridge", debugColor: 0x754c2e },
  "stone-bridge": { label: "Stone bridge", debugColor: 0x8c9291 },
};

/** All generated building and bridge types represented by the POI guide. */
export function getPoiGuideDefinitions(): readonly PoiGuideDefinition[] {
  return [
    ...getPoiDefinitions(),
    ...(Object.keys(BRIDGE_ARCHETYPES) as BridgeArchetype[]).map(id => ({ id, ...BRIDGE_GUIDE_PRESENTATION[id] })),
  ];
}

/** Finds the closest POI of each type across all chunk data retained by streaming. */
export function findNearestPoiTypes(
  repository: GeneratedChunkRepository,
  playerX: number,
  playerZ: number,
): ReadonlyMap<string, PoiDirection> {
  const nearest = new Map<string, PoiDirection>();
  const consider = (typeId: string, x: number, z: number): void => {
    const distance = Math.hypot(x - playerX, z - playerZ);
    const previous = nearest.get(typeId);
    if (!previous || distance < previous.distance) {
      nearest.set(typeId, { typeId, x, z, distance });
    }
  };
  for (const data of repository.values()) {
    for (const poi of data.pois) {
      const anchor = poi.navigationAnchor ?? poi.entrance?.position ?? poi.position;
      if (Number.isFinite(anchor.x) && Number.isFinite(anchor.z)) consider(poi.typeId, anchor.x, anchor.z);
    }
    for (const bridge of data.bridges ?? []) {
      consider(bridge.archetype, bridge.crossingCentre.x, bridge.crossingCentre.z);
    }
  }
  return nearest;
}

function hideIndicator(indicator: HTMLElement): void {
  collapseDirectionIndicator(indicator);
  indicator.hidden = true;
  indicator.querySelector<HTMLElement>(".biome-indicator-distance")?.replaceChildren();
  indicator.style.removeProperty("transform");
  indicator.removeAttribute("title");
}

function hideIndicators(indicators: Iterable<HTMLElement>): void {
  for (const indicator of indicators) hideIndicator(indicator);
}

/** Calculates a safe edge position for a non-zero overlay and non-zero direction. */
export function poiIndicatorTransform(width: number, height: number, dx: number, dy: number): string | undefined {
  if (width <= 0 || height <= 0 || (!dx && !dy)) return undefined;
  const marginX = Math.min(28, width / 2);
  const marginY = Math.min(28, height / 2);
  const halfWidth = Math.max(0, width / 2 - marginX);
  const halfHeight = Math.max(0, height / 2 - marginY);
  const xScale = dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx);
  const yScale = dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy);
  const scale = Math.min(xScale, yScale);
  if (!Number.isFinite(scale)) return undefined;
  const x = Math.min(width - marginX, Math.max(marginX, width / 2 + dx * scale));
  const y = Math.min(height - marginY, Math.max(marginY, height / 2 + dy * scale));
  // Grow expanded labels toward the middle of the screen instead of centring
  // them over an edge point, where half of a long name would be clipped.
  const horizontalAlignment = x < width / 2 ? "0%" : "-100%";
  return `translate(${x}px, ${y}px) translate(${horizontalAlignment}, -50%)`;
}

export class PoiDebugPresentationSystem implements RenderSystem {
  private enabled = false;
  private elapsed = Number.POSITIVE_INFINITY;
  private readonly indicators = new Map<string, HTMLElement>();
  private readonly removeIndicatorListeners: (() => void)[] = [];

  constructor(
    private readonly repository: GeneratedChunkRepository,
    private readonly overlay: HTMLElement,
    private readonly getCameraYaw: () => number = () => 0,
  ) {
    for (const definition of getPoiGuideDefinitions()) {
      const indicator = document.createElement("button");
      indicator.className = "biome-indicator poi-indicator";
      indicator.setAttribute("type", "button");
      indicator.dataset.poi = definition.id;
      indicator.style.setProperty("--biome-color", `#${definition.debugColor.toString(16).padStart(6, "0")}`);
      indicator.setAttribute("aria-label", `Direction to nearest ${definition.label}`);
      indicator.hidden = true;
      const marker = document.createElement("span");
      marker.className = "biome-indicator-marker";
      marker.setAttribute("aria-hidden", "true");
      const distance = document.createElement("span");
      distance.className = "biome-indicator-distance";
      const name = document.createElement("span");
      name.className = "biome-indicator-name";
      name.textContent = definition.label;
      indicator.append(marker, distance, name);
      this.removeIndicatorListeners.push(makeDirectionIndicatorExpandable(indicator));
      this.overlay.append(indicator);
      this.indicators.set(definition.id, indicator);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.overlay.hidden = !enabled;
    this.elapsed = Number.POSITIVE_INFINITY;
    if (!enabled) hideIndicators(this.indicators.values());
  }

  prepareRender(world: Parameters<RenderSystem["prepareRender"]>[0], _interpolation: number, deltaSeconds: number): void {
    if (!this.enabled) return;
    this.elapsed += deltaSeconds;
    if (this.elapsed < 0.2) return;
    this.elapsed = 0;
    const player = world.entities.find((entity) => entity.playerControl && entity.transform);
    if (!player?.transform) { hideIndicators(this.indicators.values()); return; }

    const { x, z } = player.transform;
    const nearest = findNearestPoiTypes(this.repository, x, z);
    const width = this.overlay.clientWidth;
    const height = this.overlay.clientHeight;
    if (width <= 0 || height <= 0) { hideIndicators(this.indicators.values()); return; }
    for (const definition of getPoiGuideDefinitions()) {
      const indicator = this.indicators.get(definition.id);
      const target = nearest.get(definition.id);
      if (!indicator) continue;
      if (!target || target.distance < 1) {
        hideIndicator(indicator);
        continue;
      }
      const distanceLabel = formatPoiDistance(target.distance);
      const label = `${definition.label}: ${distanceLabel}`;
      indicator.querySelector<HTMLElement>(".biome-indicator-distance")!.textContent = distanceLabel;
      indicator.title = label;
      indicator.setAttribute("aria-label", `Direction to nearest ${label}`);
      const { x: dx, y: dy } = worldToOverlayDisplacement(x, z, target.x, target.z, this.getCameraYaw());
      const transform = poiIndicatorTransform(width, height, dx, dy);
      if (!transform) { hideIndicator(indicator); continue; }
      indicator.style.transform = transform;
      indicator.hidden = false;
    }
  }

  dispose(): void {
    for (const removeListener of this.removeIndicatorListeners) removeListener();
    for (const indicator of this.indicators.values()) indicator.remove();
    this.indicators.clear();
  }
}
