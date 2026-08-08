import type * as THREE from "three";
import type { RenderSystem } from "../ecs/System";
import { chunkId, type ChunkId } from "./chunkId";
import { CHUNK_SIZE, resolveNeighborhoodOffsets, selectChunkCenter, type ChunkCoordinate, type ChunkNeighborhoodOffsets } from "./chunkCoordinates";
import { ChunkMeshFactory, type ChunkActivationStage } from "./chunkMeshes";
import { ChunkActivationJob } from "./ChunkActivationJob";
import { generateChunk, type GeneratedChunkData } from "./generateChunk";
import type { SunlightDirection } from "../rendering/sunlightDirection";
import { GeneratedChunkRepository } from "./GeneratedChunkRepository";
import { canonicalTerrainChunkId, queryChunkTerrainSurface, type ActiveTerrainSurfaceDiagnostics, type ActiveTerrainSurfaceHit } from "./activeTerrainSurface";

type ChunkGenerator = (seed: number | string, coordinate: ChunkCoordinate) => GeneratedChunkData | Promise<GeneratedChunkData>;
export interface ChunkStreamingOptions {
  readonly offsets?: Partial<ChunkNeighborhoodOffsets>;
  readonly generationWorkPerFrame?: number;
  /** Deprecated compatibility limit. Supplying it uses complete activation. */
  readonly meshWorkPerFrame?: number;
  /** Main-thread activation allowance; atomic stages may finish just over it. */
  readonly activationBudgetMs?: number;
  readonly cacheSize?: number;
  readonly dataCacheSize?: number;
  readonly prefetchRings?: number;
  readonly directionalPrefetchRows?: number;
  readonly repository?: GeneratedChunkRepository;
  readonly generator?: ChunkGenerator;
  readonly meshFactory?: ChunkMeshFactory;
  readonly sunlightDirection?: SunlightDirection;
  readonly clock?: () => number;
  /** Registers newly-created world materials with the shared fog shader patch. */
  readonly prepareWorldObject?: (object: THREE.Object3D) => void;
  /** Presentation-only lifecycle hooks; generated data remains authoritative. */
  readonly onChunkPresented?: (data: GeneratedChunkData) => void;
  readonly onChunkRetired?: (data: GeneratedChunkData) => void;
}
export interface ChunkStreamingDiagnostics {
  generationQueued: number; generationInProgress: number; workerBusy: boolean; workerRequestBacklog: number; awaitingActivation: number; partiallyActivated: number;
  lastWorkerGenerationMs: number; maxWorkerGenerationMs: number; lastRequestRoundTripMs: number; maxRequestRoundTripMs: number;
  activationMsThisFrame: number; longestActivationStage: string; longestActivationStageMs: number;
  cacheHits: number; cacheMisses: number; firstRenderMs: number;
  stageTimes: Partial<Record<ChunkActivationStage, number>>;
}
interface CachedChunk { readonly data: GeneratedChunkData; readonly group?: THREE.Group; }
interface WorkerReply { requestId: number; data: GeneratedChunkData; generationMs: number; }
function createWorkerGenerator(onTiming: (generation: number, transfer: number) => void, now: () => number): { generate: ChunkGenerator; dispose: () => void } | undefined {
  if (typeof Worker === "undefined") return undefined;
  const worker = new Worker(new URL("./generateChunk.worker.ts", import.meta.url), { type: "module" });
  let nextRequestId = 0;
  const pending = new Map<number, { resolve: (data: GeneratedChunkData) => void; reject: (error: Error) => void; dispatchedAt: number }>();
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    const request = pending.get(event.data.requestId); if (!request) return;
    pending.delete(event.data.requestId);
    onTiming(event.data.generationMs, Math.max(0, now() - request.dispatchedAt));
    request.resolve(event.data.data);
  };
  worker.onerror = event => { const error = new Error(event.message || "Chunk generation worker failed"); for (const p of pending.values()) p.reject(error); pending.clear(); };
  return { generate: (seed, coordinate) => new Promise((resolve, reject) => { const requestId = nextRequestId++; pending.set(requestId, { resolve, reject, dispatchedAt: now() }); worker.postMessage({ requestId, seed, coordinate }); }), dispose: () => { worker.terminate(); for (const p of pending.values()) p.reject(new Error("Chunk streaming disposed")); pending.clear(); } };
}

