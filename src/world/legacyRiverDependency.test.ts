import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

describe("retired legacy river dependency", () => {
  it("has no active imports or fixed-column symbols", () => {
    const files: string[] = [];
    const visit = (directory: string) => readdirSync(directory).forEach(name => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) files.push(path);
    });
    visit(join(process.cwd(), "src"));
    const bannedImport = /(?:from\s+|import\s*\()["'][^"']*\/river["']/;
    const bannedSymbol = /\b(?:isRiverColumn|sampleRiverCrossSection|sampleRiverBoundary|sampleRiverSpine|RIVER_BANK_WIDTH|RIVER_TRANSITION_WIDTH|RIVER_BED_DEPTH)\b/;
    const violations = files.filter(path => bannedImport.test(readFileSync(path, "utf8")) || bannedSymbol.test(readFileSync(path, "utf8")));
    expect(violations).toEqual([]);
  });
});
