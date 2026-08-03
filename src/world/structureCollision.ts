import type { TransformComponent } from "../ecs/Entity";
import { CIRCULAR_COLLISION_SEPARATION_EPSILON } from "./circularCollision";
import { CHUNK_SIZE, worldToChunk } from "./chunkCoordinates";
import { chunkId } from "./chunkId";
import type { GeneratedChunkRepository } from "./GeneratedChunkRepository";
import type { StructureBoxCollider, StructureCollisionDefinition, StructureSurfaceRecord } from "./structureTypes";
import { generatePois } from "./poi";
import { generateBridges } from "./bridges";

export const PLAYER_STRUCTURE_COLLISION_HEIGHT=1.5;
export const STRUCTURE_STEP_UP_HEIGHT=.42;
export const STRUCTURE_TANGENTIAL_RETENTION=.98;
/** @deprecated Shared by every structure obstacle, not only bridge railings. */
export const BRIDGE_RAILING_TANGENTIAL_RETENTION=STRUCTURE_TANGENTIAL_RETENTION;
export const STRUCTURE_COLLISION_MAX_ITERATIONS=6;
export interface StructureSupport{readonly id:string;readonly kind:StructureSurfaceRecord["kind"];readonly height:number}
export interface StructureCollisionResult{readonly transform:TransformComponent;readonly support?:StructureSupport;readonly ceilingHeight?:number;readonly contactNormal?:Readonly<{x:number;z:number}>;readonly slide?:Readonly<{x:number;z:number}>}

/** Bounded active owner-chunk lookup returning bridges and POIs once by structure ID. */
export function queryStructureCollisions(repository:GeneratedChunkRepository,from:Pick<TransformComponent,"x"|"z">,to:Pick<TransformComponent,"x"|"z">,margin=1):readonly StructureCollisionDefinition[]{
 const query={minX:Math.min(from.x,to.x)-margin,maxX:Math.max(from.x,to.x)+margin,minZ:Math.min(from.z,to.z)-margin,maxZ:Math.max(from.z,to.z)+margin},min=worldToChunk(query.minX-CHUNK_SIZE,query.minZ-CHUNK_SIZE),max=worldToChunk(query.maxX+CHUNK_SIZE,query.maxZ+CHUNK_SIZE),found:StructureCollisionDefinition[]=[],ids=new Set<string>();
 for(let z=min.z;z<=max.z;z++)for(let x=min.x;x<=max.x;x++){const data=repository.get(chunkId({x,z}));if(!data)continue;const definitions=[...(data.bridges??[]).map(b=>b.collision),...(data.pois??[]).map(p=>p.structure)];for(const definition of definitions){if(ids.has(definition.structureId)||definition.bounds.maxX<query.minX||definition.bounds.minX>query.maxX||definition.bounds.maxZ<query.minZ||definition.bounds.minZ>query.maxZ)continue;ids.add(definition.structureId);found.push(definition);}}
 return found.sort((a,b)=>a.structureId.localeCompare(b.structureId));
}
/** @deprecated Use the unified structure query. */
export const queryBridgeCollisions=queryStructureCollisions;

function surfaceHeight(surface:StructureSurfaceRecord,x:number,z:number,radius=0):number|undefined{const dx=x-surface.centre.x,dz=z-surface.centre.z,u=dx*surface.direction.x+dz*surface.direction.z,v=-dx*surface.direction.z+dz*surface.direction.x;if(Math.abs(u)>surface.length/2+radius||Math.abs(v)>surface.width/2+radius)return;const t=Math.max(0,Math.min(1,u/surface.length+.5));return surface.startHeight+(surface.endHeight-surface.startHeight)*t+surface.crownHeight*4*t*(1-t);}

export type StructureRestorationSafety = Readonly<{ kind:"walkable";height:number }|{ kind:"solid" }> | undefined;

/** Two-dimensional restoration policy over the authoritative collision records.
 * Blocking primitives deliberately win over broad walkable slabs (for example a
 * bridge railing at the edge of its deck). */
export function classifyStructureRestorationSafety(
 collisions:readonly StructureCollisionDefinition[],x:number,z:number,radius:number,
):StructureRestorationSafety {
 let walkableHeight:number|undefined;
 for(const structure of collisions){
  if(structure.bounds.maxX<x-radius||structure.bounds.minX>x+radius||structure.bounds.maxZ<z-radius||structure.bounds.minZ>z+radius)continue;
  for(const circle of structure.circles)if(Math.hypot(x-circle.centre.x,z-circle.centre.z)<radius+circle.radius)return{kind:"solid"};
  for(const box of structure.boxes)if(circleBox(x,z,box,radius))return{kind:"solid"};
  for(const segment of structure.segments)if(circleSegment(x,z,segment.start.x,segment.start.z,segment.end.x,segment.end.z,radius+segment.thickness/2))return{kind:"solid"};
  for(const surface of structure.surfaces){const height=surfaceHeight(surface,x,z,radius*.2);if(height===undefined)continue;if(!surface.walkable)return{kind:"solid"};if(walkableHeight===undefined||height>walkableHeight)walkableHeight=height;}
 }
 return walkableHeight===undefined?undefined:{kind:"walkable",height:walkableHeight};
}

