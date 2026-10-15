import type { BotInboxState, InboxRepository } from "../bots/contracts";
import type { TelegramStore } from "./store";
import {
  telegramInboundSchema,
  telegramPendingChatSchema,
  telegramQueuedForwardingSchema,
} from "./contracts";

/** Compatibility boundary for existing telegram.json profiles. */
export function telegramInboxRepository(store: TelegramStore): InboxRepository {
  const view = (
    state: ReturnType<TelegramStore["snapshot"]>,
  ): BotInboxState => ({
    authorizedChatIds: state.authorizedChatIds,
    grants: state.grants ?? {},
    pendingChats: state.pendingChats,
    inbound: state.inbound,
    queuedForwarding: state.queuedForwarding.map(
      ({ telegramMessageKey, ...item }) => ({
        ...item,
        messageKey: telegramMessageKey,
      }),
    ),
  });
  return {
    snapshot: () => view(store.snapshot()),
    update: (change) =>
      store.update((state) => {
        const next = view(state);
        change(next);
        state.authorizedChatIds = next.authorizedChatIds;
        state.grants = next.grants;
        state.pendingChats = next.pendingChats.map(({ senderId: _, ...chat }) =>
          telegramPendingChatSchema.parse(chat),
        );
        state.inbound = next.inbound.map((receipt) =>
          telegramInboundSchema.parse(receipt),
        );
        state.queuedForwarding = next.queuedForwarding.map(
          ({ messageKey, ...item }) =>
            telegramQueuedForwardingSchema.parse({
              ...item,
              telegramMessageKey: messageKey,
            }),
        );
      }),
  };
}
