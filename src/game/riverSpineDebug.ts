import * as THREE from "three";
import { CHUNK_SIZE } from "../world/chunkCoordinates";
import { referenceWorldRiverGeneration, referenceWorldRiverMacroSpine, referenceWorldRiverSpine, type MacroRiverGeneration, type RiverSpine } from "../world/worldRiverSpine";
import { getReferenceRiverWidthProfile, WORLD_RIVER_CARVING } from "../world/worldRiverCarving";
import { WORLD_RIVER_WATER_SAMPLE_SPACING } from "../world/worldRiverWater";
import { sampleRiverWidth, type RiverWidthProfile } from "../world/worldRiverWidth";

export type RiverSpineDebugMode = "off" | "spine" | "ribbon" | "detailed";
export type TerrainHeightSampler = (worldX: number, worldZ: number) => number;
export const RIVER_SPINE_DEBUG_SURFACE_OFFSET = 0.08;
const RIVER_DEBUG_PATH_SAMPLES = 400;
const RIVER_DEBUG_RIBBON_SAMPLES = 512;
const RIVER_DEBUG_WATER_SAMPLE_CAP = 160;
const RIVER_DEBUG_FRAME_SAMPLE_CAP = 128;
const RIVER_DEBUG_INDEX_BOUNDS_CAP = 160;
const RIVER_DEBUG_CONNECTORS_PER_REGION = 6;

export const RIVER_DEBUG_STYLE = {
  centreline: { color: 0x00f5ff, width: 0.24, offset: 0.18 },
  macroSpine: { color: 0x8396a5, width: 0.14, offset: 0.15 },
  displacement: { color: 0xb875ff, width: 0.07, offset: 0.2 },
  regionBoundary: { color: 0xff6b35, width: 0.12, offset: 0.27 },
  controlPolygon: { color: 0xff9d00, width: 0.1, offset: 0.12 },
  tangent: { color: 0x45ff65, width: 0.18, offset: 0.32 },
  normal: { color: 0xff45e6, width: 0.18, offset: 0.34 },
  indexedBounds: { color: 0xffe600, width: 0.12, offset: 0.16 },
  chunkGrid: { color: 0x766cff, width: 0.065, offset: 0.1 },
  channelEdge: { color: 0x2dff9a, width: 0.16, offset: 0.2 },
  lipEdge: { color: 0xffffff, width: 0.1, offset: 0.25 },
  innerBankEdge: { color: 0xffd23f, width: 0.13, offset: 0.23 },
  falloffEdge: { color: 0xff4d67, width: 0.13, offset: 0.22 },
  ribbonOpacity: 0.72,
  detailedRibbonOpacity: 0.3,
} as const;

/** Pure placement boundary shared by all terrain-following debug geometry. */
export function placeRiverDebugPoint(
  point: { readonly x: number; readonly z: number },
  sampleHeight: TerrainHeightSampler,
  offset = RIVER_SPINE_DEBUG_SURFACE_OFFSET,
): { x: number; y: number; z: number } {
  return { x: point.x, y: sampleHeight(point.x, point.z) + offset, z: point.z };
}

