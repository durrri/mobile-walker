import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const sourceRoot = join(process.cwd(), "src");
const files = (directory: string): string[] => readdirSync(directory).flatMap(name => {
  const path = join(directory, name);
  return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
});

describe("production river ownership dependencies", () => {
  it("prevents production consumers from importing deprecated fixed-seed aliases", () => {
    const violations = files(sourceRoot)
      .filter(path => !path.endsWith(".test.ts") && !path.endsWith("Fixtures.ts"))
      .filter(path => !path.endsWith("worldRiverGeneration.ts") && !path.endsWith("worldRiverSpine.ts"))
      .filter(path => /import\s*\{[^}]*\bworldRiver(?:Generation|MacroSpine|Spine)\b[^}]*\}\s*from/.test(readFileSync(path, "utf8")))
      .map(path => relative(process.cwd(), path));
    expect(violations).toEqual([]);
  });
});
