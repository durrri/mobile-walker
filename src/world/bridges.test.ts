import { describe, expect, it } from "vitest";
import { BRIDGE_ARCHETYPES, generateBridges, queryWorldRiverBridgeCandidates, scoreBridgeArchetypes, spanSuitability, type BridgeArchetype, type BridgeCrossingCandidate } from "./bridges";
import { createWorldRiverCarvingContext, sampleWorldRiverCarving } from "./worldRiverCarving";
import { getWorldRiverOwner } from "./worldRiverOwner";
import { pointInFootprint } from "./poi";

function context(biome:BridgeCrossingCandidate["biome"]):BridgeCrossingCandidate {
 return {id:`test:${biome}`,latticeIndex:0,riverDistance:40,riverProgress:.2,ownerChunk:{x:0,z:0},centre:{x:8,z:8},riverTangent:{x:0,z:1},crossingDirection:{x:1,z:0},waterHalfWidth:2,bankExtent:4,leftBankAnchor:{x:4,y:.2,z:8},rightBankAnchor:{x:12,y:.25,z:8},landingHeights:{left:.2,right:.25},proposedDeckElevation:.43,approachPoints:{left:{x:1,y:.2,z:8},right:{x:15,y:.25,z:8}},spanLength:8,bounds:{minX:1,maxX:15,minZ:6,maxZ:10},curvatureRadians:0,approachSlope:.02,bankStability:.9,biome,accepted:false};
}

describe("deterministic span POIs",()=>{
 it("scores archetypes from context rather than using river width as a type class",()=>{
  const forest=scoreBridgeArchetypes(4,context("forest"));
  expect(Math.max(forest["pedestrian-footbridge"],forest["heavy-timber-bridge"])).toBeGreaterThan(forest["stone-bridge"]);
  const highland=scoreBridgeArchetypes(4,context("highlands"));
  expect(highland["stone-bridge"]).toBeGreaterThan(highland["pedestrian-footbridge"]);
  expect(scoreBridgeArchetypes(4,context("wetland"))["stone-bridge"]).toBeLessThan(0);
  for(const id of Object.keys(BRIDGE_ARCHETYPES) as BridgeArchetype[])expect(spanSuitability(id,8)).toBeGreaterThan(.5);
 });

 it("is deterministic, perpendicular, bank-to-bank, excluded, and singly owned",()=>{
  let result:ReturnType<typeof generateBridges>|undefined;
  for(let seed=1;seed<40&&!result?.bridges.length;seed++)for(let z=-30;z<=30&&!result?.bridges.length;z++)result=generateBridges(seed,{x:0,z});
  const bridge=result!.bridges[0]!;
  const bridgeSeed=Number.parseInt(bridge.id.split(":")[1]!,16),spine=getWorldRiverOwner(bridgeSeed).spine;
  const carving=createWorldRiverCarvingContext(spine.bounds,spine);
  expect(generateBridges(Number.parseInt(bridge.id.split(":")[1]!,16),bridge.ownerChunk).bridges).toEqual([bridge]);
  expect(Math.abs(bridge.riverTangent.x*bridge.crossingDirection.x+bridge.riverTangent.z*bridge.crossingDirection.z)).toBeLessThan(1e-9);
  expect(Math.hypot(bridge.rightBankAnchor.x-bridge.leftBankAnchor.x,bridge.rightBankAnchor.z-bridge.leftBankAnchor.z)).toBeCloseTo(bridge.spanLength,8);
  expect(sampleWorldRiverCarving(bridge.leftBankAnchor.x,bridge.leftBankAnchor.z,carving)!.insideChannel).toBe(false);
  expect(sampleWorldRiverCarving(bridge.rightBankAnchor.x,bridge.rightBankAnchor.z,carving)!.insideChannel).toBe(false);
  for(const approach of [bridge.approachPoints.left,bridge.approachPoints.right])expect(bridge.zones.some(z=>z.purpose==="vegetation-exclusion"&&pointInFootprint(approach.x,approach.z,z.footprint))).toBe(true);
  expect(generateBridges(Number.parseInt(bridge.id.split(":")[1]!,16),{x:1,z:bridge.ownerChunk.z}).bridges).toHaveLength(0);
 });

 it("keeps deck width archetype-owned and at most one shadow caster",()=>{
  for(const definition of Object.values(BRIDGE_ARCHETYPES))expect(definition.deckWidth[1]-definition.deckWidth[0]).toBeGreaterThan(0);
  const types=new Set<BridgeArchetype>();let checked=0;for(let seed=1;seed<10;seed++)for(const candidate of queryWorldRiverBridgeCandidates(seed,{minX:-90,maxX:90,minZ:-140,maxZ:120}))for(const bridge of generateBridges(seed,candidate.ownerChunk).bridges){const range=BRIDGE_ARCHETYPES[bridge.archetype].deckWidth;expect(bridge.deckWidth).toBeGreaterThanOrEqual(range[0]);expect(bridge.deckWidth).toBeLessThanOrEqual(range[1]);expect(bridge.shadowCaster).toBeDefined();types.add(bridge.archetype);checked++;}
  expect(checked).toBeGreaterThan(0);
  expect(types.size).toBeGreaterThanOrEqual(2);
 });

 it("does not allocate candidate debug records in normal chunk output",async()=>{
  const {generateChunk}=await import("./generateChunk");
  expect(generateChunk(7,{x:0,z:0}).bridgeCandidates).toBeUndefined();
  expect(generateChunk(7,{x:0,z:0},undefined,true).bridgeCandidates).toBeDefined();
 });
});
