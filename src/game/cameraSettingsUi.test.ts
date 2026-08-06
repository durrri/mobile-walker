import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");

describe("camera settings UI", () => {
  it("puts a persisted player movement speed slider at the top of settings", () => {
    expect(html).toMatch(/<h2>Settings<\/h2>\s*<fieldset>\s*<legend>Movement<\/legend>/);
    expect(html).toContain('id="movement-speed" type="range" min="1" max="10" value="1" step="1"');
    expect(main).toContain('MOVEMENT_SPEED_STORAGE_KEY');
    expect(main).toContain("game.setPlayerMovementSpeed(PLAYER_SPEED * multiplier)");
  });

  it("exposes horizontal accessible orientation choices with selected state", () => {
    expect(html).toContain('id="camera-orientation" role="radiogroup"');
    expect(html).toMatch(/role="radio" aria-checked="true" data-value="north-locked">North/);
    expect(html).toMatch(/role="radio" aria-checked="false" data-value="follow-movement">Movement/);
  });

  it("exposes all follow responsiveness choices", () => {
    expect(html).toContain('id="follow-responsiveness" role="radiogroup"');
    for (const value of ["slow", "normal", "fast"]) expect(html).toContain(`data-value="${value}"`);
  });

  it("conditionally hides controls that do not apply to the active mode", () => {
    expect(main).toContain('movementYawSettings.hidden = mode !== "north-locked"');
    expect(main).toContain('responsivenessSettings.hidden = mode !== "follow-movement"');
  });

  it("supports click/touch activation and conventional radiogroup keyboard navigation", () => {
    expect(main).toContain('addEventListener("click", activateSegment)');
    expect(main).toContain('addEventListener("keydown", navigateSegment)');
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"])
      expect(main).toContain(`"${key}"`);
  });
});
