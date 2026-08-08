import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { PoiBeaconState } from "../game/poiBeaconState";
import { generateChunk } from "../world/generateChunk";
import { poiFixture } from "../world/riverProceduralFixtures";
import type { GeneratedPoi, PoiBeaconFixtureKind } from "../world/poi";
import { BeaconLightManager, PoiBeaconPresentation, type BeaconLightCandidate } from "./poiBeaconPresentation";

function generatedPoi(): GeneratedPoi {
  const seed=0, fixture=poiFixture(seed,candidate=>candidate.typeId==="plains-farmhouse");
  const poi=generateChunk(seed,fixture.chunk).pois.find(candidate=>candidate.id===fixture.poi.id);
  if(!poi)throw new Error("Expected generated beacon POI fixture");return poi;
}
const candidate=(poiId:string,fixture:PoiBeaconFixtureKind,x:number,priority=1,active=true):BeaconLightCandidate=>({id:`${poiId}:${fixture}`,poiId,fixture,position:{x,y:0,z:0},priority,range:8,intensity:1,active});

describe("POI beacon presentation consumer",()=>{
  it("uses generated anchors, preserves independent state, and keeps emissive visuals without light slots",()=>{
    const poi=generatedPoi(),state=new PoiBeaconState();state.light(poi,"fire");
    const scene=new THREE.Scene(),presentation=new PoiBeaconPresentation(scene,state,0),fixtures=presentation.activatePoi(poi);
    const fire=fixtures.find(value=>value.kind==="fire")!,lantern=fixtures.find(value=>value.kind==="lantern")!;
    expect(fire.group.position.toArray()).toEqual(Object.values(poi.beacon!.fixtures.find(value=>value.kind==="fire")!.anchor));
    expect(fire.flame).toBeDefined();expect(fire.smoke?.children).toHaveLength(3);expect(fire.glow).toBeUndefined();
    expect(lantern.lit).toBe(false);expect(lantern.glow).toBeUndefined();expect(presentation.lightManager.selectedIds).toEqual([]);
    presentation.refreshPoi(poi);expect(presentation.activatePoi(poi)).toHaveLength(2);expect(presentation.root.children.filter(child=>child.name===`${poi.id}:fire`)).toHaveLength(1);
    presentation.dispose();presentation.dispose();expect(state.getState(poi.id)).toEqual({fireLit:true,lanternLit:false});expect(scene.children).not.toContain(presentation.root);
  });

  it("keeps a lantern visibly luminous with zero PointLight slots",()=>{
    const poi=generatedPoi(),state=new PoiBeaconState();state.light(poi,"lantern");
    const presentation=new PoiBeaconPresentation(new THREE.Scene(),state,0),lantern=presentation.activatePoi(poi).find(value=>value.kind==="lantern")!;
    expect(lantern.glow).toBeDefined();expect(presentation.lightManager.lights).toHaveLength(0);presentation.dispose();
  });

  it("keeps both fixture visuals when only one of two lit fixtures receives a PointLight",()=>{
    const poi=generatedPoi(),state=new PoiBeaconState();state.light(poi,"lantern");state.light(poi,"fire");
    const presentation=new PoiBeaconPresentation(new THREE.Scene(),state,1),fixtures=presentation.activatePoi(poi);
    presentation.update({x:poi.position.x,y:poi.position.y,z:poi.position.z});
    expect(presentation.lightManager.selectedIds).toHaveLength(1);
    expect(fixtures.find(value=>value.kind==="lantern")?.glow).toBeDefined();
    expect(fixtures.find(value=>value.kind==="fire")?.flame).toBeDefined();
    expect(fixtures.find(value=>value.kind==="fire")?.smoke).toBeDefined();presentation.dispose();
  });

  it("passes every fixture group through renderer-owned world preparation",()=>{
    const poi=generatedPoi(),state=new PoiBeaconState();state.light(poi,"lantern");state.light(poi,"fire");
    const prepareWorldObject=vi.fn(),presentation=new PoiBeaconPresentation(new THREE.Scene(),state,0,prepareWorldObject);
    const fixtures=presentation.activatePoi(poi);
    expect(prepareWorldObject.mock.calls.map(([object])=>object)).toEqual(fixtures.map(fixture=>fixture.group));
    expect(prepareWorldObject.mock.calls.every(([object])=>{
      let meshes=0;object.traverse((child:THREE.Object3D)=>{if(child instanceof THREE.Mesh)meshes++;});return meshes>0;
    })).toBe(true);presentation.dispose();
  });
});

describe("bounded beacon light allocation",()=>{
  it("uses a retained shadow-free pool, explicit priority/distance, and deterministic identity ties",()=>{
    const root=new THREE.Group(),manager=new BeaconLightManager(root,2);
    const pool=[...manager.lights];manager.upsert(candidate("z","fire",2));manager.upsert(candidate("b","lantern",1));manager.upsert(candidate("a","fire",1));manager.update({x:0,y:0,z:0});
    expect(manager.selectedIds).toEqual(["a:fire","b:lantern"]);expect(manager.lights).toEqual(pool);expect(manager.lights.every(light=>!light.castShadow)).toBe(true);expect(manager.lights.filter(light=>light.visible)).toHaveLength(2);
    manager.retire("a:fire");manager.update({x:1,y:0,z:0});expect(manager.selectedIds).toContain("z:fire");expect(manager.lights).toEqual(pool);manager.dispose();expect(root.children).toHaveLength(0);
  });

  it("is load-order independent, rejects inactive candidates, and retains near-equal selections",()=>{
    const select=(items:BeaconLightCandidate[])=>{const manager=new BeaconLightManager(new THREE.Group(),1);for(const item of items)manager.upsert(item);manager.update({x:0,y:0,z:0});const first=manager.selectedIds[0];manager.update({x:.3,y:0,z:0});const retained=manager.selectedIds[0];return{first,retained,count:manager.lights.filter(light=>light.visible).length};};
    const a=candidate("a","fire",5),b=candidate("b","lantern",5.1),off=candidate("off","fire",0,10,false);
    expect(select([b,off,a])).toEqual(select([a,off,b]));expect(select([a,b])).toEqual({first:"a:fire",retained:"a:fire",count:1});
  });
});
