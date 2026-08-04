import { sampleBiome, type BiomeId, type BiomeWeights } from "./biomes";
import { CHUNK_SIZE, worldToChunk, type ChunkCoordinate } from "./chunkCoordinates";
import { hashFloat, normalizeSeed } from "./random";
import { isLakeAt, LAKE_SURFACE_ELEVATION, sampleTerrainHeight } from "./terrainSampling";
import {
  createWorldRiverRelationshipContext,
  queryWorldRiverRelationship,
  type WorldRiverRelationship,
  type WorldRiverRelationshipContext,
} from "./worldRiverRelationship";
import { generateWetlandPools } from "./wetlands";
import { createPoiStructure } from "./poiStructures";
import type { StructureCollisionDefinition } from "./structureTypes";
import { getWorldRiverOwner } from "./worldRiverOwner";
import type { RiverSpine } from "./riverSpineGeometry";

export type PoiFootprint =
  | Readonly<{ kind: "circle"; x: number; z: number; radius: number }>
  | Readonly<{ kind: "rectangle"; x: number; z: number; halfWidth: number; halfDepth: number; rotation: number }>;
export type PoiZonePurpose = "solid" | "vegetation-exclusion" | "decoration";
export interface PoiZone { readonly name?: string; readonly purpose: PoiZonePurpose; readonly footprint: PoiFootprint }
export interface TerrainFootprintAnalysis { readonly averageHeight:number; readonly minimumHeight:number; readonly maximumHeight:number; readonly heightVariation:number; readonly approximateSlope:number; readonly suggestedPlacementHeight:number }
export interface PoiDirection { readonly x:number; readonly z:number }
export type PoiNavigationAnchor = Readonly<{x:number;y:number;z:number;kind:"entrance"|"dock-landing"|"centre"}>;
export interface GeneratedPoi {
  readonly id:string; readonly typeId:string; readonly position:Readonly<{x:number;y:number;z:number}>; readonly rotation:number;
  readonly footprint:PoiFootprint; readonly zones:readonly PoiZone[]; readonly clearanceRadius:number;
  readonly entrance:Readonly<{position:Readonly<{x:number;y:number;z:number}>;facing:number;direction:PoiDirection}>;
  readonly navigationAnchor:PoiNavigationAnchor;
  readonly riverRelationship?:PoiRiverRelationship;
  readonly dock?:Readonly<{footprint:PoiFootprint;direction:PoiDirection;shore:Readonly<{x:number;z:number}>;end:Readonly<{x:number;y:number;z:number}>;surfaceElevation:number}>;
  readonly shadowCaster?:Readonly<{x:number;z:number;width:number;depth:number;rotation:number;height:number}>;
  readonly ownerChunk:ChunkCoordinate;
  readonly structure:StructureCollisionDefinition;
  readonly metadata:Readonly<{biome:BiomeId;biomeWeights:BiomeWeights;candidateCell:Readonly<{x:number;z:number;index:number}>;suitability:number;terrain:TerrainFootprintAnalysis;distanceToRiver:number;distanceToLake:number;vegetationDensity:number;plainsCoverage:number;localProminence:number}>;
  readonly parameters?:Readonly<Record<string,string|number|boolean>>;
}
export interface PoiRiverRelationship extends WorldRiverRelationship {
  readonly type:"river-avoiding"|"river-adjacent"|"river-facing"|"bridge-connected";
  readonly preferredFacing:PoiDirection;
  readonly waterFacingAnchor:Readonly<{x:number;z:number}>;
}
export type PoiRejectionReason = "wrong biome"|"insufficient plains footprint"|"wetland clearing is not dry"|"insufficient terrain prominence"|"slope too high"|"uneven terrain"|"underwater"|"river intersection"|"lake requirement not met"|"invalid shoreline"|"dock not over lake"|"too close to another POI"|"candidate lost to a higher-scoring candidate"|"rarity";
export interface PoiDebugCandidate { readonly id:string;readonly typeId:string;readonly label:string;readonly x:number;readonly z:number;readonly score:number;readonly accepted:boolean;readonly reason?:PoiRejectionReason;readonly footprint:PoiFootprint;readonly rotation:number;readonly entrance?:Readonly<{x:number;z:number}>;readonly dockDirection?:PoiDirection }
export interface PoiSuitabilityContext { readonly seed:number;readonly x:number;readonly z:number;readonly rotation:number;readonly biome:ReturnType<typeof sampleBiome>;readonly terrain:TerrainFootprintAnalysis;readonly footprint:PoiFootprint;readonly distanceToRiver:number;readonly distanceToLake:number;readonly underwater:boolean;readonly intersectsRiver:boolean;readonly riverRelationship?:WorldRiverRelationship;readonly vegetationDensity:number;readonly plainsCoverage:number;readonly localProminence:number;readonly clearingIsDry:boolean;readonly shoreline?:Shoreline }
export interface PoiSuitability {readonly score:number;readonly reason?:PoiRejectionReason}
export interface PoiDefinition {
  readonly id:string;readonly label:string;readonly biomes:Readonly<{allowed?:readonly BiomeId[];preferred?:readonly BiomeId[]}>;
  readonly rarity:number;readonly weight:number;readonly minimumSpacing:number;readonly clearanceRadius:number;
  readonly spacingByType?:Readonly<Record<string,number>>;
  readonly footprint:Readonly<{kind:"circle";radius:number}|{kind:"rectangle";width:number;depth:number}>;
  readonly hydrology?:Readonly<{requireLakeWithin?:number;rejectRiverIntersection?:boolean;riverBankClearance?:number;shoreline?:boolean}>;
  readonly terrain:Readonly<{maximumSlope:number;maximumVariation:number}>;readonly renderer:string;readonly debugColor:number;
  readonly shadowCaster?:Readonly<{width:number;depth:number;height:number}>;
  suitability?(context:PoiSuitabilityContext):PoiSuitability; parameters?(seed:number,cellX:number,cellZ:number):Readonly<Record<string,string|number|boolean>>;
}