/** Lazy presentation-only view of the world-owned spine. It never enters generation/collision. */
export class RiverSpineDebugView {
  private root?: THREE.Group;
  private visibility = { macro: true, meandered: true, connectors: true };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly spine: RiverSpine = referenceWorldRiverSpine,
    private readonly sampleHeight: TerrainHeightSampler = () => 0,
    private readonly macroSpine: RiverSpine = referenceWorldRiverMacroSpine,
    private readonly generation: MacroRiverGeneration = referenceWorldRiverGeneration,
    widthProfile?: RiverWidthProfile,
  ) {this.widthProfile=widthProfile??getReferenceRiverWidthProfile()}
  private readonly widthProfile:RiverWidthProfile;

  setLayerVisibility(value: Partial<typeof this.visibility>): void {
    Object.assign(this.visibility, value);
    if (!this.root) return;
    const names = { macro: "debug:river-macro-spine", meandered: "debug:river-centreline", connectors: "debug:river-displacement-connectors" } as const;
    for (const [key, name] of Object.entries(names)) { const object = this.root.getObjectByName(name); if (object) object.visible = this.visibility[key as keyof typeof this.visibility]; }
  }

  generationReadout(playerX = 0, playerZ = 0): Readonly<Record<string, string | number | boolean>> {
    const macro = this.macroSpine.nearestPointToRiver(playerX, playerZ), final = this.spine.nearestPointToRiver(playerX, playerZ);
    const localWidth=this.widthProfile.sampleAtDistance(final.distanceAlongRiver);
    return Object.freeze({ seed: String(this.generation.config.worldSeed), generationVersion: this.generation.config.generationVersion,
      macroControlPointCount: this.generation.macroControlPoints.length, macroLength: this.macroSpine.totalLength,
      meanderedLength: this.spine.totalLength, localMacroProgress: macro.progress, localFinalProgress: final.progress,
      localMeanderDisplacement: Math.hypot(final.position.x - macro.position.x, final.position.z - macro.position.z),
      amplitudeRange: this.generation.config.meanderAmplitudeRange.join("–"), wavelengthRange: this.generation.config.meanderWavelengthRange.join("–"),
      meanderRegionCount: this.generation.meanderRegions.length,
      activeRegionProfile: this.generation.meanderRegions.find(region => macro.distanceAlongRiver >= region.startDistance
        && macro.distanceAlongRiver <= region.endDistance)?.profile ?? "quiet",
      activeRegionalStrength: this.generation.meanderRegions.reduce((value, region) => Math.max(value,
        macro.distanceAlongRiver <= region.startDistance || macro.distanceAlongRiver >= region.endDistance ? 0 : region.strength), 0),
      correctionApplied: this.generation.correctionApplied,
      localFullWidth:localWidth.fullWidth,localTargetWidth:localWidth.targetWidth,localWidthSafetyClamped:localWidth.safetyClamped,
      widthMinimum:this.widthProfile.minimum,widthMaximum:this.widthProfile.maximum,widthMean:this.widthProfile.mean,
      widthClampedSamples:this.widthProfile.clampedSampleCount });
  }

  setMode(mode: RiverSpineDebugMode): void {
    this.disposeGeometry();
    if (mode === "off") return;

    const root = new THREE.Group();
    root.name = "debug:world-river-spine";
    const macroSmooth = Array.from({ length: RIVER_DEBUG_PATH_SAMPLES + 1 }, (_, index) => this.macroSpine.samplePosition(index / RIVER_DEBUG_PATH_SAMPLES));
    const macroLine = this.thickSegments(this.segmentPairs(macroSmooth), RIVER_DEBUG_STYLE.macroSpine, "debug:river-macro-spine");
    macroLine.visible = this.visibility.macro; root.add(macroLine);
    const connectors: { x: number; z: number }[] = [];
    for (const region of this.generation.meanderRegions) {
      const step = Math.max(6, (region.endDistance - region.startDistance) / (RIVER_DEBUG_CONNECTORS_PER_REGION - 1));
      for (let distance = region.startDistance; distance <= region.endDistance; distance += step) {
        const progress = this.macroSpine.progressAtDistance(distance);
        connectors.push(this.macroSpine.samplePosition(progress), this.spine.nearestPointToRiver(
          this.macroSpine.samplePosition(progress).x, this.macroSpine.samplePosition(progress).z).position);
      }
    }
    const connectorMesh = this.thickSegments(connectors, RIVER_DEBUG_STYLE.displacement, "debug:river-displacement-connectors");
    connectorMesh.visible = this.visibility.connectors; root.add(connectorMesh);
    const boundaries: { x: number; z: number }[] = [];
    for (const region of this.generation.meanderRegions) for (const distance of [region.startDistance, region.endDistance]) {
      const frame = this.macroSpine.sampleFrame(this.macroSpine.progressAtDistance(distance));
      boundaries.push({ x: frame.position.x - frame.normal.x * 5, z: frame.position.z - frame.normal.z * 5 },
        { x: frame.position.x + frame.normal.x * 5, z: frame.position.z + frame.normal.z * 5 });
    }
    root.add(this.thickSegments(boundaries, RIVER_DEBUG_STYLE.regionBoundary, "debug:river-meander-region-boundaries"));
    root.add(this.thickSegments(
      this.segmentPairs(this.spine.controlPoints),
      RIVER_DEBUG_STYLE.controlPolygon,
      "debug:river-control-polygon",
    ));
    root.add(this.points(this.spine.controlPoints, 0xff3b30, 1.05, 0.22, "debug:river-control-points"));

    const smooth = Array.from({ length: RIVER_DEBUG_PATH_SAMPLES + 1 }, (_, index) => this.spine.samplePosition(index / RIVER_DEBUG_PATH_SAMPLES));
    const finalLine = this.thickSegments(
      this.segmentPairs(smooth),
      RIVER_DEBUG_STYLE.centreline,
      "debug:river-centreline",
    );
    finalLine.visible = this.visibility.meandered; root.add(finalLine);

    if (mode === "ribbon" || mode === "detailed") {
      root.add(this.ribbon(mode === "detailed" ? RIVER_DEBUG_STYLE.detailedRibbonOpacity : RIVER_DEBUG_STYLE.ribbonOpacity));
      root.add(this.chunkGrid());
    }

    if (mode === "detailed") {
      const offsetGuide = (additionalOffset: number): { x: number; z: number }[] => Array.from(
        { length: RIVER_DEBUG_PATH_SAMPLES + 1 },
        (_, index) => {
          const progress = index / RIVER_DEBUG_PATH_SAMPLES;
          const frame = this.spine.sampleFrame(progress);
          const half=sampleRiverWidth(this.widthProfile,progress*this.spine.totalLength,this.spine).halfWidth;
          const side=additionalOffset<0||Object.is(additionalOffset,-0)?-1:1;
          const offset=side*(half+Math.abs(additionalOffset));
          return { x: frame.position.x + frame.normal.x * offset, z: frame.position.z + frame.normal.z * offset };
        },
      );
      const channelEdges = [0, -0]
        .flatMap(offset => this.segmentPairs(offsetGuide(offset)));
      const lipEdges = [WORLD_RIVER_CARVING.shoreTransitionWidth, -WORLD_RIVER_CARVING.shoreTransitionWidth]
        .flatMap(offset => this.segmentPairs(offsetGuide(offset)));
      const outer = WORLD_RIVER_CARVING.bankWidth + WORLD_RIVER_CARVING.falloffWidth;
      const falloffEdges = [outer, -outer].flatMap(offset => this.segmentPairs(offsetGuide(offset)));
      root.add(this.thickSegments(channelEdges, RIVER_DEBUG_STYLE.channelEdge, "debug:river-channel-edges"));
      root.add(this.thickSegments(lipEdges, RIVER_DEBUG_STYLE.lipEdge, "debug:river-lip-edges"));
      const inner = WORLD_RIVER_CARVING.bankWidth;
      const innerBankEdges = [inner, -inner].flatMap(offset => this.segmentPairs(offsetGuide(offset)));
      root.add(this.thickSegments(innerBankEdges, RIVER_DEBUG_STYLE.innerBankEdge, "debug:river-inner-bank-edges"));
      root.add(this.thickSegments(falloffEdges, RIVER_DEBUG_STYLE.falloffEdge, "debug:river-falloff-edges"));
      const diagnostics=this.widthProfile.samples.filter((_,index)=>index%Math.max(1,Math.ceil(this.widthProfile.samples.length/128))===0);
      const crossSections=diagnostics.flatMap(sample=>{const frame=this.spine.sampleFrame(this.spine.progressAtDistance(sample.distance));return[
        {x:frame.position.x-frame.normal.x*sample.halfWidth,z:frame.position.z-frame.normal.z*sample.halfWidth},
        {x:frame.position.x+frame.normal.x*sample.halfWidth,z:frame.position.z+frame.normal.z*sample.halfWidth}]});
      root.add(this.thickSegments(crossSections,RIVER_DEBUG_STYLE.channelEdge,"debug:river-width-cross-sections"));
      const targets=diagnostics.flatMap(sample=>{const frame=this.spine.sampleFrame(this.spine.progressAtDistance(sample.distance));return[
        {x:frame.position.x-frame.normal.x*sample.targetWidth/2,z:frame.position.z-frame.normal.z*sample.targetWidth/2},
        {x:frame.position.x+frame.normal.x*sample.targetWidth/2,z:frame.position.z+frame.normal.z*sample.targetWidth/2}]});
      root.add(this.thickSegments(targets,RIVER_DEBUG_STYLE.lipEdge,"debug:river-width-target-cross-sections"));
      const clamped=diagnostics.filter(sample=>sample.safetyClamped).map(sample=>this.spine.sampleAtDistance(sample.distance));
      root.add(this.points(clamped,0xff1744,.35,.38,"debug:river-width-safety-clamps"));
      const waterMarkCount = Math.min(RIVER_DEBUG_WATER_SAMPLE_CAP, Math.floor(this.spine.totalLength / WORLD_RIVER_WATER_SAMPLE_SPACING) + 1);
      const marks = Array.from(
        { length: waterMarkCount },
        (_, index) => this.spine.sampleAtDistance(waterMarkCount === 1 ? 0 : index / (waterMarkCount - 1) * this.spine.totalLength),
      );
      root.add(this.points(marks, 0xffffff, 0.18, 0.3, "debug:river-water-samples"));

      const tangents: { x: number; z: number }[] = [];
      const normals: { x: number; z: number }[] = [];
      const frameStep = this.spine.totalLength / Math.max(1, RIVER_DEBUG_FRAME_SAMPLE_CAP - 1);
      for (let distance = 0; distance <= this.spine.totalLength + 1e-6; distance += frameStep) {
        const frame = this.spine.sampleFrame(this.spine.progressAtDistance(distance));
        const p = frame.position;
        tangents.push(p, { x: p.x + frame.tangent.x * 5, z: p.z + frame.tangent.z * 5 });
        normals.push(p, { x: p.x + frame.normal.x * 4, z: p.z + frame.normal.z * 4 });
      }
      root.add(this.thickSegments(tangents, RIVER_DEBUG_STYLE.tangent, "debug:river-tangents"));
      root.add(this.thickSegments(normals, RIVER_DEBUG_STYLE.normal, "debug:river-normals"));

      const boxes: { x: number; z: number }[] = [];
      const boundsStep = Math.max(1, Math.ceil(this.spine.indexedSegments.length / RIVER_DEBUG_INDEX_BOUNDS_CAP));
      for (const { bounds } of this.spine.indexedSegments.filter((segment) => segment.index % boundsStep === 0)) {
        const a = { x: bounds.minX, z: bounds.minZ };
        const b = { x: bounds.maxX, z: bounds.minZ };
        const c = { x: bounds.maxX, z: bounds.maxZ };
        const d = { x: bounds.minX, z: bounds.maxZ };
        boxes.push(a, b, b, c, c, d, d, a);
      }
      root.add(this.thickSegments(boxes, RIVER_DEBUG_STYLE.indexedBounds, "debug:river-indexed-bounds"));
    }

    this.root = root;
    this.scene.add(root);
  }

  dispose(): void {
    this.disposeGeometry();
  }

  private segmentPairs(points: readonly { x: number; z: number }[]): { x: number; z: number }[] {
    return points.flatMap((point, index) => index ? [points[index - 1]!, point] : []);
  }

  /** Builds every category into one terrain-draped, world-space strip mesh. */
  private thickSegments(
    points: readonly { x: number; z: number }[],
    style: { readonly color: number; readonly width: number; readonly offset: number },
    name: string,
  ): THREE.Mesh {
    const vertices: number[] = [];
    const indices: number[] = [];
    for (let index = 0; index + 1 < points.length; index += 2) {
      const start = points[index]!;
      const end = points[index + 1]!;
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz);
      if (length === 0) continue;
      const sideX = (-dz / length) * style.width * 0.5;
      const sideZ = (dx / length) * style.width * 0.5;
      const corners = [
        { x: start.x + sideX, z: start.z + sideZ },
        { x: start.x - sideX, z: start.z - sideZ },
        { x: end.x + sideX, z: end.z + sideZ },
        { x: end.x - sideX, z: end.z - sideZ },
      ];
      const base = vertices.length / 3;
      for (const corner of corners) {
        const placed = placeRiverDebugPoint(corner, this.sampleHeight, style.offset);
        vertices.push(placed.x, placed.y, placed.z);
      }
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({
      color: style.color,
      side: THREE.DoubleSide,
      fog: false,
      depthTest: true,
      depthWrite: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.renderOrder = 200;
    return mesh;
  }

  private points(
    points: readonly { x: number; z: number }[],
    color: number,
    size: number,
    y: number,
    name: string,
  ): THREE.Points {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => {
      const placed = placeRiverDebugPoint(point, this.sampleHeight, y);
      return new THREE.Vector3(placed.x, placed.y, placed.z);
    }));
    const material = new THREE.PointsMaterial({ color, size, fog: false, depthTest: true, sizeAttenuation: true });
    const result = new THREE.Points(geometry, material);
    result.name = name;
    result.renderOrder = 202;
    return result;
  }

  private ribbon(opacity: number): THREE.Mesh {
    const vertices: number[] = [];
    const indices: number[] = [];
    const samples = RIVER_DEBUG_RIBBON_SAMPLES;
    for (let index = 0; index <= samples; index += 1) {
      const frame = this.spine.sampleFrame(index / samples);
      const half = sampleRiverWidth(this.widthProfile,index/samples*this.spine.totalLength,this.spine).halfWidth;
      const left = placeRiverDebugPoint(
        { x: frame.position.x + frame.normal.x * half, z: frame.position.z + frame.normal.z * half },
        this.sampleHeight,
      );
      const right = placeRiverDebugPoint(
        { x: frame.position.x - frame.normal.x * half, z: frame.position.z - frame.normal.z * half },
        this.sampleHeight,
      );
      vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);
      if (index) {
        const a = (index - 1) * 2;
        const b = a + 1;
        const c = index * 2;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshBasicMaterial({
      color: 0x00b7ff,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      fog: false,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "debug:river-ribbon";
    mesh.renderOrder = 199;
    return mesh;
  }

  private chunkGrid(): THREE.Mesh {
    const points: { x: number; z: number }[] = [];
    const min = -8 * CHUNK_SIZE;
    const max = 8 * CHUNK_SIZE;
    for (let coordinate = -8; coordinate <= 8; coordinate += 1) {
      const value = coordinate * CHUNK_SIZE;
      points.push({ x: value, z: min }, { x: value, z: max }, { x: min, z: value }, { x: max, z: value });
    }
    return this.thickSegments(points, RIVER_DEBUG_STYLE.chunkGrid, "debug:river-chunk-grid");
  }

  private disposeGeometry(): void {
    if (!this.root) return;
    this.scene.remove(this.root);
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.root.clear();
    this.root = undefined;
  }
}