/** Canonical pre-streaming structure query. Generation is deterministic and
 * cached by owner chunk, so restoration sees the same records later installed
 * in GeneratedChunkRepository without requiring rendered or resident chunks. */
export function createCanonicalStructureSafetyQuery(seed:number|string):(x:number,z:number,radius:number)=>StructureRestorationSafety {
 const cache=new Map<string,readonly StructureCollisionDefinition[]>();
 const owned=(x:number,z:number):readonly StructureCollisionDefinition[]=>{const id=`${x},${z}`,hit=cache.get(id);if(hit)return hit;const coordinate={x,z},pois=generatePois(seed,coordinate).pois.map(p=>p.structure),bridges=generateBridges(seed,coordinate).bridges.map(b=>b.collision),value=Object.freeze([...pois,...bridges]);cache.set(id,value);return value;};
 return(x,z,radius)=>{const min=worldToChunk(x-radius-CHUNK_SIZE,z-radius-CHUNK_SIZE),max=worldToChunk(x+radius+CHUNK_SIZE,z+radius+CHUNK_SIZE),definitions:StructureCollisionDefinition[]=[],ids=new Set<string>();for(let cz=min.z;cz<=max.z;cz++)for(let cx=min.x;cx<=max.x;cx++)for(const definition of owned(cx,cz))if(!ids.has(definition.structureId)){ids.add(definition.structureId);definitions.push(definition);}return classifyStructureRestorationSafety(definitions,x,z,radius);};
}
export function selectStructureSupport(collisions:readonly StructureCollisionDefinition[],x:number,z:number,feetY:number,verticalVelocity:number,previousSupportId:string|undefined,radius=.38):StructureSupport|undefined{let best:StructureSupport|undefined;for(const structure of collisions)for(const surface of structure.surfaces){if(!surface.walkable)continue;const height=surfaceHeight(surface,x,z,radius*.2);if(height===undefined)continue;const retained=verticalVelocity<=0&&previousSupportId===surface.id&&Math.abs(feetY-height)<=STRUCTURE_STEP_UP_HEIGHT+.18,reachable=verticalVelocity<=0&&height<=feetY+STRUCTURE_STEP_UP_HEIGHT&&height>=feetY-.32;if(!retained&&!reachable)continue;if(!best||Math.abs(height-feetY)<Math.abs(best.height-feetY))best={id:surface.id,kind:surface.kind,height};}return best;}
function circleSegment(x:number,z:number,ax:number,az:number,bx:number,bz:number,radius:number){const dx=bx-ax,dz=bz-az,l2=dx*dx+dz*dz,t=l2?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l2)):0,qx=ax+dx*t,qz=az+dz*t,ox=x-qx,oz=z-qz,d=Math.hypot(ox,oz),length=Math.sqrt(l2);return d<radius?{x:d?ox/d:length?-dz/length:1,z:d?oz/d:length?dx/length:0,depth:radius-d}:undefined;}
function circleBox(x:number,z:number,box:StructureBoxCollider,radius:number){const dx=x-box.centre.x,dz=z-box.centre.z,u=dx*box.direction.x+dz*box.direction.z,v=-dx*box.direction.z+dz*box.direction.x,cu=Math.max(-box.length/2,Math.min(box.length/2,u)),cv=Math.max(-box.width/2,Math.min(box.width/2,v)),du=u-cu,dv=v-cv,dist=Math.hypot(du,dv);if(dist>=radius)return;let nu:number,nv:number,depth:number;if(dist){nu=du/dist;nv=dv/dist;depth=radius-dist;}else{const eu=box.length/2+radius-Math.abs(u),ev=box.width/2+radius-Math.abs(v);if(eu<ev){nu=Math.sign(u)||1;nv=0;depth=eu;}else{nu=0;nv=Math.sign(v)||1;depth=ev;}}return{x:nu*box.direction.x-nv*box.direction.z,z:nu*box.direction.z+nv*box.direction.x,depth};}