const definitions=new Map<string,PoiDefinition>();
export function registerPoiDefinition(definition:PoiDefinition):void {if(definitions.has(definition.id))throw new Error(`Duplicate POI type: ${definition.id}`);definitions.set(definition.id,Object.freeze(definition));}
export function getPoiDefinitions():readonly PoiDefinition[]{return [...definitions.values()];}

export const PLAINS_FARMHOUSE_CONFIG=Object.freeze({rarity:.18,minimumSpacing:112,clearanceRadius:8});
export const LAKE_HOUSE_CONFIG=Object.freeze({rarity:.25,minimumSpacing:128,clearanceRadius:7});
export const FOREST_CABIN_CONFIG=Object.freeze({rarity:.22,minimumSpacing:96,clearanceRadius:5.2});
export const HIGHLAND_WATCHTOWER_CONFIG=Object.freeze({rarity:.16,minimumSpacing:112,clearanceRadius:5.5});
registerPoiDefinition({id:"plains-farmhouse",label:"Plains farmhouse",biomes:{allowed:["plains"],preferred:["plains"]},...PLAINS_FARMHOUSE_CONFIG,weight:1,footprint:{kind:"rectangle",width:7,depth:6},shadowCaster:{width:6.4,depth:5.2,height:2.7},hydrology:{rejectRiverIntersection:true,riverBankClearance:2.5},terrain:{maximumSlope:.13,maximumVariation:.72},renderer:"plains-farmhouse",debugColor:0xe7bd72,suitability:c=>c.plainsCoverage<.72?{score:0,reason:"insufficient plains footprint"}:{score:.5+c.plainsCoverage*.35-c.terrain.approximateSlope,reason:c.distanceToLake<12?"lake requirement not met":undefined},parameters:(seed,x,z)=>({roofHue:hashFloat(seed,x,z,923)})});
registerPoiDefinition({id:"lake-house",label:"Lake house with dock",biomes:{allowed:["plains","forest","wetland"],preferred:["plains","forest"]},...LAKE_HOUSE_CONFIG,weight:1.1,footprint:{kind:"rectangle",width:6,depth:5},shadowCaster:{width:5.5,depth:4.5,height:2.6},hydrology:{shoreline:true,requireLakeWithin:12,rejectRiverIntersection:true},terrain:{maximumSlope:.18,maximumVariation:.9},renderer:"lake-house",debugColor:0x65c4d8,suitability:c=>!c.shoreline?{score:0,reason:"invalid shoreline"}:{score:.82-c.terrain.approximateSlope}});
registerPoiDefinition({id:"forest-cabin",label:"Small forest cabin",biomes:{allowed:["forest","wetland"],preferred:["forest"]},...FOREST_CABIN_CONFIG,weight:1.05,footprint:{kind:"rectangle",width:5,depth:4.2},shadowCaster:{width:4.7,depth:3.9,height:2.5},hydrology:{rejectRiverIntersection:true,riverBankClearance:1.5},terrain:{maximumSlope:.12,maximumVariation:.55},renderer:"forest-cabin",debugColor:0x8b6947,suitability:c=>c.biome.dominant==="wetland"&&!c.clearingIsDry?{score:0,reason:"wetland clearing is not dry"}:{score:(c.biome.dominant==="forest"?.82:.62)-c.terrain.approximateSlope-c.vegetationDensity*.04}});
registerPoiDefinition({id:"highland-watchtower",label:"Highland watchtower",biomes:{allowed:["highlands","mountain"],preferred:["highlands"]},...HIGHLAND_WATCHTOWER_CONFIG,spacingByType:{"highland-watchtower":100},weight:1.25,footprint:{kind:"rectangle",width:4.2,depth:4.2},shadowCaster:{width:4,depth:4,height:8.5},hydrology:{rejectRiverIntersection:true,riverBankClearance:1},terrain:{maximumSlope:.14,maximumVariation:.6},renderer:"highland-watchtower",debugColor:0xd6c7a0,suitability:c=>c.localProminence<.22?{score:0,reason:"insufficient terrain prominence"}:{score:Math.min(1,.4+c.localProminence*.32+(c.biome.dominant==="highlands"?.12:0)-c.terrain.approximateSlope)}});

