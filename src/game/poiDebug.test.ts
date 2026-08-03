import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { createEcsWorld } from "../ecs/createEcsWorld";
import type { GeneratedChunkData } from "../world/generateChunk";
import { GeneratedChunkRepository } from "../world/GeneratedChunkRepository";
import type { GeneratedPoi } from "../world/poi";
import { findNearestPoiTypes, formatPoiDistance, PoiDebugPresentationSystem, poiIndicatorTransform } from "./poiDebug";

const stylesheet = readFileSync(new URL("../style.css", import.meta.url), "utf8");

class FakeStyle {
  transform = "";
  setProperty(name: string, value: string): void { if (name === "transform") this.transform = value; }
  removeProperty(name: string): string { if (name === "transform") this.transform = ""; return ""; }
}

class FakeElement {
  className = "";
  hidden = false;
  title = "";
  textContent = "";
  readonly dataset: Record<string, string> = {};
  readonly style = new FakeStyle();
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  clientWidth = 0;
  clientHeight = 0;
  private readonly listeners = new Map<string, Set<() => void>>();
  append(...children: FakeElement[]): void { this.children.push(...children); }
  remove(): void { /* The fixture does not require parent bookkeeping. */ }
  replaceChildren(): void { this.children.length = 0; this.textContent = ""; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  removeAttribute(name: string): void { this.attributes.delete(name); if (name === "title") this.title = ""; }
  addEventListener(name: string, listener: () => void): void {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }
  removeEventListener(name: string, listener: () => void): void { this.listeners.get(name)?.delete(listener); }
  click(): void { for (const listener of this.listeners.get("click") ?? []) listener(); }
  querySelector<T>(selector: string): T | null {
    const className = selector.startsWith(".") ? selector.slice(1) : selector;
    return (this.children.find(child => child.className === className) as T | undefined) ?? null;
  }
}

function presentationFixture(repository = new GeneratedChunkRepository(), width = 320, height = 240, cameraYaw = 0) {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => new FakeElement() } as unknown as Document;
  const overlay = new FakeElement();
  overlay.clientWidth = width;
  overlay.clientHeight = height;
  const system = new PoiDebugPresentationSystem(repository, overlay as unknown as HTMLElement, () => cameraYaw);
  const world = createEcsWorld();
  world.add({ playerControl: { moveX: 0, moveZ: 0, active: false, jump: false }, transform: { x: 0, y: 0, z: 0, yaw: 0 } });
  const restore = () => { globalThis.document = previousDocument; };
  return { overlay, system, world, restore };
}

function poi(typeId: string, x: number, z: number): GeneratedPoi {
  return { typeId, position: { x, y: 0, z } } as GeneratedPoi;
}

function chunk(pois: readonly GeneratedPoi[]): GeneratedChunkData {
  return { pois } as GeneratedChunkData;
}

describe("findNearestPoiTypes", () => {
  it("returns the closest generated POI for every type", () => {
    const repository = new GeneratedChunkRepository();
    repository.set("0,0", chunk([
      poi("forest-cabin", 12, 0),
      poi("forest-cabin", 3, 4),
      poi("lake-house", -6, 8),
    ]));

    expect([...findNearestPoiTypes(repository, 0, 0)]).toEqual([
      ["forest-cabin", { typeId: "forest-cabin", x: 3, z: 4, distance: 5 }],
      ["lake-house", { typeId: "lake-house", x: -6, z: 8, distance: 10 }],
    ]);
  });

  it("finds generated POIs outside the former four-chunk search radius", () => {
    const repository = new GeneratedChunkRepository();
    repository.set("8,0", chunk([poi("forest-cabin", 260, 0)]));

    expect(findNearestPoiTypes(repository, 0, 0).get("forest-cabin")?.distance).toBe(260);
  });

  it("selects the nearest POI per type across every retained record", () => {
    const repository = new GeneratedChunkRepository();
    repository.set("20,20", chunk([poi("forest-cabin", 9, 12), poi("lake-house", 30, 40)]));
    repository.set("-20,-20", chunk([poi("forest-cabin", 6, 8), poi("lake-house", 18, 24)]));

    expect(findNearestPoiTypes(repository, 0, 0).get("forest-cabin")?.distance).toBe(10);
    expect(findNearestPoiTypes(repository, 0, 0).get("lake-house")?.distance).toBe(30);
  });

  it("includes retained bridges as POIs in the guide", () => {
    const repository = new GeneratedChunkRepository();
    repository.set("0,0", { bridges: [{ archetype: "stone-bridge", crossingCentre: { x: 12, y: 2, z: 5 } }], pois: [] } as unknown as GeneratedChunkData);

    expect(findNearestPoiTypes(repository, 0, 0).get("stone-bridge")).toMatchObject({ distance: 13, x: 12, z: 5 });
  });

  it("targets a stored access anchor rather than the POI centre", () => {
    const repository = new GeneratedChunkRepository();
    const anchored = { ...poi("forest-cabin", 100, 100), navigationAnchor: { x: 3, y: 0, z: 4, kind: "entrance" as const } };
    repository.set("6,6", chunk([anchored]));
    expect(findNearestPoiTypes(repository, 0, 0).get("forest-cabin")).toEqual({ typeId: "forest-cabin", x: 3, z: 4, distance: 5 });
  });
});

