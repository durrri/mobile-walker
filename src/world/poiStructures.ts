import type { GeneratedPoi, PoiBeaconDefinition, PoiBeaconProfile } from "./poi";
import type { StructureBoxCollider, StructureCircularCollider, StructureCollisionDefinition, StructureComponent, StructureComponentCategory, StructureMaterialKey, StructureSegmentCollider, StructureSurfaceRecord } from "./structureTypes";
import { validateStructureDefinition } from "./structureTypes";

export const FOUNDATION_GROUND_EMBED=.12;
export const POI_DIMENSIONS=Object.freeze({
 house:{foundation:[6.2,5.2] as const,foundationTop:.375,walls:[5.7,2.8,4.7] as const,wallsY:1.72},
 porch:{size:[4,.22,1.25] as const,centre:[0,.55,2.85] as const},
 cabin:{base:[4.8,.3,4] as const,walls:[4.5,2.35,3.7] as const,legs:[-1.8,1.8] as const,legZ:[-1.45,1.45] as const,legWidth:.28,legTop:1.15},
 tower:{legs:[-1.55,1.55] as const,legWidth:.38,legTop:6.8,platform:[4.2,.3,4.2] as const,platformY:6.55,mass:[3.55,2.25,3.55] as const,massY:7.75},
 fence:{railHeight:.18,railY:.72,postWidth:.2,postHeight:1.2,segments:[[-4.7,-3.8,5.5,.16],[4.7,-3.8,5.5,.16],[-6.9,0,.16,7.7],[6.9,0,.16,7.7],[-4.7,3.8,4.1,.16],[4.7,3.8,4.1,.16]] as const},
 dock:{width:2.1,thickness:.16,postWidth:.18,postHeight:1.25},
});

export function foundationDepth(poi:GeneratedPoi,minimumDepth=.12):number{const minimum=poi.metadata?.terrain?.minimumHeight;return Number.isFinite(minimum)?Math.max(minimumDepth,poi.position.y-minimum+FOUNDATION_GROUND_EMBED):minimumDepth;}
/** The shared structure-local to world-space convention used by geometry and semantic anchors. */
export function poiLocalToWorld(poi:GeneratedPoi,x:number,y:number,z:number):Readonly<{x:number;y:number;z:number}>{const c=Math.cos(poi.rotation),s=Math.sin(poi.rotation);return{x:poi.position.x+c*x+s*z,y:poi.position.y+y,z:poi.position.z-s*x+c*z};}
const world=poiLocalToWorld;

/** Presentation-neutral beacon capability and placement, derived once with the POI structure. */
export function createPoiBeaconDefinition(poi:GeneratedPoi):PoiBeaconDefinition|undefined {
 const configurations:Partial<Record<string,Readonly<{profile:PoiBeaconProfile;fire:readonly[number,number,number];lantern:readonly[number,number,number]}>>>={
  "plains-farmhouse":{profile:"homestead",fire:[-1.65,5.1,-.5],lantern:[0,2.15,2.5]},
  "lake-house":{profile:"waterside",fire:[-1.65,5.1,-.5],lantern:[0,2.15,2.5]},
  "forest-cabin":{profile:"cabin",fire:[-2.8,.25,1.5],lantern:[0,1.8,1.98]},
  "highland-watchtower":{profile:"regional-watchtower",fire:[-1.15,6.85,0],lantern:[0,8.35,1.82]},
 };
 const configuration=configurations[poi.typeId];if(!configuration)return undefined;
 return Object.freeze({profile:configuration.profile,fixtures:Object.freeze([
  Object.freeze({id:"fire" as const,kind:"fire" as const,anchor:Object.freeze(world(poi,...configuration.fire))}),
  Object.freeze({id:"lantern" as const,kind:"lantern" as const,anchor:Object.freeze(world(poi,...configuration.lantern))}),
 ])});
}

/** Authoritative, presentation-neutral inventory. Ordinary rigid components are
 * solid by default; every visual-only component explicitly opts out. */
