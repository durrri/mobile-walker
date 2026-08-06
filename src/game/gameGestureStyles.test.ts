import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../style.css", import.meta.url), "utf8");

describe("game gesture styles", () => {
  it("disables selection and callouts on the game shell", () => {
    expect(styles).toMatch(/html, body, #app, #game-canvas\s*{[^}]*-webkit-user-select:\s*none;/s);
    expect(styles).toMatch(/html, body, #app, #game-canvas\s*{[^}]*user-select:\s*none;/s);
    expect(styles).toMatch(/html, body, #app, #game-canvas\s*{[^}]*-webkit-touch-callout:\s*none;/s);
  });

  it("keeps canvas gestures owned by the input controller", () => {
    expect(styles).toMatch(/#game-canvas\s*{[^}]*touch-action:\s*none;/s);
  });

  it("restores normal behavior for controls and scrollable panels", () => {
    expect(styles).toMatch(/input, textarea, select, \[contenteditable="true"\]\s*{[^}]*user-select:\s*auto;[^}]*-webkit-touch-callout:\s*default;/s);
    expect(styles).toMatch(/\.debug-panel, \.settings-panel\s*{[^}]*overflow-y:\s*auto;[^}]*touch-action:\s*pan-y;[^}]*overscroll-behavior-y:\s*contain;/s);
  });

  it("keeps overlay scrolling within the dynamic safe viewport", () => {
    expect(styles).toMatch(/--overlay-viewport-height:\s*100vh;/);
    expect(styles).toMatch(/@supports \(height: 100dvh\)\s*{\s*:root\s*{\s*--overlay-viewport-height:\s*100dvh;/s);
    expect(styles).toMatch(/--overlay-top:\s*calc\(max\(1rem, env\(safe-area-inset-top\)\) \+ 3rem\);/);
    expect(styles).toMatch(/--overlay-bottom-clearance:\s*max\(1rem, env\(safe-area-inset-bottom\)\);/);
    expect(styles).toMatch(/max-height:\s*calc\(var\(--overlay-viewport-height\) - var\(--overlay-top\) - var\(--overlay-bottom-clearance\)\);/);
    expect(styles).toMatch(/padding-bottom:\s*var\(--overlay-content-bottom-clearance\);/);
  });
});