function axes(shape:Extract<PoiFootprint,{kind:"rectangle"}>):readonly [number,number][]{const c=Math.cos(shape.rotation),s=Math.sin(shape.rotation);return [[c,s],[-s,c]];}
function rectangleCorners(shape:Extract<PoiFootprint,{kind:"rectangle"}>):readonly [number,number][]{const[a,b]=axes(shape);return [[-1,-1],[-1,1],[1,-1],[1,1]].map(([u,v])=>[shape.x+a[0]*shape.halfWidth*u+b[0]*shape.halfDepth*v,shape.z+a[1]*shape.halfWidth*u+b[1]*shape.halfDepth*v]);}
export function pointInFootprint(x:number,z:number,shape:PoiFootprint):boolean{if(shape.kind==="circle")return Math.hypot(x-shape.x,z-shape.z)<=shape.radius;const dx=x-shape.x,dz=z-shape.z,c=Math.cos(shape.rotation),s=Math.sin(shape.rotation);return Math.abs(dx*c+dz*s)<=shape.halfWidth&&Math.abs(-dx*s+dz*c)<=shape.halfDepth;}
export function footprintsOverlap(a:PoiFootprint,b:PoiFootprint):boolean{if(a.kind==="circle"&&b.kind==="circle")return Math.hypot(a.x-b.x,a.z-b.z)<=a.radius+b.radius;if(a.kind==="circle"||b.kind==="circle"){const circle=(a.kind==="circle"?a:b) as Extract<PoiFootprint,{kind:"circle"}>,rect=(a.kind==="rectangle"?a:b) as Extract<PoiFootprint,{kind:"rectangle"}>;const dx=circle.x-rect.x,dz=circle.z-rect.z,c=Math.cos(rect.rotation),s=Math.sin(rect.rotation),lx=dx*c+dz*s,lz=-dx*s+dz*c,qx=Math.max(-rect.halfWidth,Math.min(rect.halfWidth,lx)),qz=Math.max(-rect.halfDepth,Math.min(rect.halfDepth,lz));return(lx-qx)**2+(lz-qz)**2<=circle.radius**2;}const ca=rectangleCorners(a),cb=rectangleCorners(b);for(const axis of [...axes(a),...axes(b)]){const pa=ca.map(p=>p[0]*axis[0]+p[1]*axis[1]),pb=cb.map(p=>p[0]*axis[0]+p[1]*axis[1]);if(Math.max(...pa)<Math.min(...pb)||Math.max(...pb)<Math.min(...pa))return false;}return true;}
export function isVegetationExcluded(x:number,z:number,zones:readonly PoiZone[]):boolean{return zones.some(zone=>(zone.purpose==="solid"||zone.purpose==="vegetation-exclusion")&&pointInFootprint(x,z,zone.footprint));}
function samples(shape:PoiFootprint):readonly [number,number][]{if(shape.kind==="rectangle"){const c=Math.cos(shape.rotation),s=Math.sin(shape.rotation),out:[number,number][]=[];for(let u=-1;u<=1;u+=.5)for(let v=-1;v<=1;v+=.5)out.push([shape.x+c*shape.halfWidth*u-s*shape.halfDepth*v,shape.z+s*shape.halfWidth*u+c*shape.halfDepth*v]);return out;}return [[shape.x,shape.z],...Array.from({length:48},(_,i)=>{const a=(i%12)*Math.PI/6,r=shape.radius*(Math.floor(i/12)+1)/4;return[shape.x+Math.cos(a)*r,shape.z+Math.sin(a)*r] as[number,number];})];}
export function analyzeTerrainFootprint(seedInput:number|string,shape:PoiFootprint):TerrainFootprintAnalysis{const seed=normalizeSeed(seedInput),heights=samples(shape).map(([x,z])=>sampleTerrainHeight(seed,x,z)),minimumHeight=Math.min(...heights),maximumHeight=Math.max(...heights),averageHeight=heights.reduce((a,b)=>a+b,0)/heights.length,extent=shape.kind==="circle"?shape.radius*2:Math.min(shape.halfWidth,shape.halfDepth)*2;return{averageHeight,minimumHeight,maximumHeight,heightVariation:maximumHeight-minimumHeight,approximateSlope:(maximumHeight-minimumHeight)/Math.max(.01,extent),suggestedPlacementHeight:maximumHeight-.08};}
export function footprintIntersectsRiver(_seedInput:number|string,shape:PoiFootprint,context?:WorldRiverRelationshipContext):boolean{return samples(shape).some(([x,z])=>{const relationship=queryWorldRiverRelationship(x,z,context);return relationship!==undefined&&relationship.distanceToWaterEdge<=0;});}
export function footprintLakeCoverage(seedInput:number|string,shape:PoiFootprint):number{const seed=normalizeSeed(seedInput),points=samples(shape);return points.filter(([x,z])=>isLakeAt(seed,x,z)).length/points.length;}
export function footprintBiomeCoverage(seedInput:number|string,shape:PoiFootprint,biome:BiomeId):number{const seed=normalizeSeed(seedInput),points=samples(shape);return points.filter(([x,z])=>sampleBiome(seed,x,z).dominant===biome).length/points.length;}

