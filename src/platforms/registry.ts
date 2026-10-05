import { github } from "./adapters/github";
import { createXhsAdapter } from "./adapters/xhs";
import { xPostUrlSchema, xhsNoteUrlSchema } from "../shared/source-contracts";
import type { XhsSession } from "../shared/platform-contracts";

export function selectPlatformAdapter(
  sourceUrl: string,
  access: {
    xhsSession?: XhsSession;
    xhsAccessToken?: string;
  },
) {
  if (xPostUrlSchema.safeParse(sourceUrl).success)
    return {platform:"x" as const,readCapability:"available" as const,async read(taskId:string,url:string) {return {taskId,platform:"x" as const,sourceUrl:url,outcome:"failed" as const,message:"X reading requires the shared Chrome browser"};}};
  if (xhsNoteUrlSchema.safeParse(sourceUrl).success)
    return createXhsAdapter(access.xhsSession, {
      id: new URL(sourceUrl).pathname.split("/").at(-1)!,
      token: access.xhsAccessToken ?? "",
    });
  return github;
}
