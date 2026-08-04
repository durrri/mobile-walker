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
  /** Exact accepted spine this profile belongs to; identity mismatches are fatal. */
  readonly spine: RiverSpine;
  sampleAtDistance(distance: number): RiverWidthSample;
  sampleAtProgress(progress: number): RiverWidthSample;
}

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
  const accepted=[...target];
  // A dense final-spine resampling is indexed into bounded world-space cells.
  // Candidate records address the nearest profile samples conservatively.
  const denseSpacing=Math.min(1,config.sampleSpacing/2),denseCount=Math.ceil(spine.totalLength/denseSpacing);
  const dense=Array.from({length:denseCount+1},(_,i)=>{const distance=spine.totalLength*i/denseCount;return{distance,position:spine.samplePosition(spine.progressAtDistance(distance)),sample:Math.round(distance/spine.totalLength*count)}});
  const cellSize=config.maximumWidth+config.minimumDrySeparation,cells=new Map<string,number[]>(),pairs:{a:number;b:number;distanceA:number;distanceB:number;separation:number}[]=[];
  for(let i=0;i<dense.length;i++){const point=dense[i]!,cx=Math.floor(point.position.x/cellSize),cz=Math.floor(point.position.z/cellSize);
    for(let x=cx-1;x<=cx+1;x++)for(let z=cz-1;z<=cz+1;z++)for(const j of cells.get(`${x},${z}`)??[]){const other=dense[j]!;if(point.distance-other.distance<config.nonLocalDistance)continue;const separation=Math.hypot(point.position.x-other.position.x,point.position.z-other.position.z);if(separation<config.maximumWidth+config.minimumDrySeparation)pairs.push({a:other.sample,b:point.sample,distanceA:other.distance,distanceB:point.distance,separation})}
    const key=`${cx},${cz}`,bucket=cells.get(key)??[];bucket.push(i);cells.set(key,bucket);
  }
  for(const pair of pairs)if(pair.separation-config.minimumDrySeparation<config.minimumWidth-1e-9)throw new Error("River width minimum cannot preserve configured non-local dry separation");
  for(const p of pairs){const safeFullWidth=p.separation-config.minimumDrySeparation;
    const indices=[Math.floor(p.distanceA/spine.totalLength*count),Math.ceil(p.distanceA/spine.totalLength*count),Math.floor(p.distanceB/spine.totalLength*count),Math.ceil(p.distanceB/spine.totalLength*count)];
    for(const index of indices)accepted[Math.min(count,index)]=Math.min(accepted[Math.min(count,index)]!,safeFullWidth);
  }
  // Safety pinches only propagate reductions; therefore feathering cannot invalidate a pair cap.
  const feather=Math.ceil(config.safetyFeatherDistance/(spine.totalLength/count));
  const constrained=[...accepted];for(let i=0;i<=count;i++)for(let j=Math.max(0,i-feather);j<=Math.min(count,i+feather);j++)accepted[j]=Math.min(accepted[j]!,target[j]!-(target[i]!-constrained[i]!)*(1-Math.abs(j-i)/(feather+1)));
  const maxStep=config.maximumGradient*(spine.totalLength/count);
  for(let pass=0;pass<4;pass++){for(let i=1;i<=count;i++)accepted[i]=Math.min(accepted[i]!,accepted[i-1]!+maxStep);for(let i=count-1;i>=0;i--)accepted[i]=Math.min(accepted[i]!,accepted[i+1]!+maxStep)}
  for(let i=0;i<=count;i++)accepted[i]=clamp(accepted[i]!,config.minimumWidth,config.maximumWidth);
  for(let i=0;i<=count;i++){
    if(!Number.isFinite(accepted[i])||accepted[i]!<config.minimumWidth-1e-9||accepted[i]!>config.maximumWidth+1e-9)throw new Error("River width final acceptance failed bounds");
    if(i&&Math.abs(accepted[i]!-accepted[i-1]!)/(distances[i]!-distances[i-1]!)>config.maximumGradient+1e-9)throw new Error("River width final acceptance failed gradient");
  }
  const widthAt=(distance:number)=>{const p=distance/spine.totalLength*count,i=Math.min(count-1,Math.floor(p)),t=p-i;return accepted[i]!+(accepted[i+1]!-accepted[i]!)*t};
  for(const pair of pairs)if(widthAt(pair.distanceA)/2+widthAt(pair.distanceB)/2+config.minimumDrySeparation>pair.separation+1e-8)throw new Error("River width final acceptance failed interpolated dry separation");
  const samples=Object.freeze(distances.map((distance,i)=>Object.freeze({distance,fullWidth:accepted[i]!,halfWidth:accepted[i]!/2,biomeMultiplier:biome[i]!,variationMultiplier:1+slowVariation(seed,distance,config.variationScale)*config.variationAmplitude,bendMultiplier:bend[i]!,targetWidth:target[i]!,safetyClamped:accepted[i]!<target[i]!-1e-8})));
  const interpolate=(distance:number):RiverWidthSample=>{const d=clamp(distance,0,spine.totalLength),p=d/spine.totalLength*count,i=Math.min(count-1,Math.floor(p)),t=p-i,a=samples[i]!,b=samples[i+1]!;return Object.freeze({distance:d,fullWidth:a.fullWidth+(b.fullWidth-a.fullWidth)*t,halfWidth:a.halfWidth+(b.halfWidth-a.halfWidth)*t,biomeMultiplier:a.biomeMultiplier+(b.biomeMultiplier-a.biomeMultiplier)*t,variationMultiplier:a.variationMultiplier+(b.variationMultiplier-a.variationMultiplier)*t,bendMultiplier:a.bendMultiplier+(b.bendMultiplier-a.bendMultiplier)*t,targetWidth:a.targetWidth+(b.targetWidth-a.targetWidth)*t,safetyClamped:a.safetyClamped||b.safetyClamped})};
  const values=samples.map(s=>s.fullWidth);return Object.freeze({identity:`width-v${config.version}:${normalizeSeed(seedInput)}:${JSON.stringify(config)}`,config,totalLength:spine.totalLength,spine,samples,minimum:Math.min(...values),maximum:Math.max(...values),mean:values.reduce((a,b)=>a+b,0)/values.length,clampedSampleCount:samples.filter(s=>s.safetyClamped).length,sampleAtDistance:interpolate,sampleAtProgress:(p:number)=>interpolate(clamp(p,0,1)*spine.totalLength)});
}

export function sampleRiverWidth(profile:RiverWidthProfile,distance:number,spine:RiverSpine=profile.spine):RiverWidthSample {
  if(profile.spine!==spine)throw new Error("River width profile does not belong to the supplied final spine");
  return profile.sampleAtDistance(distance);
}
