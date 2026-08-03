import * as THREE from "three";
import { CHUNK_SIZE } from "../world/chunkCoordinates";
import { worldRiverSpine, type RiverSpine } from "../world/worldRiverSpine";
import { WORLD_RIVER_CARVING } from "../world/worldRiverCarving";
import { WORLD_RIVER_WATER_SAMPLE_SPACING } from "../world/worldRiverWater";

export type RiverSpineDebugMode = "off" | "spine" | "ribbon" | "detailed";
export type TerrainHeightSampler = (worldX: number, worldZ: number) => number;
export const RIVER_SPINE_DEBUG_SURFACE_OFFSET = 0.08;

export const RIVER_DEBUG_STYLE = {
  centreline: { color: 0x00f5ff, width: 0.24, offset: 0.18 },
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

  constructor(
    private readonly scene: THREE.Scene,
    private readonly spine: RiverSpine = worldRiverSpine,
    private readonly sampleHeight: TerrainHeightSampler = () => 0,
  ) {}

  setMode(mode: RiverSpineDebugMode): void {
    this.disposeGeometry();
    if (mode === "off") return;

    const root = new THREE.Group();
    root.name = "debug:world-river-spine";
    root.add(this.thickSegments(
      this.segmentPairs(this.spine.controlPoints),
      RIVER_DEBUG_STYLE.controlPolygon,
      "debug:river-control-polygon",
    ));
    root.add(this.points(this.spine.controlPoints, 0xff3b30, 1.05, 0.22, "debug:river-control-points"));

    const smooth = Array.from({ length: 401 }, (_, index) => this.spine.samplePosition(index / 400));
    root.add(this.thickSegments(
      this.segmentPairs(smooth),
      RIVER_DEBUG_STYLE.centreline,
      "debug:river-centreline",
    ));

    if (mode === "ribbon" || mode === "detailed") {
      root.add(this.ribbon(WORLD_RIVER_CARVING.halfWidth * 2, mode === "detailed" ? RIVER_DEBUG_STYLE.detailedRibbonOpacity : RIVER_DEBUG_STYLE.ribbonOpacity));
      root.add(this.chunkGrid());
    }

    if (mode === "detailed") {
      const offsetGuide = (offset: number): { x: number; z: number }[] => Array.from(
        { length: 401 },
        (_, index) => {
          const frame = this.spine.sampleFrame(index / 400);
          return { x: frame.position.x + frame.normal.x * offset, z: frame.position.z + frame.normal.z * offset };
        },
      );
      const channelEdges = [WORLD_RIVER_CARVING.halfWidth, -WORLD_RIVER_CARVING.halfWidth]
        .flatMap(offset => this.segmentPairs(offsetGuide(offset)));
      const outer = WORLD_RIVER_CARVING.halfWidth + WORLD_RIVER_CARVING.bankWidth + WORLD_RIVER_CARVING.falloffWidth;
      const falloffEdges = [outer, -outer].flatMap(offset => this.segmentPairs(offsetGuide(offset)));
      root.add(this.thickSegments(channelEdges, RIVER_DEBUG_STYLE.channelEdge, "debug:river-channel-edges"));
      root.add(this.thickSegments(channelEdges, RIVER_DEBUG_STYLE.lipEdge, "debug:river-lip-edges"));
      const inner = WORLD_RIVER_CARVING.halfWidth + WORLD_RIVER_CARVING.bankWidth;
      const innerBankEdges = [inner, -inner].flatMap(offset => this.segmentPairs(offsetGuide(offset)));
      root.add(this.thickSegments(innerBankEdges, RIVER_DEBUG_STYLE.innerBankEdge, "debug:river-inner-bank-edges"));
      root.add(this.thickSegments(falloffEdges, RIVER_DEBUG_STYLE.falloffEdge, "debug:river-falloff-edges"));
      const marks = Array.from(
        { length: Math.floor(this.spine.totalLength / WORLD_RIVER_WATER_SAMPLE_SPACING) + 1 },
        (_, index) => this.spine.sampleAtDistance(index * WORLD_RIVER_WATER_SAMPLE_SPACING),
      );
      root.add(this.points(marks, 0xffffff, 0.18, 0.3, "debug:river-water-samples"));

      const tangents: { x: number; z: number }[] = [];
      const normals: { x: number; z: number }[] = [];
      for (let distance = 0; distance <= this.spine.totalLength; distance += 24) {
        const frame = this.spine.sampleFrame(this.spine.progressAtDistance(distance));
        const p = frame.position;
        tangents.push(p, { x: p.x + frame.tangent.x * 5, z: p.z + frame.tangent.z * 5 });
        normals.push(p, { x: p.x + frame.normal.x * 4, z: p.z + frame.normal.z * 4 });
      }
      root.add(this.thickSegments(tangents, RIVER_DEBUG_STYLE.tangent, "debug:river-tangents"));
      root.add(this.thickSegments(normals, RIVER_DEBUG_STYLE.normal, "debug:river-normals"));

      const boxes: { x: number; z: number }[] = [];
      for (const { bounds } of this.spine.indexedSegments.filter((segment) => segment.index % 8 === 0)) {
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

  private ribbon(width: number, opacity: number): THREE.Mesh {
    const vertices: number[] = [];
    const indices: number[] = [];
    const samples = 512;
    for (let index = 0; index <= samples; index += 1) {
      const frame = this.spine.sampleFrame(index / samples);
      const half = width / 2;
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
