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
    for(const worldSeed of [1,2,3,5,8,13,21,34,55,89,144,233]){
      const generated=getWorldRiverGeneration({...DEFAULT_RIVER_GENERATION_CONFIG,worldSeed});
      expect(validateSmoothedSpineSeparation(generated.macroSpine,generated.config).valid).toBe(true);
      expect(validateSmoothedSpineSeparation(generated.meanderedSpine,generated.config).valid).toBe(true);
    }
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
    const onBoundary=(vertex:typeof vertices[number])=>Math.abs(vertex.x-bend.x*CHUNK_SIZE)<1e-8||Math.abs(vertex.x-(bend.x+1)*CHUNK_SIZE)<1e-8||Math.abs(vertex.z-bend.z*CHUNK_SIZE)<1e-8||Math.abs(vertex.z-(bend.z+1)*CHUNK_SIZE)<1e-8;
    for(const [edge,count] of edgeUse){const [a,b]=edge.split(",").map(Number);if(count===1&&onBoundary(vertices[a!]!)&&onBoundary(vertices[b!]!))continue;expect(count).toBe(2);}
  },120_000);
});
