import { describe, expect, it } from "vitest";
import { deploymentBase } from "./deploymentBase";

describe("deploymentBase", () => {
  it("uses the repository path for GitHub Pages builds", () => {
    expect(deploymentBase("github-pages")).toBe("/mobile-walker/");
  });

  it("uses the root path for local and Cloudflare builds", () => {
    expect(deploymentBase("development")).toBe("/");
    expect(deploymentBase("cloudflare")).toBe("/");
  });
});
