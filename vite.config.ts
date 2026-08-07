import { defineConfig } from "vite";
import { deploymentBase } from "./src/deploymentBase";

export default defineConfig(({ mode }) => ({
  base: deploymentBase(mode),
  resolve: { alias: { buffer: "buffer/" } },
}));
