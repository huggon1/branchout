import type { DatabaseSync } from "node:sqlite";

export const STORE_COMPATIBILITY_VERSION = 7;

/**
 * Compatibility-only schema for databases opened by the retired bot
 * organization preview. Runtime code must not read or write this table.
 */
export function migrateRetiredBotOrganizationV7(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE bot_organization_sessions(
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL CHECK(channel IN ('telegram', 'feishu')),
      peer TEXT NOT NULL,
      source_message_id TEXT NOT NULL,
      receipt_message_id TEXT,
      batch_id TEXT NOT NULL,
      item_ids TEXT NOT NULL,
      menu_options TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending', 'completed', 'expired')),
      prompt_state TEXT NOT NULL CHECK(prompt_state IN ('pending', 'sent', 'failed')),
      prompt_error TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      completed_at TEXT,
      target_collection_id TEXT,
      target_collection_name TEXT,
      resolved_by TEXT CHECK(resolved_by IS NULL OR resolved_by IN ('bot', 'desktop')),
      resolution_message_id TEXT,
      UNIQUE(channel, peer, source_message_id)
    );
    CREATE UNIQUE INDEX bot_organization_receipt
      ON bot_organization_sessions(channel, peer, receipt_message_id)
      WHERE receipt_message_id IS NOT NULL;
    CREATE INDEX bot_organization_pending
      ON bot_organization_sessions(state, expires_at);
  `);
}
