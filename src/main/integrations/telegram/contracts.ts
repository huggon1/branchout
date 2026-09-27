import { z } from "zod";

export const telegramChatIdSchema = z.string().regex(/^-?\d{1,20}$/);

export const telegramPendingChatSchema = z
  .object({
    chatId: telegramChatIdSchema,
    title: z.string().max(300),
    username: z.string().max(100).optional(),
    lastSeenAt: z.string().datetime(),
  })
  .strict();

export const telegramInboundSchema = z
  .object({
    inboundKey: z.string().min(1).max(100),
    updateId: z.number().int().nonnegative(),
    chatId: telegramChatIdSchema,
    messageId: z.number().int().positive(),
    outcome: z.enum(["queued", "unsupported", "unauthorized", "ignored"]),
    taskId: z.string().uuid().optional(),
    acknowledgement: z
      .object({
        text: z.string().min(1).max(500),
        state: z.enum(["pending", "sent"]),
      })
      .strict()
      .optional(),
    receivedAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (inbound) =>
      inbound.outcome === "queued"
        ? !!inbound.taskId && !!inbound.acknowledgement
        : inbound.outcome === "unsupported"
          ? !!inbound.acknowledgement
          : !inbound.acknowledgement,
  );

export const telegramQueuedForwardingSchema = z
  .object({
    taskId: z.string().uuid(),
    resultId: z.string().uuid(),
    sourceUrl: z.string().url().max(2048),
    telegramMessageKey: z.string().min(1).max(100),
    xhsAccessTokenCiphertext: z.string().max(4096).optional(),
    state: z.enum(["queued", "submitted"]),
    queuedAt: z.string().datetime(),
    submittedAt: z.string().datetime().optional(),
  })
  .strict()
  .refine((task) => task.state === "queued" || !!task.submittedAt);

export const telegramStateSchema = z
  .object({
    version: z.literal(1),
    updateOffset: z.number().int().nonnegative(),
    authorizedChatIds: z.array(telegramChatIdSchema).max(100),
    pendingChats: z.array(telegramPendingChatSchema).max(500),
    inbound: z.array(telegramInboundSchema).max(1_000_000),
    queuedForwarding: z.array(telegramQueuedForwardingSchema).max(1_000_000),
    connection: z
      .object({
        status: z.enum(["disconnected", "polling", "failed"]),
        lastPollAt: z.string().datetime().optional(),
        lastError: z.string().max(500).optional(),
      })
      .strict(),
  })
  .strict();

export const telegramMessageSchema = z
  .object({
    message_id: z.number().int().positive(),
    text: z.string().max(4096).optional(),
    caption: z.string().max(1024).optional(),
    entities: z.array(z.unknown()).optional(),
    caption_entities: z.array(z.unknown()).optional(),
    chat: z
      .object({
        id: z.number().int(),
        type: z.string().max(40).optional(),
        title: z.string().max(300).optional(),
        first_name: z.string().max(300).optional(),
        last_name: z.string().max(300).optional(),
        username: z.string().max(100).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const telegramUpdateSchema = z
  .object({
    update_id: z.number().int().nonnegative(),
    message: telegramMessageSchema.optional(),
  })
  .passthrough();

export type TelegramPendingChat = z.infer<typeof telegramPendingChatSchema>;
export type TelegramInbound = z.infer<typeof telegramInboundSchema>;
export type TelegramQueuedForwarding = z.infer<
  typeof telegramQueuedForwardingSchema
>;
export type TelegramState = z.infer<typeof telegramStateSchema>;
export type TelegramMessage = z.infer<typeof telegramMessageSchema>;
export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
