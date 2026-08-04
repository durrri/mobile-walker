import { sampleBiome, type BiomeId } from "./biomes";
import { CHUNK_SIZE, worldToChunk, type ChunkCoordinate } from "./chunkCoordinates";
import { footprintsOverlap, generatePois, type GeneratedPoi, type PoiFootprint, type PoiZone } from "./poi";
import { hashFloat, normalizeSeed } from "./random";
import type { StructureBoxCollider, StructureCollisionDefinition, StructureSegmentCollider, StructureSurfaceRecord } from "./structureTypes";
import { sampleTerrainHeight } from "./terrainSampling";
import { WORLD_RIVER_CARVING } from "./worldRiverCarving";
import type { WorldBounds2D } from "./worldRiverSpine";
import { getWorldRiverOwner } from "./worldRiverOwner";
import type { RiverSpine } from "./riverSpineGeometry";
import { sampleRiverWidth, type RiverWidthProfile } from "./worldRiverWidth";

export type BridgeArchetype = "pedestrian-footbridge" | "heavy-timber-bridge" | "stone-bridge";
export type BridgeVariant = "bare-plank" | "rope-railed" | "low-timber-railed" | "simple-beam" | "trestle" | "reinforced-timber" | "shallow-stone-span" | "single-arch" | "hump-backed-stone";
export interface SpanRules { readonly minimumSpan?:number; readonly maximumSpan?:number; readonly preferredSpan?:number }
export interface BridgeArchetypeDefinition { readonly id:BridgeArchetype;readonly deckWidth:readonly[number,number];readonly spanRules:SpanRules;readonly rarity:number;readonly approachLength:number;readonly variants:readonly BridgeVariant[] }

/** Span limits are suitability hints, not river-width classes; every range includes today's channel. */
export const BRIDGE_ARCHETYPES:Readonly<Record<BridgeArchetype,BridgeArchetypeDefinition>>={
  "pedestrian-footbridge":{id:"pedestrian-footbridge",deckWidth:[1.2,1.8],spanRules:{minimumSpan:3,maximumSpan:18,preferredSpan:7},rarity:1,approachLength:3,variants:["bare-plank","rope-railed","low-timber-railed"]},
  "heavy-timber-bridge":{id:"heavy-timber-bridge",deckWidth:[2.8,3.8],spanRules:{minimumSpan:3,maximumSpan:24,preferredSpan:9},rarity:.62,approachLength:5,variants:["simple-beam","trestle","reinforced-timber"]},
  "stone-bridge":{id:"stone-bridge",deckWidth:[3.5,5],spanRules:{minimumSpan:3,maximumSpan:30,preferredSpan:10},rarity:.28,approachLength:6.5,variants:["shallow-stone-span","single-arch","hump-backed-stone"]},
};
export interface BridgePoint {readonly x:number;readonly y:number;readonly z:number}
export interface GeneratedBridge {
 readonly id:string;readonly ownerChunk:ChunkCoordinate;readonly crossingCentre:BridgePoint;readonly riverTangent:Readonly<{x:number;z:number}>;readonly crossingDirection:Readonly<{x:number;z:number}>;
 readonly leftBankAnchor:BridgePoint;readonly rightBankAnchor:BridgePoint;readonly spanLength:number;readonly bankElevations:Readonly<{left:number;right:number}>;readonly deckWidth:number;
 readonly archetype:BridgeArchetype;readonly variant:BridgeVariant;readonly approachPoints:Readonly<{left:BridgePoint;right:BridgePoint}>;readonly zones:readonly PoiZone[];
 readonly shadowCaster?:Readonly<{x:number;z:number;width:number;depth:number;rotation:number;height:number}>;readonly connections:Readonly<{left?:string;right?:string}>;
 readonly scale:Readonly<{span:number;width:number;profileHeight:number}>;
 readonly collision:BridgeCollisionDefinition;
}
export type BridgeSurfaceRecord=StructureSurfaceRecord;
export type BridgeBoxCollider=StructureBoxCollider;
export type BridgeRailingCollider=StructureSegmentCollider;
/** Plain generated structure data: neither collision nor tests require Three.js. */
export interface BridgeCollisionDefinition extends StructureCollisionDefinition {readonly bridgeId:string;readonly centre:BridgePoint;readonly direction:Readonly<{x:number;z:number}>;readonly deckWidth:number;readonly deckLength:number;readonly deckThickness:number;readonly railings:readonly BridgeRailingCollider[];readonly solids:readonly BridgeBoxCollider[]}
export type BridgeRejectionReason="rarity"|"near river endpoint"|"river too curved"|"approach slope too high"|"unstable banks"|"building conflict";
export interface BridgeCrossingCandidate {readonly id:string;readonly latticeIndex:number;readonly riverDistance:number;readonly riverProgress:number;readonly ownerChunk:ChunkCoordinate;readonly centre:Readonly<{x:number;z:number}>;readonly riverTangent:Readonly<{x:number;z:number}>;readonly crossingDirection:Readonly<{x:number;z:number}>;readonly waterHalfWidth:number;readonly bankExtent:number;readonly leftBankAnchor:BridgePoint;readonly rightBankAnchor:BridgePoint;readonly landingHeights:Readonly<{left:number;right:number}>;readonly proposedDeckElevation:number;readonly approachPoints:Readonly<{left:BridgePoint;right:BridgePoint}>;readonly spanLength:number;readonly bounds:WorldBounds2D;readonly curvatureRadians:number;readonly approachSlope:number;readonly bankStability:number;readonly biome:BiomeId;readonly accepted:boolean;readonly reason?:BridgeRejectionReason;readonly archetype?:BridgeArchetype}

