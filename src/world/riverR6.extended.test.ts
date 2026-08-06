import { describe, expect, it } from "vitest";
import { generateChunk, type GeneratedChunkData } from "./generateChunk";
import { RIVER_R6_FIXTURES } from "./riverR6Fixtures";
import { resetWorldGenerationCachesForDiagnostics } from "./worldGenerationDiagnostics";
import { tessellateWorldRiverWaterChunk, type WorldRiverWaterGeometry } from "./worldRiverWater";
import { DEFAULT_RIVER_GENERATION_CONFIG, getWorldRiverGeneration, validateSmoothedSpineSeparation } from "./worldRiverGeneration";
import { CHUNK_SIZE } from "./chunkCoordinates";
import { riverChunkAtProgress, riverSeamCrossing, strongestCurvatureProgress } from "./riverProceduralFixtures";
import { getWorldRiverOwner, resetWorldRiverOwners } from "./worldRiverOwner";
import { RIVER_WIDTH_CONFIG } from "./worldRiverWidth";

const seed = "r6-extended";
const key = (coordinate: { x: number; z: number }) => `${coordinate.x},${coordinate.z}`;
const independentOrder = (coordinates: readonly { x: number; z: number }[]) => {
  resetWorldGenerationCachesForDiagnostics();
  return new Map(coordinates.map(coordinate => [key(coordinate), structuredClone(generateChunk(seed, coordinate))]));
};

