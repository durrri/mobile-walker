import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/mobile-walker/" : "/",
  resolve: { alias: { buffer: "buffer/" } },
}));
