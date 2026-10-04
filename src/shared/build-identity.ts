export type BuildIdentity = {
  revision: string;
  dirty: boolean;
  version: string;
  platform: string;
  builtAt: string;
};
declare const __BRANCHOUT_BUILD_IDENTITY__: BuildIdentity;
export const buildIdentity: BuildIdentity =
  typeof __BRANCHOUT_BUILD_IDENTITY__ === "undefined"
    ? {
        revision: "source",
        dirty: true,
        version: "development",
        platform: process.platform,
        builtAt: "unbuilt",
      }
    : __BRANCHOUT_BUILD_IDENTITY__;