export interface LocalProminenceSample {readonly elevation:number;readonly prominence:number;readonly byRadius:readonly Readonly<{radius:number;surroundingAverage:number;prominence:number}>[]}
/** Compares a point with evenly distributed terrain samples on configurable surrounding rings. */
export function sampleLocalProminence(seedInput:number|string,x:number,z:number,radii:readonly number[],samplesPerRadius=12):LocalProminenceSample{const seed=normalizeSeed(seedInput),elevation=sampleTerrainHeight(seed,x,z),byRadius=radii.map(radius=>{let total=0;for(let i=0;i<samplesPerRadius;i++){const angle=i*Math.PI*2/samplesPerRadius;total+=sampleTerrainHeight(seed,x+Math.cos(angle)*radius,z+Math.sin(angle)*radius);}const surroundingAverage=total/samplesPerRadius;return{radius,surroundingAverage,prominence:elevation-surroundingAverage};});return{elevation,prominence:byRadius.reduce((total,sample)=>total+sample.prominence,0)/Math.max(1,byRadius.length),byRadius};}
function footprintAvoidsWetlandPools(seed:number,shape:PoiFootprint):boolean{const radius=shape.kind==="circle"?shape.radius:Math.hypot(shape.halfWidth,shape.halfDepth),minX=Math.floor((shape.x-radius)/CHUNK_SIZE),maxX=Math.floor((shape.x+radius)/CHUNK_SIZE),minZ=Math.floor((shape.z-radius)/CHUNK_SIZE),maxZ=Math.floor((shape.z+radius)/CHUNK_SIZE);for(let cz=minZ;cz<=maxZ;cz++)for(let cx=minX;cx<=maxX;cx++)for(const pool of generateWetlandPools(seed,{x:cx,z:cz})){const poolShape:PoiFootprint={kind:"circle",x:pool.x,z:pool.z,radius:Math.max(pool.radiusX,pool.radiusZ)};if(footprintsOverlap(shape,poolShape))return false;}return true;}
export function isDryPoiFootprint(seedInput:number|string,shape:PoiFootprint,riverContext?:WorldRiverRelationshipContext):boolean{const seed=normalizeSeed(seedInput);return !footprintIntersectsRiver(seed,shape,riverContext)&&footprintLakeCoverage(seed,shape)===0&&footprintAvoidsWetlandPools(seed,shape);}

