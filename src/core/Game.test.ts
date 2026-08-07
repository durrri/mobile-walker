import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameLoopCallbacks } from "./GameLoop";

const fixtures = vi.hoisted(() => ({
  render: undefined as GameLoopCallbacks["render"] | undefined,
  renderer: undefined as { render: ReturnType<typeof vi.fn>; setEnvironmentTime: ReturnType<typeof vi.fn> } | undefined,
}));

vi.mock("../ecs/createEcsWorld", () => ({ createEcsWorld: vi.fn(() => ({})) }));
vi.mock("../ecs/SystemScheduler", () => ({
  SystemScheduler: class {
    fixedUpdate(): void {}
    prepareRender(): void {}
    dispose(): void {}
    getDiagnostics(): [] { return []; }
  },
}));
vi.mock("../game/createGameplay", () => ({
  createGameplay: vi.fn(() => ({
    chunks: { setDebugView: vi.fn(), setShadowsEnabled: vi.fn() },
    biomeDebug: { setEnabled: vi.fn() },
    poiDebug: { setEnabled: vi.fn() },
    camera: { setMovementYawStrength: vi.fn(), setCameraOrientationMode: vi.fn(), setFollowResponsiveness: vi.fn(), getDebugDetails: vi.fn() },
    persistence: { flush: vi.fn() },
    exploration: { setNeighborhoodOffsets: vi.fn() },
    playerShadow: { visible: true },
    playerMovement: { setSpeed: vi.fn() },
    riverSpineDebug: { setMode: vi.fn(), dispose: vi.fn() },
  })),
}));
vi.mock("../rendering/ThreeRenderer", () => ({
  ThreeRenderer: class {
    readonly render = vi.fn();
    readonly setEnvironmentTime = vi.fn();

    constructor() {
      fixtures.renderer = this;
    }

    dispose(): void {}
    getPerformanceDetails(): { drawCalls: number; triangles: number } { return { drawCalls: 0, triangles: 0 }; }
    getSubmissionTiming(): { currentMs: number; maximumMs: number; rollingMaximumMs: number } { return { currentMs: 0, maximumMs: 0, rollingMaximumMs: 0 }; }
  },
}));
vi.mock("./GameLoop", () => ({
  GameLoop: class {
    constructor(callbacks: GameLoopCallbacks) {
      fixtures.render = callbacks.render;
    }

    start(): void {}
    stop(): void {}
  },
}));

import { Game } from "./Game";

describe("Game world time", () => {
  beforeEach(() => {
    fixtures.render = undefined;
    fixtures.renderer = undefined;
    const elements = new Map([
      ["#drag-origin", {}],
      ["#camera-details", { hidden: true }],
      ["#performance-view", { hidden: true }],
    ]);
    const documentEvents = new EventTarget();
    const windowEvents = new EventTarget();
    vi.stubGlobal("document", {
      addEventListener: documentEvents.addEventListener.bind(documentEvents),
      removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
      querySelector: (selector: string) => elements.get(selector) ?? null,
    });
    vi.stubGlobal("window", {
      addEventListener: windowEvents.addEventListener.bind(windowEvents),
      removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("advances EnvironmentTime without driving the production renderer", () => {
    const game = new Game({} as HTMLCanvasElement);
    const listener = vi.fn();
    game.setEnvironmentTimeListener(listener);

    fixtures.render!(0, 1);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0].timeOfDayHours).toBeGreaterThan(listener.mock.calls[0][0].timeOfDayHours);
    expect(fixtures.renderer!.setEnvironmentTime).not.toHaveBeenCalled();
  });
});