export class ChunkStreamingSystem implements RenderSystem {
  private readonly active = new Map<ChunkId, THREE.Group>();
  private readonly activeData = new Map<ChunkId, GeneratedChunkData>();
  private readonly jobs = new Map<ChunkId, ChunkActivationJob>();
  private readonly requestedAdditions = new Map<ChunkId, ChunkCoordinate>();
  private readonly requestedRemovals = new Map<ChunkId, THREE.Group>();
  private readonly generating = new Set<ChunkId>();
  private readonly ready = new Map<ChunkId, CachedChunk>();
  private readonly cache = new Map<ChunkId, CachedChunk>();
  private readonly meshes: ChunkMeshFactory; private readonly generator: ChunkGenerator; private readonly disposeGenerator: () => void;
  private readonly generationWorkPerFrame: number; private readonly legacyMeshWork?: number; private readonly activationBudgetMs: number;
  private readonly cacheSize: number; private readonly directionalPrefetchRows: number; private readonly now: () => number;
  private readonly prepareWorldObject: (object: THREE.Object3D) => void;
  private readonly onChunkPresented: (data: GeneratedChunkData) => void;
  private readonly onChunkRetired: (data: GeneratedChunkData) => void;
  readonly repository: GeneratedChunkRepository;
  private offsets: ChunkNeighborhoodOffsets; private wanted = new Set<ChunkId>(); private dataWanted = new Set<ChunkId>();
  private center?: ChunkCoordinate; private priorityDirection = { x: 0, z: -1 }; private disposed = false;
  private diagnostics: ChunkStreamingDiagnostics = { generationQueued: 0, generationInProgress: 0, workerBusy: false, workerRequestBacklog: 0, awaitingActivation: 0, partiallyActivated: 0, lastWorkerGenerationMs: 0, maxWorkerGenerationMs: 0, lastRequestRoundTripMs: 0, maxRequestRoundTripMs: 0, activationMsThisFrame: 0, longestActivationStage: "none", longestActivationStageMs: 0, cacheHits: 0, cacheMisses: 0, firstRenderMs: 0, stageTimes: {} };