const BIOME_SCORE:Record<BiomeId,Record<BridgeArchetype,number>>={
 forest:{"pedestrian-footbridge":1,"heavy-timber-bridge":.82,"stone-bridge":.16},wetland:{"pedestrian-footbridge":1,"heavy-timber-bridge":.68,"stone-bridge":-.8},plains:{"pedestrian-footbridge":.52,"heavy-timber-bridge":1,"stone-bridge":.7},highlands:{"pedestrian-footbridge":.18,"heavy-timber-bridge":.58,"stone-bridge":1},mountain:{"pedestrian-footbridge":.12,"heavy-timber-bridge":.5,"stone-bridge":.95},lake:{"pedestrian-footbridge":.35,"heavy-timber-bridge":.35,"stone-bridge":-.8},
};
export function spanSuitability(archetype:BridgeArchetype,span:number):number{const r=BRIDGE_ARCHETYPES[archetype].spanRules;if((r.minimumSpan!==undefined&&span<r.minimumSpan)||(r.maximumSpan!==undefined&&span>r.maximumSpan))return .15;return r.preferredSpan===undefined?1:Math.max(.55,1-Math.abs(span-r.preferredSpan)/Math.max(span,r.preferredSpan));}
export function scoreBridgeArchetypes(seed:number,candidate:Pick<BridgeCrossingCandidate,"id"|"biome"|"spanLength"|"approachSlope"|"bankStability"|"leftBankAnchor"|"rightBankAnchor">):Readonly<Record<BridgeArchetype,number>>{const difference=Math.abs(candidate.leftBankAnchor.y-candidate.rightBankAnchor.y);return Object.fromEntries((Object.keys(BRIDGE_ARCHETYPES) as BridgeArchetype[]).map((id,index)=>{const d=BRIDGE_ARCHETYPES[id];let score=BIOME_SCORE[candidate.biome][id]+spanSuitability(id,candidate.spanLength)*.15+d.rarity*.08+hashFloat(seed,Math.floor(candidate.leftBankAnchor.z),index,1601)*.24-candidate.approachSlope*(id==="pedestrian-footbridge"?1.3:2.2)-difference*(id==="stone-bridge"?.07:.14);if(id==="stone-bridge")score+=(candidate.bankStability-.55)*.7;return[id,score];})) as Record<BridgeArchetype,number>}

