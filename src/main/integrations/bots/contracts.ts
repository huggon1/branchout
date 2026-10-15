import { z } from "zod";
import type {
  BotForwardingSubmission,
  BotOrigin,
} from "../../../shared/bot-contracts";
import type { SingleLinkResult } from "./link-parser";

export const pendingChatSchema = z
  .object({
    chatId: z.string().min(1).max(220),
    title: z.string().max(300),
    username: z.string().max(100).optional(),
    senderId: z.string().max(220).optional(),
    lastSeenAt: z.string().datetime(),
  })
  .strict();
export const botGrantSchema = z
  .object({
    since: z.number().finite().nonnegative(),
    senderId: z.string().max(220).optional(),
  })
  .strict();
export const botReceiptSchema = z
  .object({
    inboundKey: z.string().min(1).max(400),
    chatId: z.string().min(1).max(220),
    messageId: z.union([
      z.string().min(1).max(220),
      z.number().int().positive(),
    ]),
    updateId: z.number().int().nonnegative().optional(),
    outcome: z.enum([
      "queued",
      "unsupported",
      "unauthorized",
      "ignored",
      "retired_by_reset",
    ]),
    taskId: z.string().uuid().optional(),
    receivedAt: z.string().datetime(),
    acknowledgement: z
      .object({
        text: z.string().min(1).max(500),
        state: z.enum(["pending", "sent"]),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((receipt) =>
    receipt.outcome === "queued"
      ? !!receipt.taskId && !!receipt.acknowledgement
      : receipt.outcome === "unsupported"
        ? !!receipt.acknowledgement && !receipt.taskId
        : !receipt.acknowledgement && !receipt.taskId,
  );
export const botSubmissionSchema = z
  .object({
    taskId: z.string().uuid(),
    resultId: z.string().uuid(),
    sourceUrl: z.string().url().max(2048),
    messageKey: z.string().min(1).max(400),
    xhsAccessTokenCiphertext: z.string().max(4096).optional(),
    state: z.enum(["queued", "submitted"]),
    queuedAt: z.string().datetime(),
    submittedAt: z.string().datetime().optional(),
  })
  .strict()
  .refine((task) => task.state === "queued" || !!task.submittedAt);
export const botInboxSchema = z
  .object({
    authorizedChatIds: z.array(z.string().min(1).max(220)).max(100),
    grants: z.record(z.string(), botGrantSchema).default({}),
    pendingChats: z.array(pendingChatSchema).max(500),
    inbound: z.array(botReceiptSchema).max(1_000_000),
    queuedForwarding: z.array(botSubmissionSchema).max(1_000_000),
  })
  .strict();
export type BotInboxState = z.infer<typeof botInboxSchema>;
export const emptyBotInbox = (): BotInboxState => ({
  authorizedChatIds: [],
  grants: {},
  pendingChats: [],
  inbound: [],
  queuedForwarding: [],
});
export interface InboxRepository {
  snapshot(): BotInboxState;
  update(change: (state: BotInboxState) => void): Promise<void>;
}
export interface BotMessage {
  key: string;
  chatId: string;
  messageId: string | number;
  updateId?: number;
  title: string;
  username?: string;
  senderId?: string;
  sentAt?: number;
  link: SingleLinkResult;
}
export interface InboxDelivery {
  origin: Omit<BotOrigin, "messageKey">;
  submit(request: BotForwardingSubmission): Promise<void>;
  send(chatId: string, text: string, key: string): Promise<void>;
  protect(value: string): Promise<string>;
  reveal(value: string): Promise<string>;
}
