import { createEcsWorld } from "../ecs/createEcsWorld";
import { SystemScheduler } from "../ecs/SystemScheduler";
import { createGameplay } from "../game/createGameplay";
import { ThreeRenderer } from "../rendering/ThreeRenderer";
import { GameLoop } from "./GameLoop";
import type { DebugViewOptions } from "../world/chunkMeshes";
import type { ChunkStreamingSystem } from "../world/ChunkStreamingSystem";
import type { BiomeDebugPresentationSystem } from "../game/biomeDebug";
import type { CameraPresentationSystem } from "../game/presentationSystems";
import type { PersistenceSystem } from "../game/persistence";
import type { ExplorationPresentationSystem } from "../game/exploration";
import type { ChunkNeighborhoodOffsets } from "../world/chunkCoordinates";
import type { SunlightAngles } from "../rendering/ThreeRenderer";
import type { PoiDebugPresentationSystem } from "../game/poiDebug";
import type { CameraOrientationMode, FollowResponsiveness } from "../game/cameraOrientation";
import type { RiverSpineDebugMode, RiverSpineDebugView } from "../game/riverSpineDebug";
import type { PlayerMovementSystem } from "../player/systems";

export class Game {
  private readonly renderer: ThreeRenderer;
  private readonly systems: SystemScheduler;
  private readonly loop: GameLoop;
  private running = false;
  private readonly chunks: ChunkStreamingSystem;
  private readonly biomeDebug: BiomeDebugPresentationSystem;
  private readonly poiDebug: PoiDebugPresentationSystem;
  private readonly cameraPresentation: CameraPresentationSystem;
  private readonly persistence: PersistenceSystem;
  private readonly exploration: ExplorationPresentationSystem;
  private readonly playerShadow: import("three").Mesh;
  private readonly playerMovement: PlayerMovementSystem;
  private readonly riverSpineDebug: RiverSpineDebugView;
  private readonly cameraDetails: HTMLOutputElement;
  private readonly performanceView: HTMLOutputElement;
  private smoothedFrameSeconds = 1 / 60;
  private readonly frameSamples: { at: number; ms: number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    const world = createEcsWorld();
    this.renderer = new ThreeRenderer(canvas);
    this.systems = new SystemScheduler(world);
    const dragOrigin = document.querySelector<HTMLElement>("#drag-origin");
    if (!dragOrigin) throw new Error("The drag indicator could not be found.");
    const gameplay = createGameplay(world, this.systems, this.renderer, canvas, dragOrigin);
    this.chunks = gameplay.chunks;
    this.biomeDebug = gameplay.biomeDebug;
    this.poiDebug = gameplay.poiDebug;
    this.cameraPresentation = gameplay.camera;
    this.persistence = gameplay.persistence;
    this.exploration = gameplay.exploration;
    this.playerShadow = gameplay.playerShadow;
    this.playerMovement = gameplay.playerMovement;
    this.riverSpineDebug = gameplay.riverSpineDebug;
    const cameraDetails = document.querySelector<HTMLOutputElement>("#camera-details");
    const performanceView = document.querySelector<HTMLOutputElement>("#performance-view");
    if (!cameraDetails || !performanceView) throw new Error("Debug readouts could not be found.");
    this.cameraDetails = cameraDetails;
    this.performanceView = performanceView;
    this.loop = new GameLoop({
      fixedUpdate: (deltaSeconds) => this.systems.fixedUpdate(deltaSeconds),
      render: (interpolation, deltaSeconds) => {
        this.systems.prepareRender(interpolation, deltaSeconds);
        this.renderer.render(deltaSeconds);
        this.updateDebugReadouts(deltaSeconds);
      },
    });

    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("pagehide", this.saveProgress);
  }

  start(): void {
    this.running = true;
    this.loop.start();
  }

  setDebugView(options: DebugViewOptions): void {
    this.chunks.setDebugView(options);
    this.biomeDebug.setEnabled(options.biomeGuide);
  }

  setRiverSpineDebugMode(mode: RiverSpineDebugMode): void { this.riverSpineDebug.setMode(mode); }

  setPoiDirectionsEnabled(enabled: boolean): void {
    this.poiDebug.setEnabled(enabled);
  }

  setCameraDetailsEnabled(enabled: boolean): void {
    this.cameraDetails.hidden = !enabled;
  }

