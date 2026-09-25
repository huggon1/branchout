import { z } from "zod";
import {
  telegramStateSchema,
  type TelegramState,
} from "./telegram-state-contracts";
export {
  telegramInboundSchema,
  telegramStateSchema,
} from "./telegram-state-contracts";
export type { TelegramInbound, TelegramState } from "./telegram-state-contracts";

export const telegramSettingsSchema = z
  .object({
    enabled: z.boolean(),
    approvedChatId: z.string().min(1).max(100).optional(),
  })
  .strict();

export const telegramStatusSchema = z
  .object({
    connected: z.boolean(),
    approvedChatConfigured: z.boolean(),
    lastPollAt: z.string().datetime().optional(),
    lastError: z.string().max(500).optional(),
    pendingAcknowledgements: z.number().int().nonnegative(),
  })
  .strict();

export const telegramForwardingSubmissionSchema = z
  .object({
    taskId: z.string().uuid(),
    resultId: z.string().uuid(),
    sourceUrl: z.string().url().max(2048),
    entry: z.literal("telegram"),
    telegramMessageKey: z.string().min(1).max(220),
    xhsAccessToken: z.string().min(1).max(4096).optional(),
  })
  .strict();

export type TelegramSettings = z.infer<typeof telegramSettingsSchema>;
export type TelegramStatus = z.infer<typeof telegramStatusSchema>;
export type TelegramForwardingSubmission = z.infer<
  typeof telegramForwardingSubmissionSchema
>;