export interface Shoreline {readonly land:{x:number;z:number};readonly shore:{x:number;z:number};readonly water:{x:number;z:number};readonly direction:PoiDirection}
/** Finds a globally sampled dry-to-lake transect; independent of chunk boundaries. */
export function detectLakeShoreline(seedInput:number|string,x:number,z:number,maxDistance=24):Shoreline|undefined{const seed=normalizeSeed(seedInput);let best:Shoreline|undefined,bestDistance=Infinity;for(let i=0;i<16;i++){const a=i*Math.PI/8,dx=Math.sin(a),dz=Math.cos(a);for(let r=2;r<=maxDistance;r+=2){const px=x+dx*r,pz=z+dz*r;if(isLakeAt(seed,px,pz)){const landR=r-2,land={x:x+dx*landR,z:z+dz*landR},river=queryWorldRiverRelationship(land.x,land.z);if(!isLakeAt(seed,land.x,land.z)&&(!river||river.distanceToWaterEdge>0)&&r<bestDistance){bestDistance=r;best={land,shore:{x:x+dx*(r-1),z:z+dz*(r-1)},water:{x:x+dx*(r+2),z:z+dz*(r+2)},direction:{x:dx,z:dz}};}break;}}}return best;}

/** Dock POIs guide to the authoritative dry landing; all others guide to their entrance. */
export function selectPoiNavigationAnchor(seed:number,entrance:Readonly<{x:number;y:number;z:number}>,shoreline?:Shoreline):PoiNavigationAnchor {
  if(!shoreline)return Object.freeze({...entrance,kind:"entrance"});
  return Object.freeze({x:shoreline.land.x,y:sampleTerrainHeight(seed,shoreline.land.x,shoreline.land.z),z:shoreline.land.z,kind:"dock-landing"});
}

const CELL_SIZE = 48;
const ORDINARY_SEARCH_MARGIN = 3;
const generationCache = new Map<string, Readonly<{ pois: readonly GeneratedPoi[]; candidates: readonly PoiDebugCandidate[] }>>();
const candidateCache = new Map<string, Evaluated>();
const prominenceCache = new Map<string, LocalProminenceSample>();
const MAX_CANDIDATE_CACHE = 4096;
const MAX_PROMINENCE_CACHE = 1024;

interface Evaluated { definition:PoiDefinition; id:string; cellX:number; cellZ:number; index:number; x:number; z:number; rotation:number; footprint:PoiFootprint; context:PoiSuitabilityContext; score:number; reason?:PoiRejectionReason }

function boundedSet<K,V>(cache:Map<K,V>,key:K,value:V,maximum:number):V {cache.set(key,value);while(cache.size>maximum)cache.delete(cache.keys().next().value!);return value;}
function emptyTerrain():TerrainFootprintAnalysis{return{averageHeight:0,minimumHeight:0,maximumHeight:0,heightVariation:0,approximateSlope:0,suggestedPlacementHeight:0};}
function defaultContext(seed:number,x:number,z:number,rotation:number,footprint:PoiFootprint,biome=sampleBiome(seed,x,z)):PoiSuitabilityContext{return{seed,x,z,rotation,biome,terrain:emptyTerrain(),footprint,distanceToRiver:Infinity,distanceToLake:Infinity,underwater:false,intersectsRiver:false,vegetationDensity:0,plainsCoverage:0,localProminence:0,clearingIsDry:false};}
function distanceTo(seed:number,x:number,z:number,predicate:(s:number,x:number,z:number)=>boolean,max=32):number{if(predicate(seed,x,z))return 0;for(let r=2;r<=max;r+=2)for(let i=0;i<16;i++){const a=i*Math.PI/8;if(predicate(seed,x+Math.cos(a)*r,z+Math.sin(a)*r))return r;}return Infinity;}
function candidateFootprint(d:PoiDefinition,x:number,z:number,rotation:number):PoiFootprint{return d.footprint.kind==="circle"?{kind:"circle",x,z,radius:d.footprint.radius}:{kind:"rectangle",x,z,halfWidth:d.footprint.width/2,halfDepth:d.footprint.depth/2,rotation};}

