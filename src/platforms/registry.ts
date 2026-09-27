import { github } from "./adapters/github";
import { createXAdapter } from "./adapters/x";
import { createXhsAdapter } from "./adapters/xhs";
import { xPostUrlSchema, xhsNoteUrlSchema } from "../shared/source-contracts";
import type { XCredentials, XhsSession } from "../shared/platform-contracts";

export function selectPlatformAdapter(
  sourceUrl: string,
  access: {
    xCredentials?: XCredentials;
    xhsSession?: XhsSession;
    xhsAccessToken?: string;
  },
) {
  if (xPostUrlSchema.safeParse(sourceUrl).success)
    return createXAdapter(access.xCredentials);
  if (xhsNoteUrlSchema.safeParse(sourceUrl).success)
    return createXhsAdapter(access.xhsSession, {
      id: new URL(sourceUrl).pathname.split("/").at(-1)!,
      token: access.xhsAccessToken ?? "",
    });
  return github;
}