  constructor(private readonly scene: THREE.Scene, private readonly seed: number | string, private readonly radius = 1, options: ChunkStreamingOptions = {}) {
    this.now = options.clock ?? (() => performance.now()); this.meshes = options.meshFactory ?? new ChunkMeshFactory(options.sunlightDirection);
    this.prepareWorldObject = options.prepareWorldObject ?? (() => undefined);
    this.onChunkPresented = options.onChunkPresented ?? (() => undefined); this.onChunkRetired = options.onChunkRetired ?? (() => undefined);
    const worker = options.generator ? undefined : createWorkerGenerator((g, t) => this.recordWorkerTiming(g, t), this.now);
    this.generator = options.generator ?? worker?.generate ?? generateChunk; this.disposeGenerator = worker?.dispose ?? (() => undefined);
    this.generationWorkPerFrame = Math.max(0, options.generationWorkPerFrame ?? 1); this.legacyMeshWork = options.meshWorkPerFrame;
    this.activationBudgetMs = Math.max(0, options.activationBudgetMs ?? 2.5); this.cacheSize = Math.max(0, options.dataCacheSize ?? options.cacheSize ?? 32);
    this.directionalPrefetchRows = Math.max(0, options.directionalPrefetchRows ?? options.prefetchRings ?? (options.generator ? 0 : 1)); this.repository = options.repository ?? new GeneratedChunkRepository(); this.offsets = resolveNeighborhoodOffsets(this.radius, options.offsets);
  }
  setDebugView(options: import("./chunkMeshes").DebugViewOptions): void { this.meshes.setDebugView(options); }
  setShadowsEnabled(enabled: boolean): void { this.meshes.setShadowsEnabled(enabled); }
  setNeighborhoodOffsets(offsets: Partial<ChunkNeighborhoodOffsets>): void { this.offsets = resolveNeighborhoodOffsets(this.radius, offsets); }
  getDiagnostics(): Readonly<ChunkStreamingDiagnostics> { return this.diagnostics; }
  /** Runtime physical terrain query. Only visually active chunks are considered; no procedural fallback is used. */
  queryActiveTerrainSurface(worldX: number, worldZ: number): ActiveTerrainSurfaceHit | undefined {
    const id = canonicalTerrainChunkId(worldX, worldZ);
    const primary = this.activeData.get(id);
    const hit = primary ? queryChunkTerrainSurface(primary, worldX, worldZ) : undefined;
    if (hit) return hit;
    const comma = id.indexOf(","), chunkX = Number(id.slice(0, comma)), chunkZ = Number(id.slice(comma + 1));
    const localX = worldX - chunkX * CHUNK_SIZE, localZ = worldZ - chunkZ * CHUNK_SIZE;
    const west = localX <= 1e-7, east = CHUNK_SIZE - localX <= 1e-7;
    const north = localZ <= 1e-7, south = CHUNK_SIZE - localZ <= 1e-7;
    const tryNeighbor = (x: number, z: number): ActiveTerrainSurfaceHit | undefined => {
      const data = this.activeData.get(chunkId({ x, z }));
      return data ? queryChunkTerrainSurface(data, worldX, worldZ) : undefined;
    };
    // Fixed order: cardinal neighbors first, then the exact-corner diagonal. No all-chunk scan or allocations.
    if (west) { const alternate = tryNeighbor(chunkX - 1, chunkZ); if (alternate) return alternate; }
    if (east) { const alternate = tryNeighbor(chunkX + 1, chunkZ); if (alternate) return alternate; }
    if (north) { const alternate = tryNeighbor(chunkX, chunkZ - 1); if (alternate) return alternate; }
    if (south) { const alternate = tryNeighbor(chunkX, chunkZ + 1); if (alternate) return alternate; }
    if ((west || east) && (north || south)) {
      const alternate = tryNeighbor(chunkX + (west ? -1 : 1), chunkZ + (north ? -1 : 1));
      if (alternate) return alternate;
    }
    return undefined;
  }
  /** Development-only explanatory comparison; callers opt in and provide the procedural sampler lazily. */
  queryActiveTerrainSurfaceDiagnostics(worldX: number, worldZ: number, procedural?: (x: number, z: number) => number): ActiveTerrainSurfaceDiagnostics | undefined {
    const hit = this.queryActiveTerrainSurface(worldX, worldZ);
    if (!hit) return undefined;
    const proceduralHeight = procedural?.(worldX, worldZ);
    return proceduralHeight === undefined ? hit : { ...hit, proceduralHeight, proceduralDifference: proceduralHeight - hit.height };
  }