/** Global arc-length lattice. The seed changes the phase, never chunk-local indexing. */
export const BRIDGE_CANDIDATE_SPACING = 40;
export const BRIDGE_ENDPOINT_CLEARANCE = 18;
export const BRIDGE_LANDING_MARGIN = .75;
export const BRIDGE_APPROACH_DISTANCE = 6;
export const BRIDGE_MAX_CURVATURE_RADIANS = .32;
export const BRIDGE_MAX_LANDING_DIFFERENCE = 1.35;
const bridgeGenerationCache = new Map<string, Readonly<{bridges:readonly GeneratedBridge[];candidates:readonly BridgeCrossingCandidate[]}>>();
/** Supported deterministic-test/diagnostic reset; production never needs it. */
export function clearBridgeGenerationCache():void{bridgeGenerationCache.clear();}

function latticePhase(seed:number):number{return hashFloat(seed,0,0,1791)*BRIDGE_CANDIDATE_SPACING}
function candidatePriority(seed:number,index:number):number{return hashFloat(seed,index,1801)}
function angleBetween(a:{x:number;z:number},b:{x:number;z:number}):number{return Math.acos(Math.max(-1,Math.min(1,a.x*b.x+a.z*b.z)))}

function rawCandidate(seed:number,index:number,spine:RiverSpine,widthProfile:RiverWidthProfile):BridgeCrossingCandidate|undefined{
 const riverDistance=latticePhase(seed)+index*BRIDGE_CANDIDATE_SPACING;
 if(riverDistance<0||riverDistance>spine.totalLength)return;
 const riverProgress=spine.progressAtDistance(riverDistance),frame=spine.sampleFrame(riverProgress);
 // RiverFrame.normal is the deterministic left direction. The bridge's positive
 // longitudinal direction follows it, so every consumer shares left/right.
 const tangent=frame.tangent,direction=frame.normal;
 const localHalfWidth=sampleRiverWidth(widthProfile,riverDistance,spine).halfWidth;
 const bankExtent=localHalfWidth+WORLD_RIVER_CARVING.bankWidth+BRIDGE_LANDING_MARGIN;
 const spanLength=bankExtent*2;
 const point=(side:number,distance:number):BridgePoint=>{const x=frame.position.x+direction.x*distance*side,z=frame.position.z+direction.z*distance*side;return{x,y:sampleTerrainHeight(seed,x,z),z}};
 const left=point(1,bankExtent),right=point(-1,bankExtent),leftApproach=point(1,bankExtent+BRIDGE_APPROACH_DISTANCE),rightApproach=point(-1,bankExtent+BRIDGE_APPROACH_DISTANCE);
 const landingDifference=Math.abs(left.y-right.y),approachSlope=Math.max(Math.abs(leftApproach.y-left.y),Math.abs(rightApproach.y-right.y),landingDifference)/BRIDGE_APPROACH_DISTANCE;
 const probe=spanLength/2+BRIDGE_APPROACH_DISTANCE,before=spine.sampleFrame(spine.progressAtDistance(riverDistance-probe)),after=spine.sampleFrame(spine.progressAtDistance(riverDistance+probe));
 const curvatureRadians=Math.max(angleBetween(before.tangent,tangent),angleBetween(tangent,after.tangent),angleBetween(before.tangent,after.tangent));
 const bankStability=Math.max(0,1-approachSlope*3-curvatureRadians);
 // Higher landing + clearance is deterministic, keeps both ends exposed, and
 // guarantees clearance above the single authoritative water datum.
 const proposedDeckElevation=Math.max(left.y,right.y,WORLD_RIVER_CARVING.surfaceElevation+.35)+.18;
 const ownerChunk=worldToChunk(frame.position.x,frame.position.z),extent=bankExtent+BRIDGE_APPROACH_DISTANCE;
 return{id:`bridge:${seed.toString(16)}:d${index}`,latticeIndex:index,riverDistance,riverProgress,ownerChunk,centre:{...frame.position},riverTangent:{...tangent},crossingDirection:{...direction},waterHalfWidth:localHalfWidth,bankExtent,leftBankAnchor:left,rightBankAnchor:right,landingHeights:{left:left.y,right:right.y},proposedDeckElevation,approachPoints:{left:leftApproach,right:rightApproach},spanLength,bounds:{minX:frame.position.x-Math.abs(direction.x)*extent-3,maxX:frame.position.x+Math.abs(direction.x)*extent+3,minZ:frame.position.z-Math.abs(direction.z)*extent-3,maxZ:frame.position.z+Math.abs(direction.z)*extent+3},curvatureRadians,approachSlope,bankStability,biome:sampleBiome(seed,frame.position.x,frame.position.z).dominant,accepted:false};
}