function evaluate(seed:number,d:PoiDefinition,cellX:number,cellZ:number,index=0,riverContext?:WorldRiverRelationshipContext):Evaluated{
  const cacheKey=`${seed}:${d.id}:${cellX}:${cellZ}:${index}`,cached=candidateCache.get(cacheKey);if(cached)return cached;
  let x=(cellX+.12+hashFloat(seed,cellX,cellZ,801+index)*.76)*CELL_SIZE,z=(cellZ+.12+hashFloat(seed,cellX,cellZ,811+index)*.76)*CELL_SIZE;
  let rotation=hashFloat(seed,cellX,cellZ,821+index)*Math.PI*2,footprint=candidateFootprint(d,x,z,rotation);
  const id=`poi:${seed.toString(16)}:${d.id}:${cellX}:${cellZ}:${index}`;
  // Rarity and centre-biome rejection intentionally precede all terrain and footprint sampling.
  if(hashFloat(seed,cellX,cellZ,831+index)>=d.rarity)return boundedSet(candidateCache,cacheKey,{definition:d,id,cellX,cellZ,index,x,z,rotation,footprint,context:defaultContext(seed,x,z,rotation,footprint),score:0,reason:"rarity"},MAX_CANDIDATE_CACHE);
  const coarseBiome=sampleBiome(seed,x,z);
  if(!d.hydrology?.shoreline&&d.biomes.allowed&&!d.biomes.allowed.includes(coarseBiome.dominant))return boundedSet(candidateCache,cacheKey,{definition:d,id,cellX,cellZ,index,x,z,rotation,footprint,context:defaultContext(seed,x,z,rotation,footprint,coarseBiome),score:0,reason:"wrong biome"},MAX_CANDIDATE_CACHE);
  const coarseRiver=d.hydrology?.rejectRiverIntersection?queryWorldRiverRelationship(x,z,riverContext):undefined;
  if(!d.hydrology?.shoreline&&(isLakeAt(seed,x,z)||(coarseRiver&&coarseRiver.distanceToWaterEdge<=0)))return boundedSet(candidateCache,cacheKey,{definition:d,id,cellX,cellZ,index,x,z,rotation,footprint,context:{...defaultContext(seed,x,z,rotation,footprint,coarseBiome),riverRelationship:coarseRiver},score:0,reason:isLakeAt(seed,x,z)?"underwater":"river intersection"},MAX_CANDIDATE_CACHE);

  const shoreline=d.hydrology?.shoreline?detectLakeShoreline(seed,x,z):undefined;
  if(shoreline){x=shoreline.land.x-shoreline.direction.x*5.5;z=shoreline.land.z-shoreline.direction.z*5.5;rotation=Math.atan2(shoreline.direction.x,shoreline.direction.z);footprint=candidateFootprint(d,x,z,rotation);}
  const biome=shoreline?sampleBiome(seed,x,z):coarseBiome;
  if(d.biomes.allowed&&!d.biomes.allowed.includes(biome.dominant))return boundedSet(candidateCache,cacheKey,{definition:d,id,cellX,cellZ,index,x,z,rotation,footprint,context:{...defaultContext(seed,x,z,rotation,footprint,biome),shoreline},score:0,reason:"wrong biome"},MAX_CANDIDATE_CACHE);
  if(!shoreline&&d.hydrology?.shoreline)return boundedSet(candidateCache,cacheKey,{definition:d,id,cellX,cellZ,index,x,z,rotation,footprint,context:defaultContext(seed,x,z,rotation,footprint,biome),score:0,reason:"invalid shoreline"},MAX_CANDIDATE_CACHE);

  const riverRelationship=d.hydrology?.rejectRiverIntersection?queryWorldRiverRelationship(x,z,riverContext):undefined;
  const footprintRiverRelationships=d.hydrology?.rejectRiverIntersection?samples(footprint).map(([px,pz])=>queryWorldRiverRelationship(px,pz,riverContext)).filter((value):value is WorldRiverRelationship=>value!==undefined):[];
  const terrain=analyzeTerrainFootprint(seed,footprint),distanceToRiver=riverRelationship?.distanceToCentreline??Infinity,distanceToLake=distanceTo(seed,x,z,isLakeAt),intersectsRiver=footprintRiverRelationships.some(r=>r.distanceToWaterEdge<=0),underwater=isLakeAt(seed,x,z),vegetationDensity=hashFloat(seed,Math.floor(x/32),Math.floor(z/32),401),plainsCoverage=d.id==="plains-farmhouse"?footprintBiomeCoverage(seed,footprint,"plains"):0;
  // These two costly policies are type- and biome-specific by construction.
  const localProminence=d.id==="highland-watchtower"?sampleCachedProminence(seed,cellX,cellZ,x,z,[10,20,36],12).prominence:0;
  const clearingIsDry=d.id!=="forest-cabin"||biome.dominant!=="wetland"||isDryPoiFootprint(seed,{kind:"circle",x,z,radius:d.clearanceRadius},riverContext);
  const context:PoiSuitabilityContext={seed,x,z,rotation,biome,terrain,footprint,distanceToRiver,distanceToLake,intersectsRiver,underwater,riverRelationship,vegetationDensity,plainsCoverage,localProminence,clearingIsDry,shoreline};
  let reason:PoiRejectionReason|undefined;
  if(underwater||footprintLakeCoverage(seed,footprint)>0)reason="underwater";else if(d.hydrology?.rejectRiverIntersection&&(intersectsRiver||footprintRiverRelationships.some(r=>r.distanceToWalkableBank<(d.hydrology?.riverBankClearance??0))))reason="river intersection";else if(d.hydrology?.requireLakeWithin!==undefined&&distanceToLake>d.hydrology.requireLakeWithin)reason="lake requirement not met";else if(terrain.approximateSlope>d.terrain.maximumSlope)reason="slope too high";else if(terrain.heightVariation>d.terrain.maximumVariation)reason="uneven terrain";
  if(shoreline&&!isLakeAt(seed,shoreline.water.x,shoreline.water.z))reason="dock not over lake";
  let score=(d.biomes.preferred?.includes(biome.dominant)?.2:0)+d.weight*.1+hashFloat(seed,cellX,cellZ,841+index)*.7;const custom=d.suitability?.(context);if(custom){score=Math.max(0,Math.min(1,custom.score));reason=reason??custom.reason;}
  return boundedSet(candidateCache,cacheKey,{definition:d,id,cellX,cellZ,index,x,z,rotation,footprint,context,score,reason},MAX_CANDIDATE_CACHE);
}
function sampleCachedProminence(seed:number,cellX:number,cellZ:number,x:number,z:number,radii:readonly number[],samplesPerRadius:number):LocalProminenceSample{const key=`${seed}:${cellX}:${cellZ}:${radii.join(",")}:${samplesPerRadius}`,cached=prominenceCache.get(key);if(cached)return cached;return boundedSet(prominenceCache,key,sampleLocalProminence(seed,x,z,radii,samplesPerRadius),MAX_PROMINENCE_CACHE);}
function rank(a:Evaluated,b:Evaluated):number{return b.score-a.score||a.id.localeCompare(b.id);}
function spacing(a:PoiDefinition,b:PoiDefinition):number{return Math.max(a.spacingByType?.[b.id]??a.minimumSpacing,b.spacingByType?.[a.id]??b.minimumSpacing);}
export function getPoiCandidateSearchMargins():Readonly<Record<string,number>>{return Object.fromEntries([...definitions.values()].map(d=>[d.id,d.id==="highland-watchtower"?Math.ceil((d.spacingByType?.[d.id]??d.minimumSpacing)/CELL_SIZE)+1:ORDINARY_SEARCH_MARGIN]));}
export function getPoiCacheSizes():Readonly<{generation:number;candidates:number;prominence:number}>{return{generation:generationCache.size,candidates:candidateCache.size,prominence:prominenceCache.size};}
/** Supported deterministic-test/diagnostic reset; production never needs it. */
export function clearPoiGenerationCaches():void{generationCache.clear();candidateCache.clear();prominenceCache.clear();}

