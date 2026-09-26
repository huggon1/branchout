import { z } from "zod";

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

export type TelegramForwardingSubmission = z.infer<
  typeof telegramForwardingSubmissionSchema
>;

export interface TelegramStatus {
  configured: boolean;
  status: "disconnected" | "polling" | "failed";
  authorizedChatIds: string[];
  pendingChats: {
    chatId: string;
    title: string;
    username?: string;
    lastSeenAt: string;
  }[];
  queued: number;
  pendingAcknowledgements: number;
  lastPollAt?: string;
  lastError?: string;
}