export function createPoiComponents(poi:GeneratedPoi):readonly StructureComponent[]{
 const out:StructureComponent[]=[],depth=foundationDepth(poi),add=(id:string,c:object)=>out.push({...c,id:`${poi.id}:${id}`,structureId:poi.id} as StructureComponent);
 const rigid=(id:string,kind:StructureComponentCategory,material:StructureMaterialKey,size:readonly[number,number,number],position:readonly[number,number,number],walkable=false)=>add(id,{primitive:walkable?"slab":"box",kind,material,centre:world(poi,...position),rotation:poi.rotation,rendered:true,walkable,overhead:walkable,response:"rigid",length:size[0],height:size[1],width:size[2],...(walkable?{startHeight:poi.position.y+position[1]+size[1]/2,endHeight:poi.position.y+position[1]+size[1]/2,crownHeight:0}: {})} as never);
 const cylinder=(id:string,kind:StructureComponentCategory,material:StructureMaterialKey,x:number,z:number,top:number,width:number,y=(top-depth)/2)=>add(id,{primitive:"cylinder",kind,material,centre:world(poi,x,y,z),rotation:poi.rotation,rendered:true,walkable:false,overhead:false,response:"rigid",radius:width/2,height:top+depth});
 const visual=(id:string,kind:StructureComponentCategory,material:StructureMaterialKey,primitive:"visual-box"|"roof",size:readonly[number,number,number],position:readonly[number,number,number])=>add(id,{primitive,kind,material,centre:world(poi,...position),rotation:poi.rotation,rendered:true,solid:false,decorative:true,walkable:false,overhead:false,response:"rigid",length:size[0],height:size[1],width:size[2]});
 const overlays=(base=0)=>{visual("door","overlay","door","visual-box",[1.05,2,.12],[0,1.3+base,2.42]);visual("window-left","overlay","window","visual-box",[1.05,.85,.1],[-1.75,1.95+base,2.44]);visual("window-right","overlay","window","visual-box",[1.05,.85,.1],[1.75,1.95+base,2.44]);visual("side-window","overlay","window","visual-box",[.1,.9,1.2],[2.88,1.95+base,0]);};
 if(poi.typeId==="plains-farmhouse"||poi.typeId==="lake-house"){
  const h=POI_DIMENSIONS.house;rigid("foundation","foundation","darkWood",[h.foundation[0],h.foundationTop+depth,h.foundation[1]],[0,(h.foundationTop-depth)/2,0]);rigid("walls","wall",poi.typeId==="lake-house"?"lakeWall":"wall",h.walls,[0,h.wallsY,0]);visual("roof","roof","roof","roof",[6.5,1.65,5.35],[0,3.945,0]);overlays();rigid("chimney","support","chimney",[.62,2,.62],[-1.65,4.05,-.5]);
  if(poi.typeId==="lake-house"){rigid("porch","porch","wood",POI_DIMENSIONS.porch.size,POI_DIMENSIONS.porch.centre,true);rigid("bench-seat","prop","wood",[2,.18,.55],[-3.9,.8,1.2]);rigid("bench-back","prop","wood",[2,.75,.15],[-3.9,1.2,.95]);if(poi.dock&&poi.dock.footprint.kind==="rectangle"){const fp=poi.dock.footprint,local=worldToLocal(poi,fp.x,fp.z),length=fp.halfDepth*2,localY=poi.dock.surfaceElevation+.12-poi.position.y;for(let z=-length/2+.35,index=0;z<length/2;z+=.7,index++){rigid(`dock-plank:${index}`,"dock","wood",[.62,POI_DIMENSIONS.dock.thickness,POI_DIMENSIONS.dock.width],[local.x,localY,local.z+z],true);const last=out[out.length-1]! as StructureComponent&{rotation:number};(last as {rotation:number}).rotation=poi.rotation+Math.PI/2;}for(const x of[-1,1])for(const z of[-length/2+.3,length/2-.3])cylinder(`dock-post:${x}:${z}`,"support","darkWood",local.x+x,local.z+z,POI_DIMENSIONS.dock.postHeight,POI_DIMENSIONS.dock.postWidth,localY-.42);}}
  else for(const [index,[x,z,sx,sz]] of POI_DIMENSIONS.fence.segments.entries()){const horizontal=sx>sz,half=(horizontal?sx:sz)/2,a=world(poi,x-(horizontal?half:0),POI_DIMENSIONS.fence.railY,z-(horizontal?0:half)),b=world(poi,x+(horizontal?half:0),POI_DIMENSIONS.fence.railY,z+(horizontal?0:half));add(`fence-rail:${index}`,{primitive:"segment",kind:"fence",material:"wood",centre:world(poi,x,POI_DIMENSIONS.fence.railY,z),rotation:poi.rotation,rendered:true,walkable:false,overhead:false,response:"rigid",start:a,end:b,height:POI_DIMENSIONS.fence.railHeight,thickness:horizontal?sz:sx});for(const side of[-1,1])cylinder(`fence-post:${index}:${side}`,"fence","darkWood",x+(horizontal?side*half:0),z+(horizontal?0:side*half),POI_DIMENSIONS.fence.postHeight,POI_DIMENSIONS.fence.postWidth);}
 }else if(poi.typeId==="forest-cabin"){
  const c=POI_DIMENSIONS.cabin,raised=poi.metadata.biome==="wetland",base=raised?1.05:.25;if(raised){for(const x of c.legs)for(const z of c.legZ)cylinder(`stilt:${x}:${z}`,"stilt","darkWood",x,z,c.legTop,c.legWidth);rigid("raised-base","platform","darkWood",c.base,[0,base,0],true);}else rigid("low-foundation","foundation","darkWood",[c.base[0],.4+depth,c.base[2]],[0,(.4-depth)/2,0]);rigid("cabin-walls","wall","wood",c.walls,[0,base+1.28,0]);visual("cabin-roof","roof","roof","roof",[5.1,1.25,4.25],[0,base+3.075,0]);visual("cabin-door","overlay","door","visual-box",[.85,1.8,.1],[0,base+1.05,1.9]);visual("cabin-window","overlay","window","visual-box",[1,.75,.1],[1.35,base+1.55,1.91]);
 }else if(poi.typeId==="highland-watchtower"){
  const t=POI_DIMENSIONS.tower;for(const x of t.legs)for(const z of t.legs)cylinder(`tower-leg:${x}:${z}`,"stilt","darkWood",x,z,t.legTop,t.legWidth);rigid("tower-platform","platform","wood",t.platform,[0,t.platformY,0]);rigid("tower-mass","wall","wall",t.mass,[0,t.massY,0]);visual("tower-roof","roof","roof","roof",[4.35,1.25,4.35],[0,9.5,0]);visual("tower-door","overlay","door","visual-box",[.8,1.75,.1],[0,7.55,1.79]);
 }
 return out;
}