interface SweepHit{readonly id:string;readonly time:number;readonly x:number;readonly z:number;readonly primitive:"circle"|"box"|"slab"|"segment"}
function circleSweep(id:string,cx:number,cz:number,r:number,x:number,z:number,dx:number,dz:number,primitive:SweepHit["primitive"]="circle"):SweepHit|undefined{const ox=x-cx,oz=z-cz,a=dx*dx+dz*dz,b=2*(ox*dx+oz*dz);if(a<1e-12||b>=0)return;const disc=b*b-4*a*(ox*ox+oz*oz-r*r);if(disc<0)return;const time=(-b-Math.sqrt(disc))/(2*a);if(time<0||time>1)return;const hx=ox+dx*time,hz=oz+dz*time,l=Math.hypot(hx,hz);if(!l)return;return{id,time,x:hx/l,z:hz/l,primitive};}
/** Sweep a circle against an OBB. Face hits and the four rounded expanded
 * corners are tested separately, so this is not the oversized square-Minkowski
 * approximation commonly produced by a ray/expanded-AABB test. */
function boxSweep(box:StructureBoxCollider,r:number,x:number,z:number,dx:number,dz:number,primitive:SweepHit["primitive"]="box"):SweepHit|undefined{const c=box.direction.x,s=box.direction.z,ox=x-box.centre.x,oz=z-box.centre.z,u=ox*c+oz*s,v=-ox*s+oz*c,du=dx*c+dz*s,dv=-dx*s+dz*c,hu=box.length/2,hv=box.width/2;let best:SweepHit|undefined;const take=(time:number,nu:number,nv:number)=>{if(time<0||time>1)return;const hit={id:box.id,time,x:nu*c-nv*s,z:nu*s+nv*c,primitive} as SweepHit;if(!best||hit.time<best.time)best=hit;};if(du>0){const t=(-hu-r-u)/du;if(Math.abs(v+dv*t)<=hv)take(t,-1,0);}else if(du<0){const t=(hu+r-u)/du;if(Math.abs(v+dv*t)<=hv)take(t,1,0);}if(dv>0){const t=(-hv-r-v)/dv;if(Math.abs(u+du*t)<=hu)take(t,0,-1);}else if(dv<0){const t=(hv+r-v)/dv;if(Math.abs(u+du*t)<=hu)take(t,0,1);}for(const cu of[-hu,hu])for(const cv of[-hv,hv]){const h=circleSweep(box.id,cu,cv,r,u,v,du,dv,primitive);if(h)take(h.time,h.x,h.z);}return best;}
function segmentSweep(id:string,ax:number,az:number,bx:number,bz:number,r:number,x:number,z:number,dx:number,dz:number):SweepHit|undefined{const sx=bx-ax,sz=bz-az,length=Math.hypot(sx,sz);if(!length)return circleSweep(id,ax,az,r,x,z,dx,dz,"segment");const ux=sx/length,uz=sz/length,centre={x:(ax+bx)/2,y:0,z:(az+bz)/2};return boxSweep({id,kind:"railing",centre,length,width:0,height:1,direction:{x:ux,z:uz}},r,x,z,dx,dz,"segment");}
function earlier(a:SweepHit|undefined,b:SweepHit|undefined):SweepHit|undefined{if(!a)return b;if(!b)return a;return b.time<a.time-1e-9||Math.abs(b.time-a.time)<=1e-9&&b.id.localeCompare(a.id)<0?b:a;}

