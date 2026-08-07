export const deploymentBase = (mode: string): string =>
  mode === "github-pages" ? "/mobile-walker/" : "/";