  prepareRender(world: Parameters<RenderSystem["prepareRender"]>[0], _interpolation?: number, _deltaSeconds?: number): void {
    const player = world.entities.find(entity => entity.playerControl && entity.transform); if (!player?.transform || this.disposed) return;
    this.center = selectChunkCenter(player.transform.x, player.transform.z, this.center);
    const speed = Math.hypot(player.velocity?.x ?? 0, player.velocity?.z ?? 0);
    this.priorityDirection = speed > .001 ? { x: (player.velocity?.x ?? 0) / speed, z: (player.velocity?.z ?? 0) / speed } : { x: 0, z: -1 };
    this.selectNeighborhood(); this.processGeneration(); this.processMeshes(); this.processSafeRemovals(); this.updateDiagnosticCounts();
  }
  private selectNeighborhood(): void {
    if (!this.center) return; const wanted = new Set<ChunkId>(); const dataWanted = new Set<ChunkId>();
    for (let z = this.center.z - this.offsets.north; z <= this.center.z + this.offsets.south; z++) for (let x = this.center.x - this.offsets.west; x <= this.center.x + this.offsets.east; x++) {
      const coordinate = { x, z }; const id = chunkId(coordinate); dataWanted.add(id);
      const active = z >= this.center.z - this.offsets.north && z <= this.center.z + this.offsets.south && x >= this.center.x - this.offsets.west && x <= this.center.x + this.offsets.east;
      if (active) { wanted.add(id); this.requestedRemovals.delete(id); }
      if (!this.active.has(id) && !this.ready.has(id) && !this.generating.has(id) && !this.jobs.has(id)) this.requestedAdditions.set(id, coordinate);
    }
    const horizontal = Math.abs(this.priorityDirection.x) > Math.abs(this.priorityDirection.z);
    for (let row = 1; row <= this.directionalPrefetchRows; row++) {
      if (horizontal) { const x=this.center.x+(this.priorityDirection.x>=0?this.offsets.east+row:-this.offsets.west-row); for(let z=this.center.z-this.offsets.north;z<=this.center.z+this.offsets.south;z++) dataWanted.add(chunkId({x,z})); }
      else { const z=this.center.z+(this.priorityDirection.z>=0?this.offsets.south+row:-this.offsets.north-row); for(let x=this.center.x-this.offsets.west;x<=this.center.x+this.offsets.east;x++) dataWanted.add(chunkId({x,z})); }
    }
    for (const id of dataWanted) if (!this.active.has(id) && !this.ready.has(id) && !this.generating.has(id) && !this.jobs.has(id)) { const [x,z]=id.split(",").map(Number); this.requestedAdditions.set(id,{x:x!,z:z!}); }
    for (const [id, group] of this.active) if (!wanted.has(id)) this.requestedRemovals.set(id, group);
    for (const [id, job] of this.jobs) if (!wanted.has(id) && !this.active.has(id)) { this.jobs.delete(id); job.cancel(); this.putInCache(id, { data: job.data }); }
    for (const [id] of this.requestedAdditions) if (!dataWanted.has(id)) this.requestedAdditions.delete(id);
    for (const [id, value] of this.ready) if (!dataWanted.has(id)) { this.ready.delete(id); this.putInCache(id, value); }
    this.wanted = wanted; this.dataWanted = dataWanted;
  }
  private ordered<T>(entries: Iterable<[ChunkId, T]>): [ChunkId, T][] { return [...entries].sort(([a], [b]) => this.priorityScore(a) - this.priorityScore(b)); }
  private priorityScore(id: ChunkId): number { if (!this.center) return 0; const [x,z] = id.split(",").map(Number); const dx=x!-this.center.x,dz=z!-this.center.z,d=Math.hypot(dx,dz); const ahead=d===0?1:(dx*this.priorityDirection.x+dz*this.priorityDirection.z)/d; return d-ahead*.7; }
  private processGeneration(): void {
    if (this.generating.size > 0) return;
    for (const [id, coordinate] of this.ordered(this.requestedAdditions).slice(0, this.generationWorkPerFrame)) {
      this.requestedAdditions.delete(id); const cached=this.cache.get(id);
      if (cached) { this.cache.delete(id); this.ready.set(id,cached); this.diagnostics.cacheHits++; continue; }
      this.diagnostics.cacheMisses++; this.generating.add(id); const start=this.now();
      try { const result=this.generator(this.seed,coordinate); if(result instanceof Promise) { void result.then(data=>this.finishGeneration(id,data),()=>this.retryGeneration(id,coordinate)); break; } else { this.recordWorkerTiming(this.now()-start,0); this.finishGeneration(id,result); } } catch { this.retryGeneration(id,coordinate); }
    }
  }
  private finishGeneration(id: ChunkId,data: GeneratedChunkData): void { this.generating.delete(id); if(this.disposed)return; this.repository.set(id,data); if(!this.dataWanted.has(id)) this.putInCache(id,{data}); else this.ready.set(id,{data}); }
  private retryGeneration(id:ChunkId,c:ChunkCoordinate):void { this.generating.delete(id); if(!this.disposed&&this.dataWanted.has(id))this.requestedAdditions.set(id,c); }
  private processMeshes(): void {
    this.diagnostics.activationMsThisFrame=0;
    if(this.legacyMeshWork!==undefined) { for(const [id,r] of this.ordered(this.ready).filter(([id])=>this.wanted.has(id)).slice(0,Math.max(0,this.legacyMeshWork))) { this.ready.delete(id); const start=this.now(); const group=r.group??this.meshes.create(r.data); this.recordStage("details",this.now()-start); this.activateComplete(id,r.data,group); } return; }
    for(const [id,r] of this.ordered(this.ready)) if(this.wanted.has(id)&&!this.jobs.has(id)) { this.ready.delete(id); this.jobs.set(id,new ChunkActivationJob(r.data,this.meshes)); }
    for(const [id,job] of this.ordered(this.jobs)) {
      while(!job.complete) {
        if(this.diagnostics.activationMsThisFrame>=this.activationBudgetMs) return;
        const timing=job.step(); if(!timing) break; this.prepareWorldObject(job.group); this.recordStage(timing.stage,timing.milliseconds);
        if(job.terrainReady&&!this.active.has(id)) { this.active.set(id,job.group); this.activeData.set(id,job.data); this.scene.add(job.group); this.onChunkPresented(job.data); }
      }
      if(job.complete) { this.jobs.delete(id); this.meshes.registerGroup(job.group); }
    }
  }
  private activateComplete(id:ChunkId,data:GeneratedChunkData,group:THREE.Group):void { this.prepareWorldObject(group);this.meshes.registerGroup(group); this.active.set(id,group);this.activeData.set(id,data);this.scene.add(group);this.onChunkPresented(data); }
  private processSafeRemovals():void { if([...this.wanted].some(id=>!this.active.has(id)))return; for(const [id,group] of this.requestedRemovals){this.requestedRemovals.delete(id);if(this.wanted.has(id))continue;this.active.delete(id);const data=this.activeData.get(id);this.activeData.delete(id);if(data)this.onChunkRetired(data);const partial=this.jobs.get(id);if(partial){this.jobs.delete(id);partial.cancel();if(data)this.putInCache(id,{data});continue;}this.meshes.unregisterGroup(group);group.removeFromParent();if(data)this.putInCache(id,{data,group});else this.meshes.disposeChunk(group);} }
  private putInCache(id:ChunkId,r:CachedChunk):void { if(this.cacheSize===0||this.disposed){if(r.group)this.meshes.disposeChunk(r.group);this.repository.delete(id);return;} const old=this.cache.get(id);if(old?.group&&old.group!==r.group)this.meshes.disposeChunk(old.group);this.cache.delete(id);this.cache.set(id,r);while(this.cache.size>this.cacheSize){const key=this.cache.keys().next().value as ChunkId;const value=this.cache.get(key);this.cache.delete(key);this.repository.delete(key);if(value?.group)this.meshes.disposeChunk(value.group);} }
  private recordWorkerTiming(g:number,t:number):void { this.diagnostics.lastWorkerGenerationMs=g;this.diagnostics.maxWorkerGenerationMs=Math.max(this.diagnostics.maxWorkerGenerationMs,g);this.diagnostics.lastRequestRoundTripMs=t;this.diagnostics.maxRequestRoundTripMs=Math.max(this.diagnostics.maxRequestRoundTripMs,t); }
  private recordStage(stage:ChunkActivationStage,ms:number):void { this.diagnostics.activationMsThisFrame+=ms;this.diagnostics.stageTimes[stage]=(this.diagnostics.stageTimes[stage]??0)+ms;if(ms>this.diagnostics.longestActivationStageMs){this.diagnostics.longestActivationStage=stage;this.diagnostics.longestActivationStageMs=ms;} }
  private updateDiagnosticCounts():void { this.diagnostics.generationQueued=this.requestedAdditions.size;this.diagnostics.generationInProgress=this.generating.size;this.diagnostics.workerBusy=this.generating.size>0;this.diagnostics.workerRequestBacklog=this.requestedAdditions.size;this.diagnostics.awaitingActivation=[...this.ready.keys()].filter(id=>this.wanted.has(id)).length;this.diagnostics.partiallyActivated=this.jobs.size; }
  dispose():void { if(this.disposed)return;this.disposed=true;this.disposeGenerator();for(const job of this.jobs.values())job.cancel();this.jobs.clear();for(const [id,group] of this.active){const data=this.activeData.get(id);if(data)this.onChunkRetired(data);this.meshes.unregisterGroup(group);this.meshes.disposeChunk(group);}for(const r of [...this.ready.values(),...this.cache.values()])if(r.group)this.meshes.disposeChunk(r.group);this.active.clear();this.activeData.clear();this.ready.clear();this.cache.clear();this.requestedAdditions.clear();this.requestedRemovals.clear();this.meshes.dispose(); }
}
