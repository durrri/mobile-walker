import { defineConfig } from "vitest/config";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/mobile-walker/" : "/",
  resolve: { alias: { buffer: "buffer/" } },
  test: { testTimeout: 20_000 },
}));
