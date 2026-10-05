import { z } from "zod";

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
