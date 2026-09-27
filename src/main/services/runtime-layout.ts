import { join } from "node:path";

export interface RuntimeLayout {
  distRoot: string;
  runtimeRoot: string;
}

export function resolveRuntimeLayout({
  packaged,
  appPath,
  resourcesPath,
  cwd,
}: {
  packaged: boolean;
  appPath: string;
  resourcesPath: string;
  cwd: string;
}): RuntimeLayout {
  return packaged
    ? {
        distRoot: join(appPath, "dist"),
        runtimeRoot: join(resourcesPath, ".runtime"),
      }
    : {
        distRoot: join(cwd, "dist"),
        runtimeRoot: join(cwd, ".runtime"),
      };
}
