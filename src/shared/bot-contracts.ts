import { z } from "zod";

// Add a channel here and supply its adapter; parsing consumes this origin only.
export const botChannelSchema = z.enum(["telegram", "feishu"]);
export type BotChannel = z.infer<typeof botChannelSchema>;
export const botOriginSchema = z
  .object({
    channel: botChannelSchema,
    accountId: z.string().min(1).max(220),
    messageKey: z.string().min(1).max(400),
  })
  .strict();
export type BotOrigin = z.infer<typeof botOriginSchema>;
export interface BotForwardingSubmission {
  taskId: string;
  resultId: string;
  sourceUrl: string;
  origin: BotOrigin;
  xhsAccessToken?: string;
}
export interface BotCredentialsByChannel {
  feishu: import("./feishu-contracts").FeishuCredentials;
}
export interface BotStatus {
  channel: BotChannel;
  configured: boolean;
  accountId?: string;
  botName?: string;
  status:
    "disconnected" | "connecting" | "connected" | "reconnecting" | "failed";
  authorizedChatIds: string[];
  pendingChats: Array<{ chatId: string; title: string; lastSeenAt: string }>;
  queued: number;
  pendingAcknowledgements: number;
  lastSyncAt?: string;
  lastError?: string;
  registration?: { url?: string; expiresAt?: string; error?: string };
}
export const botChannels = {
  status: "bots:status",
  save: "bots:save",
  clear: "bots:clear",
  verify: "bots:verify",
  authorize: "bots:authorize",
  revoke: "bots:revoke",
  register: "bots:register",
  cancelRegistration: "bots:cancel-registration",
} as const;
