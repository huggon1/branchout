import { z } from "zod";
import { BotStore } from "./atomic-store";
import {
  botInboxSchema,
  emptyBotInbox,
  type InboxRepository,
} from "./contracts";
export const botIdentitySchema = z
  .object({
    accountId: z.string().min(1).max(220),
    name: z.string().min(1).max(300),
    botId: z.string().min(1).max(220),
    tenantKey: z.string().max(220).optional(),
  })
  .strict();
export const botAccountStateSchema = z
  .object({
    version: z.literal(1),
    accounts: z.record(
      z.string(),
      z
        .object({
          identity: botIdentitySchema,
          inbox: botInboxSchema,
          checkpoints: z.record(z.string(), z.number().finite().nonnegative()),
          lastSyncAt: z.string().datetime().optional(),
        })
        .strict(),
    ),
  })
  .strict();
export class BotAccountStore extends BotStore<
  z.infer<typeof botAccountStateSchema>
> {
  constructor(file: string) {
    super(file, botAccountStateSchema, { version: 1, accounts: {} });
  }
  async identity(identity: z.infer<typeof botIdentitySchema>) {
    await this.update((state) => {
      const account = state.accounts[identity.accountId];
      if (account) account.identity = identity;
      else
        state.accounts[identity.accountId] = {
          identity,
          inbox: emptyBotInbox(),
          checkpoints: {},
        };
    });
  }
  inbox(accountId: string): InboxRepository {
    return {
      snapshot: () => this.snapshot().accounts[accountId].inbox,
      update: (change) =>
        this.update((state) => change(state.accounts[accountId].inbox)),
    };
  }
}
