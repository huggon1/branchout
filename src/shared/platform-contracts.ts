import { z } from "zod";

// Ephemeral worker input only; never persist it or expose it to the renderer.
export const xExecutionSessionSchema = z
  .object({ authToken: z.string().min(1), ct0: z.string().min(1) })
  .strict();
export type XCredentials = z.infer<typeof xExecutionSessionSchema>;

// Loopback connection is scoped to a running task. It is not saved with results.
export const xhsExecutionSessionSchema = z
  .object({
    url: z
      .string()
      .url()
      .refine((value) => /^http:\/\/127\.0\.0\.1:\d+$/.test(value)),
    token: z.string().min(32),
  })
  .strict();
export type XhsSession = z.infer<typeof xhsExecutionSessionSchema>;