/** Bounded spatial discovery; lattice indices are obtained from indexed river segments. */
export function queryWorldRiverBridgeCandidates(seedInput:number|string,bounds:WorldBounds2D,spine?:RiverSpine,widthProfile?:RiverWidthProfile):readonly BridgeCrossingCandidate[]{
 const owner=spine?undefined:getWorldRiverOwner(seedInput);spine??=owner!.spine;widthProfile??=owner?.widthProfile;if(!widthProfile)throw new Error("Authoritative river width profile is required for bridge candidates");
 const seed=normalizeSeed(seedInput),segments=spine.queryRiverSegments(bounds,BRIDGE_CANDIDATE_SPACING);
 if(!segments.length)return[];
 const minimum=Math.min(...segments.map(s=>s.start.distance),...segments.map(s=>s.end.distance))-BRIDGE_CANDIDATE_SPACING;
 const maximum=Math.max(...segments.map(s=>s.start.distance),...segments.map(s=>s.end.distance))+BRIDGE_CANDIDATE_SPACING;
 const phase=latticePhase(seed),first=Math.ceil((minimum-phase)/BRIDGE_CANDIDATE_SPACING),last=Math.floor((maximum-phase)/BRIDGE_CANDIDATE_SPACING),found:BridgeCrossingCandidate[]=[];
 for(let index=first;index<=last;index++){const candidate=rawCandidate(seed,index,spine,widthProfile);if(candidate&&candidate.bounds.maxX>=bounds.minX&&candidate.bounds.minX<=bounds.maxX&&candidate.bounds.maxZ>=bounds.minZ&&candidate.bounds.minZ<=bounds.maxZ)found.push(candidate)}
 return found;
}