describe("R6 extended river validation", () => {
  it("keeps smoothed macro and final topology separated across representative seeds", () => {
    let eastRun=0,westRun=0,diagonalRun=0,downstreamRun=0,fallbacks=0;
    const compositions=new Set<string>();
    for(const worldSeed of [1,2,3,5,8,13,21,34,55,89,144,233]){
      const generated=getWorldRiverGeneration({...DEFAULT_RIVER_GENERATION_CONFIG,worldSeed});
      expect(validateSmoothedSpineSeparation(generated.macroSpine,generated.config).valid).toBe(true);
      expect(validateSmoothedSpineSeparation(generated.meanderedSpine,generated.config).valid).toBe(true);
      fallbacks+=Number(generated.usedFallback);compositions.add(generated.macroRoutePlan.reaches.map(reach=>reach.behavior).join(","));
      let east=0,west=0,diagonal=0,downstream=0;
      for(let distance=0;distance<=generated.macroSpine.totalLength;distance+=20){const tangent=generated.macroSpine.sampleTangent(generated.macroSpine.progressAtDistance(distance));
        east=Math.abs(tangent.z)<.32&&tangent.x>.8?east+20:0;west=Math.abs(tangent.z)<.32&&tangent.x<-.8?west+20:0;
        diagonal=Math.abs(tangent.x)>.45&&tangent.z<-.45?diagonal+20:0;downstream=Math.abs(tangent.x)<.3&&tangent.z<-.9?downstream+20:0;
        eastRun=Math.max(eastRun,east);westRun=Math.max(westRun,west);diagonalRun=Math.max(diagonalRun,diagonal);downstreamRun=Math.max(downstreamRun,downstream);}
    }
    expect(eastRun).toBeGreaterThan(400);expect(westRun).toBeGreaterThan(400);expect(diagonalRun).toBeGreaterThan(500);expect(downstreamRun).toBeGreaterThan(500);
    expect(compositions.size).toBeGreaterThan(8);expect(fallbacks).toBeLessThanOrEqual(1);
  }, 120_000);
  it("compares independently generated snapshots across representative orders", () => {
    const coordinates = [...new Map(RIVER_R6_FIXTURES.map(f => [key(f.chunk), f.chunk])).values()];
    const orders = [coordinates, [...coordinates].reverse(),
      coordinates.filter((_, i) => i % 2 === 0).concat(coordinates.filter((_, i) => i % 2 === 1))];
    const snapshots = orders.map(independentOrder);
    for (const snapshot of snapshots.slice(1)) expect(snapshot).toEqual(snapshots[0]);
  }, 120_000);

  it("keeps the formerly problematic strongest-bend mesh buffers byte-for-byte stable", () => {
    const coordinate = RIVER_R6_FIXTURES.find(f => f.name === "strongest-bend")!.chunk;
    const generateIndependent = () => {
      resetWorldGenerationCachesForDiagnostics();
      const mesh = generateChunk(seed, coordinate).terrainMesh;
      return { positions: new Uint8Array(mesh.positions.buffer.slice(0)), indices: new Uint8Array(mesh.indices.buffer.slice(0)) };
    };
    const baseline = generateIndependent();
    for (let repetition = 0; repetition < 5; repetition += 1) expect(generateIndependent()).toEqual(baseline);
  }, 120_000);

  it("reproduces canonical chunk and water data after independent cache-cleared regeneration", () => {
    const fixtures = RIVER_R6_FIXTURES.filter(f => ["strongest-bend", "bridge", "dry-far"].includes(f.name));
    const regenerate = (): Map<string, { chunk: GeneratedChunkData; water: WorldRiverWaterGeometry }> => {
      resetWorldGenerationCachesForDiagnostics();
      return new Map(fixtures.map(fixture => [fixture.name, {
        chunk: structuredClone(generateChunk(seed, fixture.chunk)),
        water: structuredClone(tessellateWorldRiverWaterChunk(fixture.chunk)),
      }]));
    };
    const baseline = regenerate();
    for (let cycle = 0; cycle < 5; cycle += 1) expect(regenerate()).toEqual(baseline);
  }, 120_000);

  it("validates R9 width profiles across many seeds, gradients, hairpins, and interpolated dry separation", () => {
    let observedStrongBendOrClamp=false;
    for(const worldSeed of ["measure-river-scale","r9-ext-a","r9-ext-b","r9-ext-c","r9-ext-d","r9-ext-e","r9-ext-f",13,21,34,55]){
      resetWorldRiverOwners();
      const owner=getWorldRiverOwner(worldSeed),profile=owner.widthProfile;
      expect(profile.identity).toContain("width-v9");
      observedStrongBendOrClamp ||= owner.generation.meanderRegions.some(region=>region.profile==="strong")||profile.samples.some(sample=>sample.bendMultiplier>1.01)||profile.samples.some(sample=>sample.safetyClamped);
      for(let i=1;i<profile.samples.length;i++){
        const a=profile.samples[i-1]!,b=profile.samples[i]!;
        expect(Math.abs(b.fullWidth-a.fullWidth)/(b.distance-a.distance)).toBeLessThanOrEqual(RIVER_WIDTH_CONFIG.maximumGradient+1e-10);
      }
      const denseSampleCount=240,dense=Array.from({length:denseSampleCount+1},(_,index)=>profile.sampleAtDistance(index/denseSampleCount*owner.spine.totalLength));
      for(let a=0;a<dense.length;a++)for(let b=a+1;b<dense.length;b++){
        if(dense[b]!.distance-dense[a]!.distance<RIVER_WIDTH_CONFIG.nonLocalDistance)continue;
        const pa=owner.spine.samplePosition(owner.spine.progressAtDistance(dense[a]!.distance));
        const pb=owner.spine.samplePosition(owner.spine.progressAtDistance(dense[b]!.distance));
        const separation=Math.hypot(pa.x-pb.x,pa.z-pb.z);
        expect(dense[a]!.halfWidth+dense[b]!.halfWidth+RIVER_WIDTH_CONFIG.minimumDrySeparation).toBeLessThanOrEqual(separation+1e-8);
      }
    }
    expect(observedStrongBendOrClamp).toBe(true);
  },120_000);

  it("keeps R9 seam, topology, and generation-order snapshots stable through cache permutations", () => {
    const seam=riverSeamCrossing("x",0,"r9-ext-seam"),bend=riverChunkAtProgress(strongestCurvatureProgress("r9-ext-seam"),"r9-ext-seam");
    const coordinates=[seam.a,seam.b,bend];
    const orders=[coordinates,[bend,seam.b,seam.a],[seam.b,seam.a,bend]];
    const snapshots=orders.map(order=>{resetWorldGenerationCachesForDiagnostics();return order.map(coordinate=>structuredClone(generateChunk("r9-ext-seam",coordinate)));});
    expect(new Map(snapshots[1]!.map(chunk=>[key(chunk.coordinate),chunk]))).toEqual(new Map(snapshots[0]!.map(chunk=>[key(chunk.coordinate),chunk])));
    expect(new Map(snapshots[2]!.map(chunk=>[key(chunk.coordinate),chunk]))).toEqual(new Map(snapshots[0]!.map(chunk=>[key(chunk.coordinate),chunk])));
    const [left,right]=snapshots[0]!;
    const atSeam=(chunk:GeneratedChunkData)=>chunk.irregularTerrain!.vertices.filter(vertex=>Math.abs(vertex.x-seam.edge)<1e-8&&vertex.riverStripOffset!==undefined)
      .map(vertex=>`${vertex.x},${vertex.z},${vertex.height},${vertex.riverStripOffset}`).sort();
    expect(atSeam(left!)).toEqual(atSeam(right!));
    const topology=snapshots[0]!.find(chunk=>chunk.coordinate.x===bend.x&&chunk.coordinate.z===bend.z)!;
    const edgeUse=new Map<string,number>(),vertices=topology.irregularTerrain!.vertices,indices=topology.irregularTerrain!.indices;
    for(let index=0;index<indices.length;index+=3)for(let edge=0;edge<3;edge++){
      const a=indices[index+edge]!,b=indices[index+(edge+1)%3]!,edgeKey=a<b?`${a},${b}`:`${b},${a}`;
      edgeUse.set(edgeKey,(edgeUse.get(edgeKey)??0)+1);
    }
    const boundarySides=(vertex:typeof vertices[number])=>[
      Math.abs(vertex.x-bend.x*CHUNK_SIZE)<1e-8 ? "minX" : "",
      Math.abs(vertex.x-(bend.x+1)*CHUNK_SIZE)<1e-8 ? "maxX" : "",
      Math.abs(vertex.z-bend.z*CHUNK_SIZE)<1e-8 ? "minZ" : "",
      Math.abs(vertex.z-(bend.z+1)*CHUNK_SIZE)<1e-8 ? "maxZ" : "",
    ].filter(Boolean);
    const onSameBoundary=(a:typeof vertices[number],b:typeof vertices[number])=>boundarySides(a).some(side=>boundarySides(b).includes(side));
    for(const [edge,count] of edgeUse){const [a,b]=edge.split(",").map(Number);if(count===1&&onSameBoundary(vertices[a!]!,vertices[b!]!))continue;if(count!==2){
      const triangles:number[]=[];for(let index=0;index<indices.length;index+=3){const tri=[indices[index]!,indices[index+1]!,indices[index+2]!];for(let e=0;e<3;e++){const u=tri[e]!,v=tri[(e+1)%3]!;if((u===a&&v===b)||(u===b&&v===a))triangles.push(index/3);}}
      const va=vertices[a!]!,vb=vertices[b!]!;
      const equivalents=vertices.map((vertex,index)=>({vertex,index})).filter(({vertex})=>(Math.abs(vertex.x-va.x)<1e-8&&Math.abs(vertex.z-va.z)<1e-8)||(Math.abs(vertex.x-vb.x)<1e-8&&Math.abs(vertex.z-vb.z)<1e-8)).map(({vertex,index})=>({index,x:vertex.x,z:vertex.z,offset:vertex.riverStripOffset}));
      expect(count,JSON.stringify({chunk:bend,edge:[a,b],count,a:va,b:vb,boundarySides:[boundarySides(va),boundarySides(vb)],riverStripOffsets:[va.riverStripOffset,vb.riverStripOffset],triangles,equivalents,stage:"cleaned PSLG result"},null,2)).toBe(2);
    }}
  },120_000);
});
