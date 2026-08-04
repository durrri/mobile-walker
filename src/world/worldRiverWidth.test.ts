import { describe, expect, it } from "vitest";
import { getWorldRiverOwner, resetWorldRiverOwners } from "./worldRiverOwner";
import { createRiverWidthProfile, RIVER_WIDTH_CONFIG, sampleRiverWidth } from "./worldRiverWidth";
import { RiverSpine } from "./riverSpineGeometry";
import { sampleWorldRiverWater } from "./worldRiverWater";
import { createWorldRiverCarvingContext, sampleWorldRiverCarving } from "./worldRiverCarving";
import { queryWorldRiverBridgeCandidates } from "./bridges";

describe("R9 authoritative river width profile",()=>{
  it("is immutable, deterministic and byte-equivalent after owner cache reset",()=>{
    const first=getWorldRiverOwner("r9-repeat");
    const bytes=JSON.stringify(first.widthProfile.samples);
    expect(Object.isFrozen(first.widthProfile.samples)).toBe(true);
    expect(()=>Object.assign(first.widthProfile.samples[0]!,{fullWidth:99})).toThrow();
    resetWorldRiverOwners();
    expect(JSON.stringify(getWorldRiverOwner("r9-repeat").widthProfile.samples)).toBe(bytes);
  });

  it("is seed-sensitive, finite, bounded and obeys the configured gradient",()=>{
    const a=getWorldRiverOwner("r9-a").widthProfile,b=getWorldRiverOwner("r9-b").widthProfile;
    expect(a.samples.map(s=>s.fullWidth)).not.toEqual(b.samples.map(s=>s.fullWidth));
    for(const [index,s] of a.samples.entries()){
      expect(Number.isFinite(s.fullWidth)).toBe(true);
      expect(s.fullWidth).toBeGreaterThanOrEqual(RIVER_WIDTH_CONFIG.minimumWidth);
      expect(s.fullWidth).toBeLessThanOrEqual(RIVER_WIDTH_CONFIG.maximumWidth);
      if(index)expect(Math.abs(s.fullWidth-a.samples[index-1]!.fullWidth)/(s.distance-a.samples[index-1]!.distance))
        .toBeLessThanOrEqual(RIVER_WIDTH_CONFIG.maximumGradient+1e-10);
    }
  });

  it("uses continuous biome blends, slow variation, and bounded measured-bend response",()=>{
    const p=getWorldRiverOwner("r9-components").widthProfile;
    for(let i=1;i<p.samples.length;i++)expect(Math.abs(p.samples[i]!.biomeMultiplier-p.samples[i-1]!.biomeMultiplier)).toBeLessThan(.08);
    expect(Math.max(...p.samples.map(s=>s.bendMultiplier))).toBeLessThanOrEqual(1+RIVER_WIDTH_CONFIG.bendCap+1e-10);
    expect(Math.min(...p.samples.map(s=>s.variationMultiplier))).toBeGreaterThanOrEqual(1-RIVER_WIDTH_CONFIG.variationAmplitude);
    expect(Math.max(...p.samples.map(s=>s.variationMultiplier))).toBeLessThanOrEqual(1+RIVER_WIDTH_CONFIG.variationAmplitude);
  });

  it("keeps every measured non-local sample pair safely separated",()=>{
    const owner=getWorldRiverOwner("r9-safety"),p=Array.from({length:Math.ceil(owner.spine.totalLength)+1},(_,i)=>owner.widthProfile.sampleAtDistance(Math.min(i,owner.spine.totalLength)));
    for(let a=0;a<p.length;a++)for(let b=a+1;b<p.length;b++)if(p[b]!.distance-p[a]!.distance>=RIVER_WIDTH_CONFIG.nonLocalDistance){
      const pa=owner.spine.samplePosition(owner.spine.progressAtDistance(p[a]!.distance));
      const pb=owner.spine.samplePosition(owner.spine.progressAtDistance(p[b]!.distance));
      const separation=Math.hypot(pa.x-pb.x,pa.z-pb.z);
      expect(p[a]!.halfWidth+p[b]!.halfWidth+RIVER_WIDTH_CONFIG.minimumDrySeparation).toBeLessThanOrEqual(separation+1e-8);
    }
  });

  it("rejects missing and mismatched authoritative profiles",()=>{
    const owner=getWorldRiverOwner("r9-profile-owner"),other=getWorldRiverOwner("r9-profile-other");
    expect(()=>sampleRiverWidth(owner.widthProfile,1,other.spine)).toThrow(/does not belong/);
    const explicit=new RiverSpine([{x:0,z:0},{x:0,z:40}]);
    expect(()=>createWorldRiverCarvingContext({minX:-1,maxX:1,minZ:0,maxZ:10},explicit)).toThrow(/profile is required/);
    const profile=createRiverWidthProfile("explicit",explicit);
    expect(createWorldRiverCarvingContext({minX:-1,maxX:1,minZ:0,maxZ:10},explicit,profile).widthProfile.identity).toBe(profile.identity);
  });

  it("makes carving, water and bridge generation consume the same local width",()=>{
    const owner=getWorldRiverOwner("r9-consumers"),d=owner.spine.totalLength*.5,frame=owner.spine.sampleFrame(owner.spine.progressAtDistance(d));
    const expected=sampleRiverWidth(owner.widthProfile,d,owner.spine).halfWidth;
    const water=sampleWorldRiverWater(frame.position.x,frame.position.z,owner.spine,owner.widthProfile);
    const context=createWorldRiverCarvingContext({minX:frame.position.x-1,maxX:frame.position.x+1,minZ:frame.position.z-1,maxZ:frame.position.z+1},owner.spine,owner.widthProfile);
    expect(water.halfWidth).toBeCloseTo(expected,8);
    expect(sampleWorldRiverCarving(frame.position.x,frame.position.z,context)!.waterHalfWidth).toBeCloseTo(expected,5);
    const candidates=queryWorldRiverBridgeCandidates(owner.seed,owner.spine.bounds,owner.spine,owner.widthProfile);
    for(const candidate of candidates)expect(candidate.waterHalfWidth).toBeCloseTo(sampleRiverWidth(owner.widthProfile,candidate.riverDistance,owner.spine).halfWidth,8);
  });
});