describe("poiIndicatorTransform", () => {
  it.each([[42, 0], [-42, 0], [0, 42], [0, -42]])("positions axis-aligned directions without invalid values", (dx, dy) => {
    const transform = poiIndicatorTransform(320, 240, dx, dy);
    expect(transform).toBeTruthy();
    expect(transform).not.toContain("NaN");
    expect(transform).not.toContain("Infinity");
    expect(transform).not.toBe("translate(0px, 0px) translate(-50%, -50%)");
  });

  it("aligns edge labels inward so expanded content remains on screen", () => {
    expect(poiIndicatorTransform(320, 240, -42, 0)).toContain("translate(0%, -50%)");
    expect(poiIndicatorTransform(320, 240, 42, 0)).toContain("translate(-100%, -50%)");
  });

  it("does not position an indicator in a zero-sized overlay", () => {
    expect(poiIndicatorTransform(0, 240, 10, 0)).toBeUndefined();
    expect(poiIndicatorTransform(320, 0, 0, 10)).toBeUndefined();
  });
});

describe("formatPoiDistance", () => {
  it("rounds the distance and labels it in metres", () => {
    expect(formatPoiDistance(42.49)).toBe("42 m");
    expect(formatPoiDistance(42.5)).toBe("43 m");
  });
});

describe("POI guide presentation", () => {
  it("has an author-level hidden rule after the flex declaration", () => {
    expect(stylesheet).toMatch(/\.biome-indicator\s*\{[^}]*display:\s*flex[^}]*\}/s);
    expect(stylesheet).toMatch(/\.biome-indicator\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
    expect(stylesheet.indexOf(".biome-indicator[hidden]")).toBeGreaterThan(stylesheet.indexOf(".biome-indicator {"));
  });

  it("stacks expanded names below the marker and distance within half the screen", () => {
    expect(stylesheet).toMatch(/\.biome-indicator\[data-expanded="true"\]\s*\{[^}]*display:\s*grid[^}]*max-width:\s*calc\(50% - \.5rem\)[^}]*\}/s);
    expect(stylesheet).toMatch(/\.biome-indicator\[data-expanded="true"\] \.biome-indicator-name\s*\{[^}]*grid-column:\s*1 \/ -1[^}]*white-space:\s*normal[^}]*\}/s);
  });

  it("keeps targetless indicators hidden and clears stale presentation", () => {
    const fixture = presentationFixture();
    try {
      const indicator = fixture.overlay.children[0]!;
      const distance = indicator.children[1]!;
      indicator.hidden = false;
      indicator.title = "Old target";
      indicator.attributes.set("title", "Old target");
      indicator.style.transform = "translate(10px, 10px)";
      distance.textContent = "99 m";
      fixture.system.setEnabled(true);
      fixture.system.prepareRender(fixture.world, 0, 0);
      expect(indicator.hidden).toBe(true);
      expect(distance.textContent).toBe("");
      expect(indicator.style.transform).toBe("");
      expect(indicator.attributes.has("title")).toBe(false);
    } finally { fixture.restore(); }
  });

  it("updates on the first enabled frame with a rounded label and edge transform", () => {
    const repository = new GeneratedChunkRepository();
    repository.set("9,0", chunk([poi("plains-farmhouse", 42.4, 0)]));
    const fixture = presentationFixture(repository);
    try {
      fixture.system.setEnabled(true);
      fixture.system.prepareRender(fixture.world, 0, 0);
      const indicator = fixture.overlay.children.find(child => child.dataset.poi === "plains-farmhouse")!;
      expect(indicator.hidden).toBe(false);
      expect(indicator.children[1]!.textContent).toBe("42 m");
      expect(indicator.style.transform).toBeTruthy();
      expect(indicator.style.transform).not.toContain("translate(0px, 0px)");
    } finally { fixture.restore(); }
  });

  it("positions targets relative to the camera facing angle", () => {
    const repository = new GeneratedChunkRepository();
    repository.set("9,0", chunk([poi("plains-farmhouse", 42, 0)]));
    const fixture = presentationFixture(repository, 320, 240, Math.PI / 2);
    try {
      fixture.system.setEnabled(true);
      fixture.system.prepareRender(fixture.world, 0, 0);
      const indicator = fixture.overlay.children.find(child => child.dataset.poi === "plains-farmhouse")!;
      expect(indicator.style.transform).toContain("translate(160px, 28px)");
    } finally { fixture.restore(); }
  });

  it("expands one indicator name at a time and toggles it closed", () => {
    const repository = new GeneratedChunkRepository();
    repository.set("0,0", chunk([
      poi("plains-farmhouse", 42, 0),
      poi("forest-cabin", 0, 42),
    ]));
    const fixture = presentationFixture(repository);
    try {
      fixture.system.setEnabled(true);
      fixture.system.prepareRender(fixture.world, 0, 0);
      const farmhouse = fixture.overlay.children.find(child => child.dataset.poi === "plains-farmhouse")!;
      const cabin = fixture.overlay.children.find(child => child.dataset.poi === "forest-cabin")!;

      expect(farmhouse.children[2]!.textContent).toBe("Plains farmhouse");
      farmhouse.click();
      expect(farmhouse.dataset.expanded).toBe("true");
      cabin.click();
      expect(farmhouse.dataset.expanded).toBe("false");
      expect(cabin.dataset.expanded).toBe("true");
      cabin.click();
      expect(cabin.dataset.expanded).toBe("false");
    } finally { fixture.system.dispose(); fixture.restore(); }
  });

  it("hides every indicator when the overlay has zero size", () => {
    const repository = new GeneratedChunkRepository();
    repository.set("0,0", chunk([poi("plains-farmhouse", 42, 0)]));
    const fixture = presentationFixture(repository, 0, 0);
    try {
      fixture.system.setEnabled(true);
      fixture.system.prepareRender(fixture.world, 0, 0);
      expect(fixture.overlay.children.every(indicator => indicator.hidden)).toBe(true);
      expect(fixture.overlay.children.every(indicator => indicator.style.transform === "")).toBe(true);
    } finally { fixture.restore(); }
  });
});