export function generatePois(seedInput:number|string,coordinate:ChunkCoordinate, spine?: RiverSpine, riverIdentity?: string):Readonly<{pois:readonly GeneratedPoi[];candidates:readonly PoiDebugCandidate[]}>{
  const owner = spine ? undefined : getWorldRiverOwner(seedInput); spine ??= owner!.spine; riverIdentity ??= owner?.identity ?? "explicit-spine";
  const seed=normalizeSeed(seedInput),key=`${seed}:${riverIdentity}:${definitions.size}:${coordinate.x}:${coordinate.z}`,cached=generationCache.get(key);if(cached)return cached;
  const baseX=Math.floor(coordinate.x*CHUNK_SIZE/CELL_SIZE),endX=Math.floor((coordinate.x+1)*CHUNK_SIZE/CELL_SIZE),baseZ=Math.floor(coordinate.z*CHUNK_SIZE/CELL_SIZE),endZ=Math.floor((coordinate.z+1)*CHUNK_SIZE/CELL_SIZE),all:Evaluated[]=[];
  const maximumMargin=Math.max(...Object.values(getPoiCandidateSearchMargins()));
  const riverContext=createWorldRiverRelationshipContext({minX:(baseX-maximumMargin)*CELL_SIZE,maxX:(endX+maximumMargin+1)*CELL_SIZE,minZ:(baseZ-maximumMargin)*CELL_SIZE,maxZ:(endZ+maximumMargin+1)*CELL_SIZE},16,spine);
  for(const definition of definitions.values()){const margin=definition.id==="highland-watchtower"?Math.ceil((definition.spacingByType?.[definition.id]??definition.minimumSpacing)/CELL_SIZE)+1:ORDINARY_SEARCH_MARGIN;for(let cz=baseZ-margin;cz<=endZ+margin;cz++)for(let cx=baseX-margin;cx<=endX+margin;cx++)all.push(evaluate(seed,definition,cx,cz,0,riverContext));}
  const viable=all.filter(c=>!c.reason),accepted=new Set<string>();for(const candidate of [...viable].sort(rank)){if([...accepted].every(id=>{const other=viable.find(v=>v.id===id)!;return Math.hypot(other.x-candidate.x,other.z-candidate.z)>=spacing(other.definition,candidate.definition);}))accepted.add(candidate.id);}
  const owned=all.filter(c=>{const owner=worldToChunk(c.x,c.z);return owner.x===coordinate.x&&owner.z===coordinate.z;});
  const pois:GeneratedPoi[]=owned.filter(c=>accepted.has(c.id)).map(c=>{const y=c.context.terrain.suggestedPlacementHeight,dir={x:Math.sin(c.rotation),z:Math.cos(c.rotation)},clearing:PoiFootprint={kind:"circle",x:c.x,z:c.z,radius:c.definition.clearanceRadius},entrancePosition={x:c.x+dir.x*(c.definition.footprint.kind==="rectangle"?c.definition.footprint.depth/2+.7:c.definition.clearanceRadius),y,z:c.z+dir.z*(c.definition.footprint.kind==="rectangle"?c.definition.footprint.depth/2+.7:c.definition.clearanceRadius)},zones:PoiZone[]=[{name:"house",purpose:"solid",footprint:c.footprint},{name:"clearing",purpose:"vegetation-exclusion",footprint:clearing},{name:"entrance-approach",purpose:"vegetation-exclusion",footprint:{kind:"rectangle",x:entrancePosition.x,z:entrancePosition.z,halfWidth:1.2,halfDepth:2,rotation:c.rotation}}];let dock:GeneratedPoi["dock"];if(c.context.shoreline){const s=c.context.shoreline,mid={x:(s.shore.x+s.water.x)/2,z:(s.shore.z+s.water.z)/2},dockFp:PoiFootprint={kind:"rectangle",x:mid.x,z:mid.z,halfWidth:1.05,halfDepth:Math.hypot(s.water.x-s.shore.x,s.water.z-s.shore.z)/2+.8,rotation:c.rotation};zones.push({name:"dock",purpose:"solid",footprint:dockFp},{name:"dock-approach",purpose:"vegetation-exclusion",footprint:{...dockFp,halfWidth:1.7}});dock={footprint:dockFp,direction:s.direction,shore:s.shore,end:{x:s.water.x,y:LAKE_SURFACE_ELEVATION+.12,z:s.water.z},surfaceElevation:LAKE_SURFACE_ELEVATION};}const relationship=c.context.riverRelationship?{...c.context.riverRelationship,type:"river-avoiding" as const,preferredFacing:{...dir},waterFacingAnchor:{...c.context.riverRelationship.landingPoint}}:undefined;const navigationAnchor=selectPoiNavigationAnchor(seed,entrancePosition,c.context.shoreline);const generated={id:c.id,typeId:c.definition.id,position:{x:c.x,y,z:c.z},rotation:c.rotation,footprint:c.footprint,zones,clearanceRadius:c.definition.clearanceRadius,entrance:{position:entrancePosition,facing:c.rotation,direction:dir},navigationAnchor,riverRelationship:relationship,dock,shadowCaster:c.definition.shadowCaster?{x:c.x,z:c.z,rotation:c.rotation,...c.definition.shadowCaster}:undefined,ownerChunk:{...coordinate},metadata:{biome:c.context.biome.dominant,biomeWeights:c.context.biome.weights,candidateCell:{x:c.cellX,z:c.cellZ,index:c.index},suitability:c.score,terrain:c.context.terrain,distanceToRiver:c.context.distanceToRiver,distanceToLake:c.context.distanceToLake,vegetationDensity:c.context.vegetationDensity,plainsCoverage:c.context.plainsCoverage,localProminence:c.context.localProminence},parameters:c.definition.parameters?.(seed,c.cellX,c.cellZ)} as Omit<GeneratedPoi,"structure">;return{...generated,structure:createPoiStructure(generated as GeneratedPoi)};});
  const result={pois,candidates:owned.map(c=>({id:c.id,typeId:c.definition.id,label:c.definition.label,x:c.x,z:c.z,score:c.score,accepted:accepted.has(c.id),reason:c.reason??(!accepted.has(c.id)?"candidate lost to a higher-scoring candidate" as const:undefined),footprint:c.footprint,rotation:c.rotation,entrance:{x:c.x+Math.sin(c.rotation)*4,z:c.z+Math.cos(c.rotation)*4},dockDirection:c.context.shoreline?.direction}))};
  boundedSet(generationCache,key,result,256);return result;
}
