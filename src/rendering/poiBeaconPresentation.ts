import * as THREE from "three";
import type { PoiBeaconState } from "../game/poiBeaconState";
import type { GeneratedPoi, PoiBeaconFixtureKind, PoiBeaconProfile } from "../world/poi";

export interface BeaconSmokeProfile { readonly puffs: number; readonly height: number; readonly scale: number }
export interface BeaconPresentationProfile {
  readonly priority: number; readonly glowScale: number; readonly lightRange: number;
  readonly lightIntensity: number; readonly smoke?: BeaconSmokeProfile;
}

/** Presentation tuning only. It deliberately contains no POI type names or gameplay state. */
export const BEACON_PRESENTATION_PROFILES: Readonly<Record<PoiBeaconProfile, Readonly<Record<PoiBeaconFixtureKind, BeaconPresentationProfile>>>> = Object.freeze({
  homestead: Object.freeze({ lantern: Object.freeze({ priority: 1, glowScale: .28, lightRange: 7, lightIntensity: 1.25 }), fire: Object.freeze({ priority: 1.1, glowScale: .5, lightRange: 8, lightIntensity: 1.5, smoke: Object.freeze({ puffs: 3, height: 3.8, scale: .65 }) }) }),
  waterside: Object.freeze({ lantern: Object.freeze({ priority: 1.1, glowScale: .3, lightRange: 8, lightIntensity: 1.35 }), fire: Object.freeze({ priority: 1.1, glowScale: .5, lightRange: 8, lightIntensity: 1.5, smoke: Object.freeze({ puffs: 3, height: 4, scale: .7 }) }) }),
  cabin: Object.freeze({ lantern: Object.freeze({ priority: .9, glowScale: .26, lightRange: 7, lightIntensity: 1.2 }), fire: Object.freeze({ priority: 1, glowScale: .48, lightRange: 8, lightIntensity: 1.45, smoke: Object.freeze({ puffs: 3, height: 3.6, scale: .62 }) }) }),
  "regional-watchtower": Object.freeze({ lantern: Object.freeze({ priority: 1.5, glowScale: .34, lightRange: 9, lightIntensity: 1.5 }), fire: Object.freeze({ priority: 1.7, glowScale: .58, lightRange: 10, lightIntensity: 1.8, smoke: Object.freeze({ puffs: 3, height: 4.6, scale: .8 }) }) }),
});

export interface BeaconLightCandidate {
  readonly id: string; readonly poiId: string; readonly fixture: PoiBeaconFixtureKind;
  readonly position: Readonly<{x:number;y:number;z:number}>; readonly priority: number;
  readonly range: number; readonly intensity: number; readonly active: boolean;
}

const candidateId = (poiId: string, fixture: PoiBeaconFixtureKind) => `${poiId}:${fixture}`;

/** Sole owner of a retained, shadow-free PointLight pool. */
export class BeaconLightManager {
  static readonly DEFAULT_BUDGET = 4;
  readonly lights: readonly THREE.PointLight[];
  private readonly candidates = new Map<string, BeaconLightCandidate>();
  private selected: string[] = [];
  private dirty = true;
  private camera = { x: Infinity, y: Infinity, z: Infinity };

  constructor(parent: THREE.Object3D, readonly maximumLights = BeaconLightManager.DEFAULT_BUDGET, private readonly retentionDistance = 1.5) {
    this.lights = Array.from({ length: Math.max(0, maximumLights) }, () => {
      const light = new THREE.PointLight(0xffa044, 0, 0, 2); light.castShadow = false; light.visible = false; parent.add(light); return light;
    });
  }
  upsert(candidate: BeaconLightCandidate): void { if (!candidate.active) return this.retire(candidate.id); this.candidates.set(candidate.id, candidate); this.dirty = true; }
  retire(id: string): void { if (this.candidates.delete(id)) this.dirty = true; }
  hasCandidate(id: string): boolean { return this.candidates.has(id); }
  get selectedIds(): readonly string[] { return this.selected; }
  update(camera: Readonly<{x:number;y:number;z:number}>): void {
    if (Math.hypot(camera.x-this.camera.x,camera.y-this.camera.y,camera.z-this.camera.z) >= .25) { this.camera={...camera}; this.dirty=true; }
    if (!this.dirty) return;
    const retained = new Set(this.selected);
    const score = (candidate: BeaconLightCandidate) => Math.hypot(candidate.position.x-camera.x,candidate.position.y-camera.y,candidate.position.z-camera.z) - candidate.priority * 10 - (retained.has(candidate.id) ? this.retentionDistance : 0);
    const ranked = [...this.candidates.values()].sort((a,b) => score(a)-score(b) || a.id.localeCompare(b.id)).slice(0,this.lights.length);
    this.selected = ranked.map(candidate => candidate.id);
    this.lights.forEach((light,index) => { const candidate=ranked[index]; if(!candidate){light.visible=false;light.intensity=0;return;} light.position.copy(candidate.position as THREE.Vector3Like); light.distance=candidate.range; light.intensity=candidate.intensity; light.visible=true; });
    this.dirty=false;
  }
  dispose(): void { for(const light of this.lights) light.removeFromParent(); this.candidates.clear(); this.selected=[]; }
}