/** Shared swept/iterative horizontal contacts plus layered floors and undersides. */
export function resolveStructureMovement(from:TransformComponent,to:TransformComponent,collisions:readonly StructureCollisionDefinition[],heightOffset:number,previousSupportId?:string,radius=.38,playerHeight=PLAYER_STRUCTURE_COLLISION_HEIGHT):StructureCollisionResult{
 if(![from.x,from.y,from.z,to.x,to.y,to.z].every(Number.isFinite))return{transform:{...from}};
 const feet=from.y-heightOffset,p={x:from.x,z:from.z};let remainingX=to.x-from.x,remainingZ=to.z-from.z,normal:Readonly<{x:number;z:number}>|undefined,slide:Readonly<{x:number;z:number}>|undefined;
 const vertical=(bottom:number,top:number)=>feet+playerHeight>bottom+1e-6&&feet<top-1e-6;
 // Initial invalid-state recovery is deliberately separate from normal movement.
 for(let iteration=0;iteration<STRUCTURE_COLLISION_MAX_ITERATIONS;iteration++){let correction:{id:string;x:number;z:number;depth:number}|undefined;for(const structure of collisions){for(const circle of structure.circles){if(!vertical(circle.centre.y-circle.height/2,circle.centre.y+circle.height/2))continue;const ox=p.x-circle.centre.x,oz=p.z-circle.centre.z,d=Math.hypot(ox,oz),depth=radius+circle.radius-d;if(depth>0){const h={id:circle.id,x:d?ox/d:1,z:d?oz/d:0,depth};if(!correction||h.depth<correction.depth||h.depth===correction.depth&&h.id<correction.id)correction=h;}}for(const box of structure.boxes){if(!vertical(box.centre.y-box.height/2,box.centre.y+box.height/2))continue;const h=circleBox(p.x,p.z,box,radius);if(h&&(!correction||h.depth<correction.depth||h.depth===correction.depth&&box.id<correction.id))correction={id:box.id,...h};}for(const segment of structure.segments){if(!vertical(Math.min(segment.start.y,segment.end.y)-segment.height/2,Math.max(segment.start.y,segment.end.y)+segment.height/2))continue;const h=circleSegment(p.x,p.z,segment.start.x,segment.start.z,segment.end.x,segment.end.z,radius+segment.thickness/2);if(h&&(!correction||h.depth<correction.depth||h.depth===correction.depth&&segment.id<correction.id))correction={id:segment.id,...h};}}if(!correction)break;p.x+=correction.x*(correction.depth+CIRCULAR_COLLISION_SEPARATION_EPSILON);p.z+=correction.z*(correction.depth+CIRCULAR_COLLISION_SEPARATION_EPSILON);normal=correction;}
 for(let iteration=0;iteration<STRUCTURE_COLLISION_MAX_ITERATIONS&&remainingX*remainingX+remainingZ*remainingZ>1e-12;iteration++){let hit:SweepHit|undefined;for(const structure of collisions){for(const circle of structure.circles){if(vertical(circle.centre.y-circle.height/2,circle.centre.y+circle.height/2))hit=earlier(hit,circleSweep(circle.id,circle.centre.x,circle.centre.z,radius+circle.radius,p.x,p.z,remainingX,remainingZ));}for(const box of structure.boxes){if(vertical(box.centre.y-box.height/2,box.centre.y+box.height/2))hit=earlier(hit,boxSweep(box,radius,p.x,p.z,remainingX,remainingZ));}for(const segment of structure.segments){if(vertical(Math.min(segment.start.y,segment.end.y)-segment.height/2,Math.max(segment.start.y,segment.end.y)+segment.height/2))hit=earlier(hit,segmentSweep(segment.id,segment.start.x,segment.start.z,segment.end.x,segment.end.z,radius+segment.thickness/2,p.x,p.z,remainingX,remainingZ));}for(const surface of structure.surfaces){if(!surface.solid)continue;const localTop=surfaceHeight(surface,p.x,p.z)??Math.min(surface.startHeight,surface.endHeight),underside=localTop-surface.thickness,reachable=surface.walkable&&localTop<=feet+STRUCTURE_STEP_UP_HEIGHT+1e-6;if(!vertical(underside,localTop)||reachable||previousSupportId===surface.id)continue;hit=earlier(hit,boxSweep({id:surface.id,kind:surface.kind,centre:surface.centre,length:surface.length,width:surface.width,height:surface.thickness,direction:surface.direction},radius,p.x,p.z,remainingX,remainingZ,"slab"));}}
  if(!hit){p.x+=remainingX;p.z+=remainingZ;break;}p.x+=remainingX*hit.time+hit.x*CIRCULAR_COLLISION_SEPARATION_EPSILON;p.z+=remainingZ*hit.time+hit.z*CIRCULAR_COLLISION_SEPARATION_EPSILON;remainingX*=1-hit.time;remainingZ*=1-hit.time;const inward=remainingX*hit.x+remainingZ*hit.z;if(inward<0){remainingX-=hit.x*inward;remainingZ-=hit.z*inward;}remainingX*=STRUCTURE_TANGENTIAL_RETENTION;remainingZ*=STRUCTURE_TANGENTIAL_RETENTION;normal={x:hit.x,z:hit.z};slide={x:remainingX,z:remainingZ};}
 const candidateY=to.y-heightOffset,support=selectStructureSupport(collisions,p.x,p.z,candidateY,to.y-from.y,previousSupportId,radius);let y=to.y,ceilingHeight:number|undefined;if(support&&to.y-from.y<=0)y=support.height+heightOffset;
 for(const structure of collisions)for(const surface of structure.surfaces){if(!surface.overhead)continue;const top=surfaceHeight(surface,p.x,p.z);if(top===undefined)continue;const underside=top-surface.thickness;if(candidateY<underside&&candidateY+playerHeight>underside){ceilingHeight=ceilingHeight===undefined?underside:Math.min(ceilingHeight,underside);y=Math.min(y,underside-playerHeight+heightOffset);}}
 return{transform:{...to,x:p.x,z:p.z,y},support,ceilingHeight,contactNormal:normal,slide};
}
