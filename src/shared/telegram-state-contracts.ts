import { z } from "zod";

export const telegramInboundSchema = z
  .object({
    inboundKey: z.string().min(1).max(220),
    updateId: z.number().int().nonnegative(),
    chatId: z.string().min(1).max(100),
    messageId: z.string().min(1).max(100),
    receivedAt: z.string().datetime(),
    kind: z.enum(["forwarding", "unsupported"]),
    taskId: z.string().uuid().optional(),
    url: z.string().url().max(2048).optional(),
    acknowledgement: z
      .object({
        kind: z.enum(["queued", "link_required"]),
        state: z.enum(["pending", "sent"]),
        sentAt: z.string().datetime().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.inboundKey !== `${record.chatId}:${record.messageId}`)
      context.addIssue({
        code: "custom",
        path: ["inboundKey"],
        message: "入站键必须由聊天和消息身份组成",
      });
    if (record.kind === "forwarding" && (!record.taskId || !record.url))
      context.addIssue({
        code: "custom",
        path: ["taskId"],
        message: "链接入站需要保存转发任务和链接",
      });
    if (record.kind === "unsupported" && record.taskId)
      context.addIssue({
        code: "custom",
        path: ["taskId"],
        message: "不支持的消息不能创建转发任务",
      });
    if (
      record.acknowledgement.state === "sent" &&
      !record.acknowledgement.sentAt
    )
      context.addIssue({
        code: "custom",
        path: ["acknowledgement", "sentAt"],
        message: "已发送确认需要发送时间",
      });
  });

export const telegramStateSchema = z
  .object({
    nextUpdateOffset: z.number().int().nonnegative(),
    updatedAt: z.string().datetime(),
    lastPollAt: z.string().datetime().optional(),
    inbound: z.array(telegramInboundSchema),
  })
  .strict()
  .superRefine((state, context) => {
    const keys = new Set<string>();
    state.inbound.forEach((record, index) => {
      if (keys.has(record.inboundKey))
        context.addIssue({
          code: "custom",
          path: ["inbound", index, "inboundKey"],
          message: "入站键重复",
        });
      keys.add(record.inboundKey);
      if (state.nextUpdateOffset <= record.updateId)
        context.addIssue({
          code: "custom",
          path: ["nextUpdateOffset"],
          message: "更新游标必须超过已保存的入站更新",
        });
    });
  });

export type TelegramInbound = z.infer<typeof telegramInboundSchema>;
export type TelegramState = z.infer<typeof telegramStateSchema>;
