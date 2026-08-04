import { sampleBiome, type BiomeId, type BiomeWeights } from "./biomes";
import { hashFloat, normalizeSeed } from "./random";
import type { RiverSpine } from "./riverSpineGeometry";

/** R9 stores full rendered-water width, in world units. */
export interface RiverWidthConfig {
  readonly version: number; readonly baseWidth: number; readonly sampleSpacing: number;
  readonly biomeSmoothingDistance: number; readonly biomeMultipliers: Readonly<Record<BiomeId, number>>;
  readonly variationAmplitude: number; readonly variationScale: number;
  readonly bendThreshold: number; readonly bendResponse: number; readonly bendCap: number;
  readonly minimumWidth: number; readonly maximumWidth: number; readonly minimumDrySeparation: number;
  readonly nonLocalDistance: number; readonly safetyFeatherDistance: number; readonly maximumGradient: number;
}

export const RIVER_WIDTH_CONFIG: Readonly<RiverWidthConfig> = Object.freeze({
  version: 9, baseWidth: 4, sampleSpacing: 2, biomeSmoothingDistance: 28,
  biomeMultipliers: Object.freeze({ mountain: .78, highlands: .88, forest: 1, plains: 1.15, wetland: 1.3,
    // Lake is separate basin logic; it deliberately behaves as transitional river terrain.
    lake: 1 }),
  variationAmplitude: .065, variationScale: 72, bendThreshold: .035, bendResponse: 3.2, bendCap: .18,
  minimumWidth: 2.8, maximumWidth: 5.6, minimumDrySeparation: 2,
  nonLocalDistance: 20, safetyFeatherDistance: 12, maximumGradient: .035,
});

export interface RiverWidthSample {
  readonly distance: number; readonly fullWidth: number; readonly halfWidth: number;
  readonly biomeMultiplier: number; readonly variationMultiplier: number; readonly bendMultiplier: number;
  readonly targetWidth: number; readonly safetyClamped: boolean;
}
export interface RiverWidthProfile {
  readonly identity: string; readonly config: Readonly<RiverWidthConfig>; readonly totalLength: number;
  readonly samples: readonly RiverWidthSample[]; readonly minimum: number; readonly maximum: number;
  readonly mean: number; readonly clampedSampleCount: number;
  sampleAtDistance(distance: number): RiverWidthSample;
  sampleAtProgress(progress: number): RiverWidthSample;
}

const registered = new WeakMap<RiverSpine, RiverWidthProfile>();
const clamp = (v:number, a:number, b:number):number => Math.max(a, Math.min(b, v));
const weightedBiome = (weights: BiomeWeights, c: RiverWidthConfig): number =>
  (Object.keys(c.biomeMultipliers) as BiomeId[]).reduce((sum, id) => sum + weights[id] * c.biomeMultipliers[id], 0);

/** Smooth, aperiodic value noise addressed only by global final-spine distance. */
function slowVariation(seed:number, distance:number, scale:number):number {
  const p=distance/scale, i=Math.floor(p), t=p-i, s=t*t*(3-2*t);
  return (hashFloat(seed,i,9001)*(1-s)+hashFloat(seed,i+1,9001)*s)*2-1;
}