/** Builds collision and rendering inputs together so structural dimensions cannot drift. */
export function getBridgeDeckTopElevation(bridge:Pick<GeneratedBridge,"crossingCentre"|"scale">):number{return bridge.crossingCentre.y+bridge.scale.profileHeight*.28+.11}
export function createBridgeCollision(bridge:Omit<GeneratedBridge,"collision">):BridgeCollisionDefinition {
 const d=bridge.crossingDirection,n={x:-d.z,z:d.x},stone=bridge.archetype==="stone-bridge",heavy=bridge.archetype==="heavy-timber-bridge";
 const deckTop=getBridgeDeckTopElevation(bridge),thickness=.22;
 const point=(along:number,side:number,y:number):BridgePoint=>({x:bridge.crossingCentre.x+d.x*along+n.x*side,y,z:bridge.crossingCentre.z+d.z*along+n.z*side});
 const crown=bridge.variant==="hump-backed-stone"?bridge.scale.profileHeight*.32:stone?bridge.scale.profileHeight*.12:0;
 const surfaces:BridgeSurfaceRecord[]=[{id:`${bridge.id}:deck`,kind:"deck",centre:point(0,0,deckTop),length:bridge.spanLength,width:bridge.deckWidth,direction:d,startHeight:deckTop,endHeight:deckTop,crownHeight:crown,thickness,solid:true,walkable:true,overhead:true}];
 const rampLength=stone?2.2:heavy?1.8:1.4;
 for(const [side,bank] of [[-1,bridge.bankElevations.left],[1,bridge.bankElevations.right]] as const){const outer=bank+.04;surfaces.push({id:`${bridge.id}:approach:${side}`,kind:"approach",centre:point(side*(bridge.spanLength/2+rampLength/2),0,(deckTop+outer)/2),length:rampLength,width:bridge.deckWidth,direction:d,startHeight:side<0?outer:deckTop,endHeight:side<0?deckTop:outer,crownHeight:0,thickness:.16,solid:true,walkable:true,overhead:true});}
 const railings:BridgeRailingCollider[]=[];if(stone||heavy||bridge.variant!=="bare-plank")for(const side of[-1,1])railings.push({id:`${bridge.id}:rail:${side}`,kind:"railing",start:point(-bridge.spanLength/2,side*(bridge.deckWidth/2-.1),deckTop),end:point(bridge.spanLength/2,side*(bridge.deckWidth/2-.1),deckTop),height:stone?.7:1.35,thickness:stone?.28:.16});
 const solids:BridgeBoxCollider[]=[];
 if(stone){for(const along of[-bridge.spanLength/2+.35,bridge.spanLength/2-.35])solids.push({id:`${bridge.id}:abutment:${along}`,kind:"abutment",centre:point(along,0,bridge.crossingCentre.y-.35),length:.7,width:bridge.deckWidth+.6,height:1.1,direction:d});if(bridge.variant==="single-arch")solids.push({id:`${bridge.id}:pier`,kind:"support",centre:point(0,0,bridge.crossingCentre.y-.5),length:.65,width:bridge.deckWidth-.5,height:.75,direction:d});}
 if(heavy&&bridge.variant==="trestle")for(const along of[-bridge.spanLength*.25,bridge.spanLength*.25])solids.push({id:`${bridge.id}:trestle:${along}`,kind:"support",centre:point(along,0,bridge.crossingCentre.y-.7),length:.35,width:bridge.deckWidth-.3,height:1.3,direction:d});
 const extent=bridge.spanLength/2+rampLength+.5,radius=Math.abs(d.x)*extent+Math.abs(n.x)*(bridge.deckWidth/2+.5),radiusZ=Math.abs(d.z)*extent+Math.abs(n.z)*(bridge.deckWidth/2+.5);
 return{structureId:bridge.id,bridgeId:bridge.id,source:"bridge",ownerChunk:{...bridge.ownerChunk},centre:{...bridge.crossingCentre},direction:{...d},deckWidth:bridge.deckWidth,deckLength:bridge.spanLength,deckThickness:thickness,surfaces,segments:railings,railings,boxes:solids,solids,circles:[],bounds:{minX:bridge.crossingCentre.x-radius,maxX:bridge.crossingCentre.x+radius,minZ:bridge.crossingCentre.z-radiusZ,maxZ:bridge.crossingCentre.z+radiusZ}};
}
export function generateBridges(seedInput:number|string,coordinate:ChunkCoordinate,obstacles:readonly GeneratedPoi[]=[],spine?:RiverSpine,riverIdentity?:string,widthProfile?:RiverWidthProfile):Readonly<{bridges:readonly GeneratedBridge[];candidates:readonly BridgeCrossingCandidate[]}>{
 void obstacles; // compatibility parameter; canonical POIs below prevent caller-order dependence.
 const owner=spine?undefined:getWorldRiverOwner(seedInput);spine??=owner!.spine;widthProfile??=owner?.widthProfile;if(!widthProfile)throw new Error("Authoritative river width profile is required for bridge generation");riverIdentity??=owner?.identity??"explicit-spine";
 const seed=normalizeSeed(seedInput),originX=coordinate.x*CHUNK_SIZE,originZ=coordinate.z*CHUNK_SIZE;
 const cacheKey=`${seed}:${riverIdentity}:${coordinate.x}:${coordinate.z}`,cached=bridgeGenerationCache.get(cacheKey);if(cached)return cached;
 const raw=queryWorldRiverBridgeCandidates(seed,{minX:originX,maxX:originX+CHUNK_SIZE,minZ:originZ,maxZ:originZ+CHUNK_SIZE},spine,widthProfile).filter(candidate=>candidate.ownerChunk.x===coordinate.x&&candidate.ownerChunk.z===coordinate.z);
 const candidates:BridgeCrossingCandidate[]=[],bridges:GeneratedBridge[]=[];
 for(const c of raw){
  let reason:BridgeRejectionReason|undefined;
  if(c.riverDistance<BRIDGE_ENDPOINT_CLEARANCE||c.riverDistance>spine.totalLength-BRIDGE_ENDPOINT_CLEARANCE)reason="near river endpoint";
  else if(candidatePriority(seed,c.latticeIndex)>.72)reason="rarity";
  else if(c.curvatureRadians>BRIDGE_MAX_CURVATURE_RADIANS)reason="river too curved";
  else if(Math.abs(c.landingHeights.left-c.landingHeights.right)>BRIDGE_MAX_LANDING_DIFFERENCE||c.approachSlope>.22)reason="approach slope too high";
  else if(c.bankStability<.3)reason="unstable banks";
  const scores=scoreBridgeArchetypes(seed,c),archetype=(Object.keys(scores) as BridgeArchetype[]).sort((a,b)=>scores[b]-scores[a]||a.localeCompare(b))[0]!,definition=BRIDGE_ARCHETYPES[archetype];
  const rotation=Math.atan2(c.crossingDirection.z,c.crossingDirection.x),deck:PoiFootprint={kind:"rectangle",x:c.centre.x,z:c.centre.z,halfWidth:c.spanLength/2,halfDepth:(definition.deckWidth[1]+.8)/2,rotation};
  const canonicalObstacles:GeneratedPoi[]=[];for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)canonicalObstacles.push(...generatePois(seed,{x:c.ownerChunk.x+dx,z:c.ownerChunk.z+dz},spine,riverIdentity,widthProfile).pois);
  if(!reason&&canonicalObstacles.some(p=>p.zones.some(z=>z.purpose==="solid"&&footprintsOverlap(deck,z.footprint))))reason="building conflict";
  const debug={...c,accepted:!reason,reason,archetype:reason?undefined:archetype};candidates.push(debug);if(reason)continue;
  const width=definition.deckWidth[0]+hashFloat(seed,c.latticeIndex,1901)*(definition.deckWidth[1]-definition.deckWidth[0]),variant=definition.variants[Math.floor(hashFloat(seed,c.latticeIndex,1911)*definition.variants.length)]!,centreY=c.proposedDeckElevation-(archetype==="stone-bridge"?.65:archetype==="heavy-timber-bridge"?.22:.3)*.28-.11,approachHalf=definition.approachLength/2;
  const approachZone=(p:BridgePoint,bank:BridgePoint):PoiZone=>({name:"bridge-approach",purpose:"vegetation-exclusion",footprint:{kind:"rectangle",x:(p.x+bank.x)/2,z:(p.z+bank.z)/2,halfWidth:Math.max(approachHalf,BRIDGE_APPROACH_DISTANCE/2)+.05,halfDepth:width*.72,rotation}});
  const zones:PoiZone[]=[{name:"bridge-deck",purpose:"solid",footprint:deck},{name:"bridge-clearance",purpose:"vegetation-exclusion",footprint:{...deck,halfDepth:width*.8}},approachZone(c.approachPoints.left,c.leftBankAnchor),approachZone(c.approachPoints.right,c.rightBankAnchor)];
  const structural:Omit<GeneratedBridge,"collision">={id:c.id,ownerChunk:{...c.ownerChunk},crossingCentre:{x:c.centre.x,y:centreY,z:c.centre.z},riverTangent:c.riverTangent,crossingDirection:c.crossingDirection,leftBankAnchor:c.leftBankAnchor,rightBankAnchor:c.rightBankAnchor,spanLength:c.spanLength,bankElevations:{left:c.leftBankAnchor.y,right:c.rightBankAnchor.y},deckWidth:width,archetype,variant,approachPoints:c.approachPoints,zones,connections:{},scale:{span:c.spanLength,width,profileHeight:archetype==="stone-bridge"?.65:archetype==="heavy-timber-bridge"?.22:.3},shadowCaster:{x:c.centre.x,z:c.centre.z,width:c.spanLength,depth:width,rotation,height:centreY}};
  bridges.push({...structural,collision:createBridgeCollision(structural)});
 }
 const result={bridges,candidates};bridgeGenerationCache.set(cacheKey,result);while(bridgeGenerationCache.size>512)bridgeGenerationCache.delete(bridgeGenerationCache.keys().next().value!);return result;
}
