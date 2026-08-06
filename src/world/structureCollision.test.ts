import { describe, expect, it } from "vitest";
import { createBridgeCollision, type GeneratedBridge } from "./bridges";
import { BRIDGE_RAILING_TANGENTIAL_RETENTION, queryBridgeCollisions, resolveStructureMovement, selectStructureSupport } from "./structureCollision";
import { MAX_PLAYER_SPEED } from "../player/movement";

function bridge(rotation=0,variant:GeneratedBridge["variant"]="low-timber-railed"):GeneratedBridge {
 const direction={x:Math.cos(rotation),z:Math.sin(rotation)},centre={x:8,y:2,z:8};
 const structural:Omit<GeneratedBridge,"collision">={id:"bridge:test",ownerChunk:{x:0,z:0},crossingCentre:centre,riverTangent:{x:-direction.z,z:direction.x},crossingDirection:direction,leftBankAnchor:{x:4,y:1.7,z:8},rightBankAnchor:{x:12,y:1.7,z:8},spanLength:8,bankElevations:{left:1.7,right:1.7},deckWidth:3,archetype:"pedestrian-footbridge",variant,approachPoints:{left:{x:2,y:1.7,z:8},right:{x:14,y:1.7,z:8}},zones:[],connections:{},scale:{span:8,width:3,profileHeight:.3}};
 return{...structural,collision:createBridgeCollision(structural)};
}

describe("layered bridge structure collision",()=>{
 it("steps onto, remains on, and walks off explicit approaches and deck",()=>{const c=bridge().collision,deck=c.surfaces[0]!;let support=selectStructureSupport([c],4.1,8,deck.startHeight-.2,0,undefined);expect(support?.kind).toBe("deck");support=selectStructureSupport([c],8,8,deck.startHeight,0,deck.id);expect(support?.height).toBeCloseTo(deck.startHeight);expect(selectStructureSupport([c],13.2,8,1.7,0,deck.id)?.kind).toBe("approach");});
 it("uses vertical context instead of snapping a player beneath the deck",()=>{const c=bridge().collision;expect(selectStructureSupport([c],8,8,-1,0,undefined)).toBeUndefined();const r=resolveStructureMovement({x:7,y:-.24,z:8,yaw:0},{x:9,y:-.24,z:8,yaw:0},[c],.76);expect(r.support).toBeUndefined();expect(r.transform.y).toBe(-.24);});
 it("samples a crowned deck and rotated underside consistently",()=>{const c=bridge(Math.PI/3,"hump-backed-stone").collision,deck=c.surfaces[0]!;expect(selectStructureSupport([c],8,8,deck.startHeight+.2,0,undefined)?.height).toBeGreaterThan(deck.startHeight);const r=resolveStructureMovement({x:8,y:deck.startHeight-deck.thickness-1+.76,z:8,yaw:0},{x:8,y:deck.startHeight,z:8,yaw:0},[c],.76);expect(r.ceilingHeight).toBeCloseTo(deck.startHeight+deck.crownHeight-deck.thickness);});
 it("blocks rail crossings while retaining nearly frictionless tangential travel",()=>{const c=bridge().collision,rail=c.railings[0]!,from={x:7,y:3,z:rail.start.z-.5,yaw:0},to={x:9,y:3,z:rail.start.z+.5,yaw:0};const r=resolveStructureMovement(from,to,[c],.76);expect(r.transform.z).toBeLessThan(rail.start.z);expect(r.slide).toBeDefined();expect(Math.abs(r.slide!.x)).toBeGreaterThan(Math.abs(r.slide!.z));expect(BRIDGE_RAILING_TANGENTIAL_RETENTION).toBe(.98);});
 it("sweeps large steps through railings and leaves entrances open",()=>{const c=bridge().collision,rail=c.railings[1]!,blocked=resolveStructureMovement({x:8,y:3,z:rail.start.z-3,yaw:0},{x:8,y:3,z:rail.start.z+3,yaw:0},[c],.76);expect(blocked.transform.z).toBeLessThan(rail.start.z);const entrance=resolveStructureMovement({x:2,y:2.5,z:8,yaw:0},{x:3,y:2.5,z:8,yaw:0},[c],.76);expect(entrance.transform.x).toBeCloseTo(3);});
 it("blocks a maximum-speed fixed step through a thin railing",()=>{const c=bridge().collision,rail=c.railings[0]!,from={x:8,y:3,z:rail.start.z-.04,yaw:0},to={...from,z:from.z+MAX_PLAYER_SPEED/60},blocked=resolveStructureMovement(from,to,[c],.76);expect(blocked.transform.z).toBeLessThan(rail.start.z);});
 it("queries owner chunks without duplicate cross-chunk registration",()=>{const b=bridge(),data={bridges:[b]},repository={get:(id:string)=>id==="0,0"?data:undefined} as never;expect(queryBridgeCollisions(repository,{x:7,z:8},{x:9,z:8})).toEqual([b.collision]);});
});