  setPerformanceViewEnabled(enabled: boolean): void {
    this.performanceView.hidden = !enabled;
  }

  setShadowsEnabled(enabled: boolean): void {
    this.playerShadow.visible = enabled;
    this.chunks.setShadowsEnabled(enabled);
  }

  setNeighborhoodOffsets(offsets: ChunkNeighborhoodOffsets): void {
    this.chunks.setNeighborhoodOffsets(offsets);
    this.exploration.setNeighborhoodOffsets(offsets);
  }

  setSunlightAngles(angles: SunlightAngles): void {
    this.renderer.setSunlightAngles(angles);
  }

  setMovementYawStrength(degrees: number): void {
    this.cameraPresentation.setMovementYawStrength(degrees);
  }

  setPlayerMovementSpeed(speed: number): void {
    this.playerMovement.setSpeed(speed);
  }

  setCameraOrientationMode(mode: CameraOrientationMode): void {
    this.cameraPresentation.setCameraOrientationMode(mode);
  }

  setFollowResponsiveness(responsiveness: FollowResponsiveness): void {
    this.cameraPresentation.setFollowResponsiveness(responsiveness);
  }

  dispose(): void {
    this.running = false;
    this.loop.stop();
    this.systems.dispose();
    this.riverSpineDebug.dispose();
    this.renderer.dispose();
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener("pagehide", this.saveProgress);
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.persistence.flush();
      this.loop.stop();
    }
    else if (this.running) this.loop.start();
  };

  private readonly saveProgress = (): void => { this.persistence.flush(); };

  private updateDebugReadouts(deltaSeconds: number): void {
    if (deltaSeconds > 0) this.smoothedFrameSeconds += (deltaSeconds - this.smoothedFrameSeconds) * 0.1;
    const rawFrameMs = deltaSeconds * 1000, now = performance.now();
    this.frameSamples.push({ at: now, ms: rawFrameMs });
    while (this.frameSamples[0] && this.frameSamples[0].at < now - 1000) this.frameSamples.shift();
    if (!this.cameraDetails.hidden) {
      const details = this.cameraPresentation.getDebugDetails();
      this.cameraDetails.textContent = `CAMERA\nAngle   ${details.angleDegrees.toFixed(1)}°\nZoom    ${Math.round(details.zoomLevel * 100)}%\nHeight  ${details.height.toFixed(2)} m`;
    }
    if (!this.performanceView.hidden) {
      const details = this.renderer.getPerformanceDetails();
      const streaming = this.chunks.getDiagnostics();
      const systems = [...this.systems.getDiagnostics()].map(([name, timing]) => `  ${name} ${timing.currentMs.toFixed(1)} / ${timing.maximumMs.toFixed(1)} / ${timing.rollingMaximumMs.toFixed(1)}`).join("\n");
      const submit = this.renderer.getSubmissionTiming();
      this.performanceView.textContent = `PERFORMANCE\nFPS       ${(1 / this.smoothedFrameSeconds).toFixed(0)}\nFrame raw ${rawFrameMs.toFixed(1)} ms\nFrame 1s  ${Math.max(0, ...this.frameSamples.map(s => s.ms)).toFixed(1)} ms\nDraws     ${details.drawCalls}\nTriangles ${details.triangles.toLocaleString()}\nRenderer  ${submit.currentMs.toFixed(1)} / ${submit.maximumMs.toFixed(1)} / ${submit.rollingMaximumMs.toFixed(1)} ms\nSYSTEMS current / max / 1s max (ms)\n${systems}\nSTREAMING\nMain queue ${streaming.generationQueued}\nWorker busy ${streaming.workerBusy ? 1 : 0}\nWorker backlog ${streaming.workerRequestBacklog}\nActivation ${streaming.awaitingActivation} ready / ${streaming.partiallyActivated} partial\nWorker generation ${streaming.lastWorkerGenerationMs.toFixed(1)} ms (${streaming.maxWorkerGenerationMs.toFixed(1)} max)\nRound trip ${streaming.lastRequestRoundTripMs.toFixed(1)} ms (${streaming.maxRequestRoundTripMs.toFixed(1)} max)\nThis frame ${streaming.activationMsThisFrame.toFixed(1)} ms\nLongest    ${streaming.longestActivationStage} ${streaming.longestActivationStageMs.toFixed(1)} ms\nCache      ${streaming.cacheHits} hits / ${streaming.cacheMisses} misses`;
    }
  }
}
