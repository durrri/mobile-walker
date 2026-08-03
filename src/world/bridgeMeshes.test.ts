import type * as THREE from "three";
import { describe, expect, it } from "vitest";

import { BridgeMeshFactory } from "./bridgeMeshes";
import { createBridgeCollision, generateBridges, type BridgeArchetype, type GeneratedBridge } from "./bridges";

function bridge(archetype:BridgeArchetype):GeneratedBridge{const structural:Omit<GeneratedBridge,"collision">={
 id:`test-${archetype}`,ownerChunk:{x:0,z:0},crossingCentre:{x:0,y:2.18,z:0},riverTangent:{x:0,z:1},crossingDirection:{x:1,z:0},
 leftBankAnchor:{x:-4,y:2,z:0},rightBankAnchor:{x:4,y:2.05,z:0},spanLength:8,bankElevations:{left:2,right:2.05},deckWidth:3,
 archetype,variant:archetype==="stone-bridge"?"shallow-stone-span":archetype==="heavy-timber-bridge"?"simple-beam":"bare-plank",
 approachPoints:{left:{x:-7,y:2,z:0},right:{x:7,y:2.05,z:0}},zones:[],connections:{},scale:{span:8,width:3,profileHeight:archetype==="stone-bridge"?.65:archetype==="heavy-timber-bridge"?.22:.3},
};return {...structural,collision:createBridgeCollision(structural)};}

describe("bridge entry ramps",()=>{
 it.each(["pedestrian-footbridge","heavy-timber-bridge","stone-bridge"] as const)("adds gently sloped, deck-width ramps to both ends of a %s",archetype=>{
  const factory=new BridgeMeshFactory(),mesh=factory.create(bridge(archetype));
  const deck=mesh.getObjectByName("bridge-deck")!;
  const left=mesh.getObjectByName("left-entry-ramp")!;
  const right=mesh.getObjectByName("right-entry-ramp")!;

  expect(left).toBeDefined();
  expect(right).toBeDefined();
  expect(left.scale.z).toBe(deck.scale.z);
  expect(right.scale.z).toBe(deck.scale.z);
  expect(left.position.x).toBeLessThan(-deck.scale.x/2);
  expect(right.position.x).toBeGreaterThan(deck.scale.x/2);
  expect(left.rotation.z).toBeGreaterThan(0);
  expect(right.rotation.z).toBeLessThan(0);
  expect(Math.abs(left.rotation.z)).toBeLessThan(Math.PI/6);
  expect((left as THREE.Mesh).material).toBe((deck as THREE.Mesh).material);
  expect((right as THREE.Mesh).material).toBe((deck as THREE.Mesh).material);
  factory.dispose();
 });
});

describe("world-river bridge diagnostics",()=>{
 it("renders bounded candidate frames, status, owner bounds and diagnostic readouts",()=>{
  const candidates=generateBridges(7,{x:0,z:3}).candidates;
  const factory=new BridgeMeshFactory(),debug=factory.createDebug(candidates);
  expect(candidates.length).toBeGreaterThan(0);
  expect(debug.getObjectByName("bridge-debug:tangents")).toBeDefined();
  expect(debug.getObjectByName("bridge-debug:axes-landings-approaches")).toBeDefined();
  expect(debug.getObjectByName("bridge-debug:owners")).toBeDefined();
  expect(debug.getObjectByName(candidates[0]!.accepted?"bridge-debug:accepted":"bridge-debug:rejected")).toBeDefined();
  expect(debug.userData.diagnostics[0]).toMatchObject({id:candidates[0]!.id,accepted:candidates[0]!.accepted,ownerChunk:candidates[0]!.ownerChunk,reason:candidates[0]!.reason});
  factory.dispose();
 });
});
