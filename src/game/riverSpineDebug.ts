import * as THREE from "three";
import { CHUNK_SIZE } from "../world/chunkCoordinates";
import { worldRiverSpine, type RiverSpine } from "../world/worldRiverSpine";

export type RiverSpineDebugMode = "off" | "spine" | "ribbon" | "detailed";

/** Lazy presentation-only view of the world-owned spine. It never enters generation/collision. */
export class RiverSpineDebugView {
  private root?: THREE.Group;
  constructor(private readonly scene: THREE.Scene, private readonly spine: RiverSpine = worldRiverSpine) {}

  setMode(mode: RiverSpineDebugMode): void {
    this.disposeGeometry();
    if (mode === "off") return;
    const root = new THREE.Group(); root.name = "debug:world-river-spine";
    root.add(this.line(this.spine.controlPoints.flatMap((point, index, points) => index ? [points[index - 1]!, point] : []), 0xff9d00, 0.12));
    root.add(this.points(this.spine.controlPoints, 0xff3b30, 0.75, 0.2));
    const smooth = Array.from({ length: 401 }, (_, index) => this.spine.samplePosition(index / 400));
    root.add(this.line(smooth.flatMap((point, index) => index ? [smooth[index - 1]!, point] : []), 0x00f5ff, 0.18));
    if (mode === "ribbon" || mode === "detailed") {
      root.add(this.ribbon(4));
      root.add(this.chunkGrid());
    }
    if (mode === "detailed") {
      const marks = Array.from({ length: Math.floor(this.spine.totalLength / 8) + 1 }, (_, index) => this.spine.sampleAtDistance(index * 8));
      root.add(this.points(marks, 0xffffff, 0.24, 0.28));
      const tangents: { x: number; z: number }[] = [], normals: { x: number; z: number }[] = [];
      for (let distance = 0; distance <= this.spine.totalLength; distance += 24) {
        const frame = this.spine.sampleFrame(this.spine.progressAtDistance(distance)), p = frame.position;
        tangents.push(p, { x: p.x + frame.tangent.x * 5, z: p.z + frame.tangent.z * 5 });
        normals.push(p, { x: p.x + frame.normal.x * 4, z: p.z + frame.normal.z * 4 });
      }
      root.add(this.line(tangents, 0x45ff65, 0.32)); root.add(this.line(normals, 0xff45e6, 0.34));
      const boxes: { x: number; z: number }[] = [];
      for (const { bounds } of this.spine.indexedSegments.filter(segment => segment.index % 8 === 0)) {
        const a={x:bounds.minX,z:bounds.minZ},b={x:bounds.maxX,z:bounds.minZ},c={x:bounds.maxX,z:bounds.maxZ},d={x:bounds.minX,z:bounds.maxZ};
        boxes.push(a,b,b,c,c,d,d,a);
      }
      root.add(this.line(boxes, 0xffe600, 0.08));
    }
    this.root = root; this.scene.add(root);
  }

  dispose(): void { this.disposeGeometry(); }

  private line(points: readonly {x:number;z:number}[], color: number, y: number): THREE.LineSegments {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map(point => new THREE.Vector3(point.x, y, point.z)));
    const material = new THREE.LineBasicMaterial({ color, fog: false, depthTest: false });
    const line = new THREE.LineSegments(geometry, material); line.renderOrder = 200; return line;
  }
  private points(points: readonly {x:number;z:number}[], color: number, size: number, y: number): THREE.Points {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map(point => new THREE.Vector3(point.x, y, point.z)));
    const material = new THREE.PointsMaterial({ color, size, fog: false, depthTest: false, sizeAttenuation: true });
    const result = new THREE.Points(geometry, material); result.renderOrder = 202; return result;
  }
  private ribbon(width: number): THREE.Mesh {
    const vertices: number[] = [], indices: number[] = [], samples = 512;
    for (let index = 0; index <= samples; index += 1) {
      const frame = this.spine.sampleFrame(index / samples), half = width / 2;
      vertices.push(frame.position.x + frame.normal.x*half, .26, frame.position.z + frame.normal.z*half,
        frame.position.x - frame.normal.x*half, .26, frame.position.z - frame.normal.z*half);
      if (index) { const a=(index-1)*2,b=a+1,c=index*2,d=c+1; indices.push(a,b,c,b,d,c); }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices,3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const material = new THREE.MeshBasicMaterial({ color: 0x00b7ff, transparent:true, opacity:.72, side:THREE.DoubleSide, fog:false, depthTest:false, depthWrite:false });
    const mesh = new THREE.Mesh(geometry,material); mesh.name="debug:river-ribbon"; mesh.renderOrder=199; return mesh;
  }
  private chunkGrid(): THREE.LineSegments {
    const points:{x:number;z:number}[]=[]; const min=-8*CHUNK_SIZE,max=8*CHUNK_SIZE;
    for(let coordinate=-8;coordinate<=8;coordinate+=1){const value=coordinate*CHUNK_SIZE;points.push({x:value,z:min},{x:value,z:max},{x:min,z:value},{x:max,z:value});}
    return this.line(points,0x6c63ff,.1);
  }
  private disposeGeometry(): void {
    if (!this.root) return;
    this.scene.remove(this.root);
    this.root.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) { object.geometry.dispose(); const materials=Array.isArray(object.material)?object.material:[object.material]; materials.forEach(material=>material.dispose()); } });
    this.root.clear(); this.root=undefined;
  }
}
