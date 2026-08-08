import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const markup = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const settingsPanel = markup.match(/<section class="settings-panel"[\s\S]*?<\/section>/)?.[0] ?? "";

describe("settings panel markup", () => {
  it("keeps all settings controls and actions in the scrollable settings panel", () => {
    for (const id of [
      "movement-speed", "night-brightness", "offset-north", "offset-west", "offset-east", "offset-south",
      "camera-orientation", "movement-yaw", "follow-responsiveness",
      "restart-button", "reset-progress-button",
    ]) expect(settingsPanel).toContain(`id="${id}"`);
  });

  it("keeps Night Brightness at its development tuning range", () => {
    expect(settingsPanel).toContain('<input id="night-brightness" type="range" min="0.5" max="8" value="1" step="0.05" />');
  });

  it("keeps reset progress as the final settings action", () => {
    const actions = [...settingsPanel.matchAll(/<button[^>]*id="([^"]+)"[^>]*>/g)].map((match) => match[1]);
    expect(actions.slice(-2)).toEqual(["restart-button", "reset-progress-button"]);
  });
});
