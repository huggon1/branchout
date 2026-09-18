import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Channel } from "../adapters/bot-messages.js";

export const BOT_ORGANIZATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface BotOrganizationOption {
  collectionId: string;
  name: string;
}

export interface BotOrganizationSession {
  id: string;
  channel: Channel;
  peer: string;
  sourceMessageId: string;
  receiptMessageId?: string;
  batchId: string;
  itemIds: string[];
  menuOptions: BotOrganizationOption[];
  state: "pending" | "completed" | "expired";
  promptState: "pending" | "sent" | "failed";
  promptError?: string;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
  targetCollectionId?: string;
  targetCollectionName?: string;
  resolvedBy?: "bot" | "desktop";
  resolutionMessageId?: string;
}

const decode = (row: any): BotOrganizationSession => ({
  id: String(row.id),
  channel: row.channel,
  peer: String(row.peer),
  sourceMessageId: String(row.sourceMessageId),
  receiptMessageId: row.receiptMessageId || undefined,
  batchId: String(row.batchId),
  itemIds: JSON.parse(String(row.itemIds)),
  menuOptions: JSON.parse(String(row.menuOptions)),
  state: row.state,
  promptState: row.promptState,
  promptError: row.promptError || undefined,
  createdAt: String(row.createdAt),
  expiresAt: String(row.expiresAt),
  completedAt: row.completedAt || undefined,
  targetCollectionId: row.targetCollectionId || undefined,
  targetCollectionName: row.targetCollectionName || undefined,
  resolvedBy: row.resolvedBy || undefined,
  resolutionMessageId: row.resolutionMessageId || undefined,
});

export class BotOrganizationSessions {
  constructor(private readonly db: DatabaseSync) {}

  create(input: {
    channel: Channel;
    peer: string;
    sourceMessageId: string;
    batchId: string;
    itemIds: string[];
    menuOptions: BotOrganizationOption[];
    now?: string;
  }) {
    const createdAt = input.now || new Date().toISOString();
    const session: BotOrganizationSession = {
      id: randomUUID(),
      channel: input.channel,
      peer: input.peer,
      sourceMessageId: input.sourceMessageId,
      batchId: input.batchId,
      itemIds: [...new Set(input.itemIds)],
      menuOptions: input.menuOptions,
      state: "pending",
      promptState: "pending",
      createdAt,
      expiresAt: new Date(
        new Date(createdAt).getTime() + BOT_ORGANIZATION_TTL_MS,
      ).toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO bot_organization_sessions(
          id,channel,peer,source_message_id,batch_id,item_ids,menu_options,
          state,prompt_state,created_at,expires_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        session.id,
        session.channel,
        session.peer,
        session.sourceMessageId,
        session.batchId,
        JSON.stringify(session.itemIds),
        JSON.stringify(session.menuOptions),
        session.state,
        session.promptState,
        session.createdAt,
        session.expiresAt,
      );
    return session;
  }

  list() {
    return this.db
      .prepare(
        `SELECT id,channel,peer,source_message_id AS sourceMessageId,
          receipt_message_id AS receiptMessageId,batch_id AS batchId,
          item_ids AS itemIds,menu_options AS menuOptions,state,
          prompt_state AS promptState,prompt_error AS promptError,
          created_at AS createdAt,expires_at AS expiresAt,
          completed_at AS completedAt,target_collection_id AS targetCollectionId,
          target_collection_name AS targetCollectionName,
          resolved_by AS resolvedBy,resolution_message_id AS resolutionMessageId
         FROM bot_organization_sessions ORDER BY created_at DESC,rowid DESC`,
      )
      .all()
      .map(decode);
  }

  byReceipt(channel: Channel, peer: string, receiptMessageId: string) {
    const row = this.db
      .prepare(
        `SELECT id,channel,peer,source_message_id AS sourceMessageId,
          receipt_message_id AS receiptMessageId,batch_id AS batchId,
          item_ids AS itemIds,menu_options AS menuOptions,state,
          prompt_state AS promptState,prompt_error AS promptError,
          created_at AS createdAt,expires_at AS expiresAt,
          completed_at AS completedAt,target_collection_id AS targetCollectionId,
          target_collection_name AS targetCollectionName,
          resolved_by AS resolvedBy,resolution_message_id AS resolutionMessageId
         FROM bot_organization_sessions
         WHERE channel=? AND peer=? AND receipt_message_id=?`,
      )
      .get(channel, peer, receiptMessageId);
    return row ? decode(row) : undefined;
  }

  pendingWithoutReceipt() {
    return this.list().filter(
      (session) => session.state === "pending" && !session.receiptMessageId,
    );
  }

  setReceipt(id: string, receiptMessageId: string) {
    this.db
      .prepare(
        `UPDATE bot_organization_sessions
         SET receipt_message_id=?,prompt_state='sent',prompt_error=NULL
         WHERE id=? AND state='pending' AND receipt_message_id IS NULL`,
      )
      .run(receiptMessageId, id);
  }

  markPromptFailed(id: string) {
    this.db
      .prepare(
        `UPDATE bot_organization_sessions
         SET prompt_state='failed',prompt_error='回执发送失败，可重试'
         WHERE id=? AND state='pending' AND receipt_message_id IS NULL`,
      )
      .run(id);
  }

  complete(
    id: string,
    targetCollectionId: string,
    targetCollectionName: string,
    resolutionMessageId: string,
    now = new Date().toISOString(),
  ) {
    return Number(
      this.db
        .prepare(
          `UPDATE bot_organization_sessions
           SET state='completed',completed_at=?,target_collection_id=?,
             target_collection_name=?,resolved_by='bot',resolution_message_id=?
           WHERE id=? AND state='pending'`,
        )
        .run(
          now,
          targetCollectionId,
          targetCollectionName,
          resolutionMessageId,
          id,
        ).changes,
    );
  }

  completeFromDesktop(itemIds: string[], now = new Date().toISOString()) {
    const selected = new Set(itemIds);
    const sessions = this.list().filter(
      (session) =>
        session.state === "pending" &&
        session.itemIds.some((itemId) => selected.has(itemId)),
    );
    const complete = this.db.prepare(
      `UPDATE bot_organization_sessions
       SET state='completed',completed_at=?,target_collection_id=NULL,
         target_collection_name=NULL,resolved_by='desktop',
         resolution_message_id=NULL
       WHERE id=? AND state='pending'`,
    );
    const clearAssignments = this.db.prepare(
      `UPDATE collection_assignments SET organization_state=NULL
       WHERE batch_id=? AND organization_state='pending'`,
    );
    for (const session of sessions) {
      complete.run(now, session.id);
      clearAssignments.run(session.batchId);
    }
    return sessions.length;
  }

  expirePending(now = new Date().toISOString()) {
    this.db.exec("SAVEPOINT bot_session_expiry");
    try {
      const expired = this.list().filter(
        (session) =>
          session.state === "pending" &&
          session.expiresAt.localeCompare(now) <= 0,
      );
      const updateSession = this.db.prepare(
        `UPDATE bot_organization_sessions SET state='expired'
         WHERE id=? AND state='pending'`,
      );
      const updateAssignments = this.db.prepare(
        `UPDATE collection_assignments SET organization_state='expired'
         WHERE batch_id=? AND organization_state='pending'`,
      );
      for (const session of expired) {
        updateSession.run(session.id);
        updateAssignments.run(session.batchId);
      }
      this.db.exec("RELEASE bot_session_expiry");
      return expired.length;
    } catch (error) {
      this.db.exec("ROLLBACK TO bot_session_expiry");
      this.db.exec("RELEASE bot_session_expiry");
      throw error;
    }
  }
}