export function createPoiStructure(poi:GeneratedPoi):StructureCollisionDefinition{
 const components=createPoiComponents(poi),boxes:StructureBoxCollider[]=[],circles:StructureCircularCollider[]=[],segments:StructureSegmentCollider[]=[],surfaces:StructureSurfaceRecord[]=[];
 for(const c of components){if(c.solid===false)continue;const direction={x:Math.cos(c.rotation),z:-Math.sin(c.rotation)};if(c.primitive==="box")boxes.push({id:c.id,kind:c.kind,centre:c.centre,length:c.length,width:c.width,height:c.height,direction});else if(c.primitive==="cylinder")circles.push({id:c.id,kind:c.kind,centre:c.centre,radius:c.radius,height:c.height});else if(c.primitive==="segment")segments.push({id:c.id,kind:c.kind as "railing"|"fence",start:c.start,end:c.end,height:c.height,thickness:c.thickness});else if(c.primitive==="slab")surfaces.push({id:c.id,kind:c.kind as StructureSurfaceRecord["kind"],centre:c.centre,length:c.length,width:c.width,direction,startHeight:c.startHeight,endHeight:c.endHeight,crownHeight:c.crownHeight,thickness:c.height,solid:true,walkable:c.walkable,overhead:c.overhead});}
 const points=[...boxes.flatMap(b=>extent(b.centre,b.length,b.width)),...circles.flatMap(c=>[{x:c.centre.x-c.radius,z:c.centre.z-c.radius},{x:c.centre.x+c.radius,z:c.centre.z+c.radius}]),...segments.flatMap(s=>[s.start,s.end]),...surfaces.flatMap(s=>extent(s.centre,s.length,s.width))];
 const definition={structureId:poi.id,ownerChunk:{...poi.ownerChunk},source:"poi" as const,components,boxes,circles,segments,surfaces,bounds:{minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))}};validateStructureDefinition(definition);return definition;
}
function extent(centre:{x:number;z:number},length:number,width:number){const r=Math.hypot(length,width)/2;return[{x:centre.x-r,z:centre.z-r},{x:centre.x+r,z:centre.z+r}];}
function worldToLocal(poi:GeneratedPoi,x:number,z:number){const dx=x-poi.position.x,dz=z-poi.position.z,c=Math.cos(poi.rotation),s=Math.sin(poi.rotation);return{x:dx*c-dz*s,z:dx*s+dz*c};}
