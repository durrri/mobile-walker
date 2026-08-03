declare module "cdt2d" {
  interface Cdt2dOptions {
    readonly delaunay?: boolean;
    readonly interior?: boolean;
    readonly exterior?: boolean;
    readonly infinity?: boolean;
  }

  export default function cdt2d(
    points: readonly (readonly [number, number] | readonly number[])[],
    edges?: readonly (readonly [number, number])[],
    options?: Cdt2dOptions,
  ): [number, number, number][];
}
