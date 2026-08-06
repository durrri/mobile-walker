import { describe, expect, it } from "vitest";
import { CHUNK_SIZE } from "./chunkCoordinates";
import { RiverSpine, WORLD_RIVER_CONTROL_POINTS, worldRiverSpine } from "./worldRiverSpine";

const closePoint = (a:{x:number;z:number},b:{x:number;z:number},epsilon=.02) => {
  expect(Math.hypot(a.x-b.x,a.z-b.z)).toBeLessThan(epsilon);
};
const orientation = (a:{x:number;z:number},b:{x:number;z:number},c:{x:number;z:number}) =>
  (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
const intersects = (a:{x:number;z:number},b:{x:number;z:number},c:{x:number;z:number},d:{x:number;z:number}) =>
  orientation(a,b,c)*orientation(a,b,d)<0 && orientation(c,d,a)*orientation(c,d,b)<0;

describe("world-owned river spine", () => {
  it("interpolates endpoints and remains position/tangent continuous", () => {
    closePoint(worldRiverSpine.samplePosition(0),WORLD_RIVER_CONTROL_POINTS[0]!,1e-8);
    closePoint(worldRiverSpine.samplePosition(1),WORLD_RIVER_CONTROL_POINTS.at(-1)!,1e-8);
    for (const [index, point] of WORLD_RIVER_CONTROL_POINTS.entries()) {
      const progress = worldRiverSpine.progressAtControlPoint(index);
      closePoint(worldRiverSpine.samplePosition(progress),point,.002);
      if (index === 0 || index === WORLD_RIVER_CONTROL_POINTS.length - 1) continue;
      const a=worldRiverSpine.sampleFrame(progress-1e-5),b=worldRiverSpine.sampleFrame(progress+1e-5);
      expect(a.tangent.x*b.tangent.x+a.tangent.z*b.tangent.z).toBeGreaterThan(.999);
    }
    expect(Object.values(worldRiverSpine.sampleTangent(0)).every(Number.isFinite)).toBe(true);
    expect(Object.values(worldRiverSpine.sampleTangent(1)).every(Number.isFinite)).toBe(true);
  });

  it("returns deterministic orthonormal frames including a diagonal reach", () => {
    let diagonal=false;
    for(let index=0;index<=100;index+=1){const frame=worldRiverSpine.sampleFrame(index/100);
      expect(Math.hypot(frame.tangent.x,frame.tangent.z)).toBeCloseTo(1,6);
      expect(Math.hypot(frame.normal.x,frame.normal.z)).toBeCloseTo(1,6);
      expect(frame.tangent.x*frame.normal.x+frame.tangent.z*frame.normal.z).toBeCloseTo(0,8);
      expect(frame.normal).toEqual({x:-frame.tangent.z,z:frame.tangent.x});
      expect(Object.values(frame.tangent).every(Number.isFinite)).toBe(true);
      diagonal ||= Math.abs(frame.tangent.x)>.2;
    }
    expect(diagonal).toBe(true);
  });

  it("has bounded overshoot and no sampled self-intersection", () => {
    const samples=Array.from({length:201},(_,i)=>worldRiverSpine.samplePosition(i/200));
    for(const point of samples){expect(point.x).toBeGreaterThanOrEqual(-2000);expect(point.x).toBeLessThanOrEqual(2000);expect(point.z).toBeGreaterThanOrEqual(-10001);expect(point.z).toBeLessThanOrEqual(1);}
    for(let a=0;a<samples.length-1;a+=1)for(let b=a+2;b<samples.length-1;b+=1)expect(intersects(samples[a]!,samples[a+1]!,samples[b]!,samples[b+1]!)).toBe(false);
  });

  it("provides one monotonic, approximately distance-uniform lookup", () => {
    const direct=Math.hypot(WORLD_RIVER_CONTROL_POINTS.at(-1)!.x-WORLD_RIVER_CONTROL_POINTS[0]!.x,WORLD_RIVER_CONTROL_POINTS.at(-1)!.z-WORLD_RIVER_CONTROL_POINTS[0]!.z);
    expect(worldRiverSpine.totalLength).toBeGreaterThan(direct); expect(worldRiverSpine.lookupBuildCount).toBe(1);
    const chordLengths=[];let previous=worldRiverSpine.sampleAtDistance(0);
    for(let d=5;d<worldRiverSpine.totalLength;d+=5){const current=worldRiverSpine.sampleAtDistance(d);chordLengths.push(Math.hypot(current.x-previous.x,current.z-previous.z));previous=current;}
    // Euclidean chords shorten through the fixture's broadest turn even though
    // the sampled path distance remains five world units.
    expect(Math.max(...chordLengths)-Math.min(...chordLengths)).toBeLessThan(1.1);
    for(let p=0;p<=1;p+=.05)expect(worldRiverSpine.progressAtDistance(worldRiverSpine.distanceAtProgress(p))).toBeCloseTo(p,10);
    expect(worldRiverSpine.samplePosition(Number.NaN)).toEqual(worldRiverSpine.samplePosition(0));
    expect(worldRiverSpine.samplePosition(Infinity)).toEqual(worldRiverSpine.samplePosition(1));
  });

  it("refines nearest points and reports deterministic signed sides", () => {
    const frame=worldRiverSpine.sampleFrame(.47), on=worldRiverSpine.nearestPointToRiver(frame.position.x,frame.position.z);
    expect(on.distanceToRiver).toBeLessThan(.002);expect(on.distanceToRiver).toBeLessThanOrEqual(on.coarseDistanceToRiver+.001);
    const left=worldRiverSpine.nearestPointToRiver(frame.position.x+frame.normal.x*3,frame.position.z+frame.normal.z*3);
    const right=worldRiverSpine.nearestPointToRiver(frame.position.x-frame.normal.x*3,frame.position.z-frame.normal.z*3);
    expect(left.signedSide).toBeGreaterThan(0);expect(right.signedSide).toBeLessThan(0);
    closePoint(left.tangent,worldRiverSpine.sampleTangent(left.progress),1e-8);
    const far=worldRiverSpine.nearestPointToRiver(1e6,-1e6);expect(Object.values(far).flatMap(v=>typeof v==="object"?Object.values(v):[v]).every(Number.isFinite)).toBe(true);
    expect(worldRiverSpine.nearestPointToRiver(30,30)).toEqual(worldRiverSpine.nearestPointToRiver(30,30));
  });

  it("spatially queries ordered world intervals with margin and adjacent bounds", () => {
    expect(worldRiverSpine.queryRiverSegments({minX:500,maxX:516,minZ:500,maxZ:516})).toEqual([]);
    const fixture=worldRiverSpine.samplePosition(.25);
    const crossed=worldRiverSpine.queryRiverSegments({minX:fixture.x-8,maxX:fixture.x+8,minZ:fixture.z-8,maxZ:fixture.z+8});expect(crossed.length).toBeGreaterThan(0);
    expect(crossed.map(s=>s.index)).toEqual([...crossed].map(s=>s.index).sort((a,b)=>a-b));
    const outside={minX:fixture.x+10,maxX:fixture.x+12,minZ:fixture.z-2,maxZ:fixture.z+2};
    const without=worldRiverSpine.queryRiverSegments(outside);
    const withMargin=worldRiverSpine.queryRiverSegments(outside,12);expect(withMargin.length).toBeGreaterThan(without.length);
    const boundary=worldRiverSpine.samplePosition(.25), chunkX=Math.floor(boundary.x/CHUNK_SIZE), chunkZ=Math.floor(boundary.z/CHUNK_SIZE);
    const bounds=(x:number)=>({minX:x*CHUNK_SIZE,maxX:(x+1)*CHUNK_SIZE,minZ:chunkZ*CHUNK_SIZE,maxZ:(chunkZ+1)*CHUNK_SIZE});
    const first=worldRiverSpine.queryRiverSegments(bounds(chunkX),1), second=worldRiverSpine.queryRiverSegments(bounds(chunkX+1),1);
    expect(first.length+second.length).toBeGreaterThan(0);
    expect(worldRiverSpine.queryRiverSegments(bounds(chunkX),1)).toEqual(first);
  });

  it("is independent of seeds, chunks, repositories, streaming order, and ownership", () => {
    const another=new RiverSpine(WORLD_RIVER_CONTROL_POINTS);
    expect(another.samplePosition(.381)).toEqual(worldRiverSpine.samplePosition(.381));
    expect("ownerChunk" in WORLD_RIVER_CONTROL_POINTS[0]!).toBe(false);
    expect("ownerChunk" in worldRiverSpine.indexedSegments[0]!).toBe(false);
    expect(worldRiverSpine.controlPoints).not.toHaveProperty("chunkCoordinate");
    const columns=new Set(Array.from({length:1001},(_,i)=>Math.floor(worldRiverSpine.samplePosition(i/1000).x/CHUNK_SIZE)));
    expect(columns.size).toBeGreaterThanOrEqual(2);
    const queries=[{minX:-32,maxX:-16,minZ:-2400,maxZ:-2384},{minX:16,maxX:32,minZ:-560,maxZ:-544}];
    const forward=queries.map(q=>worldRiverSpine.queryRiverSegments(q).map(s=>s.index));
    const reverse=[...queries].reverse().map(q=>worldRiverSpine.queryRiverSegments(q).map(s=>s.index)).reverse();expect(reverse).toEqual(forward);
  });

  it("handles benchmark-scale bounded query batches", () => {
    const started=performance.now();let checksum=0;
    for(let i=0;i<1000;i+=1){const p=worldRiverSpine.sampleAtDistance((i%160)/159*worldRiverSpine.totalLength);checksum+=worldRiverSpine.nearestPointToRiver(p.x+((i%7)-3),p.z+((i%5)-2)).distanceToRiver;}
    for(let i=0;i<1000;i+=1){const p=worldRiverSpine.sampleAtDistance((i%160)/159*worldRiverSpine.totalLength);checksum+=worldRiverSpine.queryRiverSegments({minX:p.x-8,maxX:p.x+8,minZ:p.z-8,maxZ:p.z+8}).length;}
    expect(checksum).toBeGreaterThan(0);expect(performance.now()-started).toBeLessThan(1500);
  });
});