export function createRiverWidthProfile(seedInput:number|string, spine:RiverSpine,
  config:Readonly<RiverWidthConfig>=RIVER_WIDTH_CONFIG):RiverWidthProfile {
  const seed=normalizeSeed(seedInput)^config.version, count=Math.max(1,Math.ceil(spine.totalLength/config.sampleSpacing));
  const distances=Array.from({length:count+1},(_,i)=>spine.totalLength*i/count);
  const rawBiome=distances.map(d=>{const p=spine.samplePosition(spine.progressAtDistance(d));return weightedBiome(sampleBiome(seedInput,p.x,p.z).weights,config)});
  const radius=Math.ceil(config.biomeSmoothingDistance/(spine.totalLength/count));
  const biome=rawBiome.map((_,i)=>{let sum=0,w=0;for(let j=Math.max(0,i-radius);j<=Math.min(count,i+radius);j++){const q=1-Math.abs(j-i)/(radius+1);sum+=rawBiome[j]!*q;w+=q}return sum/w});
  const bend=distances.map(d=>{const delta=Math.min(8,spine.totalLength*.03),a=spine.sampleFrame(spine.progressAtDistance(d-delta)).tangent,b=spine.sampleFrame(spine.progressAtDistance(d+delta)).tangent;
    const curvature=Math.acos(clamp(a.x*b.x+a.z*b.z,-1,1))/Math.max(1,delta*2);
    return 1+Math.min(config.bendCap,Math.max(0,curvature-config.bendThreshold)*config.bendResponse)});
  // Feather measured bend response so an apex cannot create shoulders.
  for(let pass=0;pass<2;pass++){const before=[...bend];for(let i=1;i<count;i++)bend[i]=before[i-1]!*.25+before[i]!*.5+before[i+1]!*.25}
  const target=distances.map((d,i)=>clamp(config.baseWidth*biome[i]!*(1+slowVariation(seed,d,config.variationScale)*config.variationAmplitude)*bend[i]!,config.minimumWidth,config.maximumWidth));
  const accepted=[...target], positions=distances.map(d=>spine.samplePosition(spine.progressAtDistance(d)));
  // Deterministic conservative pair correction. Both sides participate equally.
  const pairs:{a:number;b:number;cap:number}[]=[];
  for(let a=0;a<count;a++)for(let b=a+1;b<=count;b++)if(distances[b]!-distances[a]!>=config.nonLocalDistance){
    const separation=Math.hypot(positions[a]!.x-positions[b]!.x,positions[a]!.z-positions[b]!.z);
    if(separation < config.maximumWidth+config.minimumDrySeparation){pairs.push({a,b,cap:Math.max(config.minimumWidth,(separation-config.minimumDrySeparation))})}
  }
  for(let iteration=0;iteration<6;iteration++)for(const p of pairs){const excess=accepted[p.a]!+accepted[p.b]!-p.cap*2;if(excess>0){accepted[p.a]-=excess/2;accepted[p.b]-=excess/2}}
  // Safety pinches only propagate reductions; therefore feathering cannot invalidate a pair cap.
  const feather=Math.ceil(config.safetyFeatherDistance/(spine.totalLength/count));
  const constrained=[...accepted];for(let i=0;i<=count;i++)for(let j=Math.max(0,i-feather);j<=Math.min(count,i+feather);j++)accepted[j]=Math.min(accepted[j]!,target[j]!-(target[i]!-constrained[i]!)*(1-Math.abs(j-i)/(feather+1)));
  const maxStep=config.maximumGradient*(spine.totalLength/count);
  for(let pass=0;pass<4;pass++){for(let i=1;i<=count;i++)accepted[i]=Math.min(accepted[i]!,accepted[i-1]!+maxStep);for(let i=count-1;i>=0;i--)accepted[i]=Math.min(accepted[i]!,accepted[i+1]!+maxStep)}
  for(let i=0;i<=count;i++)accepted[i]=clamp(accepted[i]!,config.minimumWidth,config.maximumWidth);
  const samples=Object.freeze(distances.map((distance,i)=>Object.freeze({distance,fullWidth:accepted[i]!,halfWidth:accepted[i]!/2,biomeMultiplier:biome[i]!,variationMultiplier:1+slowVariation(seed,distance,config.variationScale)*config.variationAmplitude,bendMultiplier:bend[i]!,targetWidth:target[i]!,safetyClamped:accepted[i]!<target[i]!-1e-8})));
  const interpolate=(distance:number):RiverWidthSample=>{const d=clamp(distance,0,spine.totalLength),p=d/spine.totalLength*count,i=Math.min(count-1,Math.floor(p)),t=p-i,a=samples[i]!,b=samples[i+1]!;return Object.freeze({distance:d,fullWidth:a.fullWidth+(b.fullWidth-a.fullWidth)*t,halfWidth:a.halfWidth+(b.halfWidth-a.halfWidth)*t,biomeMultiplier:a.biomeMultiplier+(b.biomeMultiplier-a.biomeMultiplier)*t,variationMultiplier:a.variationMultiplier+(b.variationMultiplier-a.variationMultiplier)*t,bendMultiplier:a.bendMultiplier+(b.bendMultiplier-a.bendMultiplier)*t,targetWidth:a.targetWidth+(b.targetWidth-a.targetWidth)*t,safetyClamped:a.safetyClamped||b.safetyClamped})};
  const values=samples.map(s=>s.fullWidth);const profile:RiverWidthProfile=Object.freeze({identity:`width-v${config.version}:${normalizeSeed(seedInput)}:${JSON.stringify(config)}`,config,totalLength:spine.totalLength,samples,minimum:Math.min(...values),maximum:Math.max(...values),mean:values.reduce((a,b)=>a+b,0)/values.length,clampedSampleCount:samples.filter(s=>s.safetyClamped).length,sampleAtDistance:interpolate,sampleAtProgress:(p:number)=>interpolate(clamp(p,0,1)*spine.totalLength)});
  registered.set(spine,profile);return profile;
}

export function widthProfileForSpine(spine:RiverSpine):RiverWidthProfile|undefined{return registered.get(spine)}
export function sampleRiverWidth(spine:RiverSpine,distance:number):RiverWidthSample {
  return registered.get(spine)?.sampleAtDistance(distance) ?? Object.freeze({distance,fullWidth:RIVER_WIDTH_CONFIG.baseWidth,halfWidth:RIVER_WIDTH_CONFIG.baseWidth/2,biomeMultiplier:1,variationMultiplier:1,bendMultiplier:1,targetWidth:RIVER_WIDTH_CONFIG.baseWidth,safetyClamped:false});
}