export interface BeaconFixturePresentation {
  readonly id:string; readonly kind:PoiBeaconFixtureKind; readonly lit:boolean; readonly group:THREE.Group;
  readonly glow?:THREE.Object3D; readonly flame?:THREE.Object3D; readonly smoke?:THREE.Object3D;
}
interface PoiHandle { readonly poi:GeneratedPoi; readonly fixtures:BeaconFixturePresentation[]; disposed:boolean }

/** Read-only bridge from generated definitions and gameplay-owned state to Three.js presentation. */
export class PoiBeaconPresentation {
  static readonly defaultLightBudget = BeaconLightManager.DEFAULT_BUDGET;
  readonly root = new THREE.Group(); readonly lightManager: BeaconLightManager;
  private readonly handles = new Map<string,PoiHandle>();
  private readonly lanternGeometry = new THREE.OctahedronGeometry(1,0);
  private readonly flameGeometry = new THREE.ConeGeometry(1,2,5);
  private readonly smokeGeometry = new THREE.SphereGeometry(1,5,4);
  private readonly fixtureMaterial = new THREE.MeshBasicMaterial({color:0x493728});
  private readonly glowMaterial = new THREE.MeshBasicMaterial({color:0xffbd59});
  private readonly flameMaterial = new THREE.MeshBasicMaterial({color:0xff7138});
  private readonly smokeMaterial = new THREE.MeshBasicMaterial({color:0x8b8b84,transparent:true,opacity:.48,depthWrite:false});
  private disposed=false;
  constructor(scene:THREE.Scene, private readonly state:Pick<PoiBeaconState,"getState">, maximumLights=BeaconLightManager.DEFAULT_BUDGET, private readonly prepareWorldObject:(object:THREE.Object3D)=>void=()=>undefined) { this.root.name="poi-beacons";scene.add(this.root);this.lightManager=new BeaconLightManager(this.root,maximumLights); }
  activatePoi(poi:GeneratedPoi): readonly BeaconFixturePresentation[] {
    if(this.disposed||this.handles.has(poi.id)||!poi.beacon)return this.handles.get(poi.id)?.fixtures??[];
    const state=this.state.getState(poi.id), fixtures:BeaconFixturePresentation[]=[];
    for(const definition of poi.beacon.fixtures) {
      if(definition.kind!=="fire"&&definition.kind!=="lantern")continue;
      const lit=definition.kind==="fire"?state.fireLit:state.lanternLit, profile=BEACON_PRESENTATION_PROFILES[poi.beacon.profile][definition.kind];
      const group=new THREE.Group();group.name=candidateId(poi.id,definition.kind);group.position.copy(definition.anchor as THREE.Vector3Like);this.root.add(group);
      const fixture=new THREE.Mesh(this.lanternGeometry,this.fixtureMaterial);fixture.scale.setScalar(definition.kind==="lantern"?.16:.22);group.add(fixture);
      let glow:THREE.Object3D|undefined,flame:THREE.Object3D|undefined,smoke:THREE.Object3D|undefined;
      if(lit&&definition.kind==="lantern"){glow=new THREE.Mesh(this.lanternGeometry,this.glowMaterial);glow.scale.setScalar(profile.glowScale);group.add(glow);}
      if(lit&&definition.kind==="fire"){flame=new THREE.Mesh(this.flameGeometry,this.flameMaterial);flame.position.y=.42;flame.scale.set(profile.glowScale,.55,profile.glowScale);group.add(flame);smoke=new THREE.Group();for(let i=0;i<(profile.smoke?.puffs??0);i++){const puff=new THREE.Mesh(this.smokeGeometry,this.smokeMaterial);const t=(i+1)/(profile.smoke!.puffs+1);puff.position.set((i%2?-.12:.12)*t,.7+t*profile.smoke!.height,0);puff.scale.setScalar(profile.smoke!.scale*(.55+t*.55));smoke.add(puff);}group.add(smoke);}
      const id=candidateId(poi.id,definition.kind);if(lit)this.lightManager.upsert({id,poiId:poi.id,fixture:definition.kind,position:definition.anchor,priority:profile.priority,range:profile.lightRange,intensity:profile.lightIntensity,active:true});
      fixtures.push({id,kind:definition.kind,lit,group,glow,flame,smoke});
    }
    this.handles.set(poi.id,{poi,fixtures,disposed:false});
    // ThreeRenderer remains the owner of world-material preparation, including fog.
    for (const fixture of fixtures) this.prepareWorldObject(fixture.group);
    return fixtures;
  }
  refreshPoi(poi:GeneratedPoi): readonly BeaconFixturePresentation[] { this.retirePoi(poi.id); return this.activatePoi(poi); }
  retirePoi(poiId:string):void { const handle=this.handles.get(poiId);if(!handle||handle.disposed)return;handle.disposed=true;for(const fixture of handle.fixtures){this.lightManager.retire(fixture.id);fixture.group.removeFromParent();}this.handles.delete(poiId); }
  update(camera:Readonly<{x:number;y:number;z:number}>):void { this.lightManager.update(camera); }
  hasPoi(poiId:string):boolean{return this.handles.has(poiId);}
  dispose():void {if(this.disposed)return;this.disposed=true;for(const id of [...this.handles.keys()])this.retirePoi(id);this.lightManager.dispose();this.root.removeFromParent();this.lanternGeometry.dispose();this.flameGeometry.dispose();this.smokeGeometry.dispose();this.fixtureMaterial.dispose();this.glowMaterial.dispose();this.flameMaterial.dispose();this.smokeMaterial.dispose();}
}
