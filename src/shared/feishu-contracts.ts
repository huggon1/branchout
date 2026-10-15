import { z } from "zod";

export const feishuCredentialsSchema = z
  .object({
    appId: z.string().regex(/^cli_[0-9a-fA-F]{16}$/),
    appSecret: z.string().trim().min(1).max(512),
  })
  .strict();
export type FeishuCredentials = z.infer<typeof feishuCredentialsSchema>;
