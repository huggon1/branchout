import { useState } from "react";
import type { UiSettings } from "../product-ui";
import { ModelSettings } from "./ModelSettings";
import { XSettings } from "./XSettings";

export function SettingsPage({
  settings,
  busy,
  onSaveTelegramToken,
  onClearTelegramBotToken,
  onVerifyTelegramBot,
  onAuthorizeTelegramChat,
  onRevokeTelegramChat,
}: {
  settings?: UiSettings;
  busy: boolean;
  onSaveTelegramToken: (token: string) => Promise<boolean>;
  onClearTelegramBotToken: () => Promise<boolean>;
  onVerifyTelegramBot: () => Promise<boolean>;
  onAuthorizeTelegramChat: (chatId: string) => Promise<boolean>;
  onRevokeTelegramChat: (chatId: string) => Promise<boolean>;
}) {
  const [botToken, setBotToken] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const finishAction = (
    success: boolean,
    message: string,
    clearToken = false,
  ) => {
    if (success) {
      if (clearToken) setBotToken("");
      setStatusMessage(message);
      window.setTimeout(() => setStatusMessage(""), 2600);
    }
  };
  return (
    <div className="settings-page">
      <header className="page-intro">
        <div>
          <p className="eyebrow">连接和读取范围</p>
          <h2>设置</h2>
          <p>新配置会用于后续任务；运行中的任务继续使用启动时的配置。</p>
        </div>
      </header>
      <ModelSettings />
      <section
        className="settings-section telegram-settings"
        aria-labelledby="telegram-settings-title"
      >
        <div className="settings-section-heading">
          <div>
            <p className="eyebrow">消息接入</p>
            <h3 id="telegram-settings-title">Telegram</h3>
            <p>
              在获准的聊天里转发链接。Bot 收到后确认收取，完整报告保存在应用内。
            </p>
          </div>
          <span
            className={`status-tag ${settings?.telegram.connected ? "status-active" : "status-paused"}`}
          >
            {settings?.telegram.connected
              ? "正在接收"
              : settings?.telegram.configured
                ? "已配置"
                : "未连接"}
          </span>
        </div>
        <label className="settings-field">
          <span>Bot Token</span>
          <input
            type="password"
            autoComplete="new-password"
            value={botToken}
            onChange={(event) => setBotToken(event.target.value)}
            placeholder={
              settings?.telegram.configured
                ? "已配置，留空保留当前凭据"
                : "从 Telegram BotFather 获取"
            }
            disabled={busy}
          />
          <small>凭据由本机受保护存储保存；已保存值不会回传到界面。</small>
        </label>
        <div className="telegram-status-grid">
          <div>
            <span>接收状态</span>
            <strong>{settings?.telegram.status ?? "正在读取…"}</strong>
          </div>
          <div>
            <span>待处理消息</span>
            <strong>{settings?.telegram.pendingCount ?? 0}</strong>
          </div>
          <div>
            <span>最近拉取</span>
            <strong>
              {settings?.telegram.lastPollAt
                ? new Date(settings.telegram.lastPollAt).toLocaleString()
                : "尚未拉取"}
            </strong>
          </div>
        </div>
        {settings?.telegram.error && (
          <p className="notice notice-warm" role="status">
            {settings.telegram.error}
          </p>
        )}
        <fieldset className="telegram-chat-list">
          <legend>已授权聊天</legend>
          {settings?.telegram.chats.length ? (
            settings.telegram.chats.map((chat) => (
              <div className="chat-option" key={chat.chatId}>
                <span>
                  <strong>{chat.label}</strong>
                  <small>{chat.chatId}</small>
                </span>
                <button
                  className="text-button danger-text"
                  onClick={() =>
                    void onRevokeTelegramChat(chat.chatId).then((success) =>
                      finishAction(success, "聊天授权已撤销"),
                    )
                  }
                  disabled={busy}
                  data-chat-id={chat.chatId}
                  aria-label={`撤销 ${chat.label} 授权`}
                >
                  撤销
                </button>
              </div>
            ))
          ) : (
            <p className="muted-copy">
              授权聊天发送给 Bot 的链接后，应用会在这里显示获准接收的聊天。
            </p>
          )}
        </fieldset>
        <fieldset className="telegram-chat-list">
          <legend>待授权聊天</legend>
          {settings?.telegram.pendingChats.length ? (
            settings.telegram.pendingChats.map((chat) => (
              <div className="chat-option" key={chat.chatId}>
                <span>
                  <strong>{chat.label}</strong>
                  <small>
                    {chat.chatId} · 最近发现{" "}
                    {new Date(chat.lastSeenAt).toLocaleString()}
                  </small>
                </span>
                <button
                  className="button button-quiet"
                  onClick={() =>
                    void onAuthorizeTelegramChat(chat.chatId).then((success) =>
                      finishAction(success, "聊天授权已更新"),
                    )
                  }
                  disabled={busy}
                  data-chat-id={chat.chatId}
                  aria-label={`授权 ${chat.label}`}
                >
                  授权
                </button>
              </div>
            ))
          ) : (
            <p className="muted-copy">还没有发现新的 Telegram 聊天。</p>
          )}
        </fieldset>
        <div className="settings-actions">
          <button
            className="button button-primary"
            onClick={() =>
              void onSaveTelegramToken(botToken.trim()).then((success) =>
                finishAction(success, "设置已保存", true),
              )
            }
            disabled={
              busy || !botToken.trim()
            }
          >
            {busy ? "正在保存…" : "保存 Bot Token"}
          </button>
          <button
            className="button button-quiet"
            onClick={() =>
              void onVerifyTelegramBot().then((success) =>
                finishAction(success, "Bot 验证成功"),
              )
            }
            disabled={busy || !settings?.telegram.configured}
          >
            验证 Bot
          </button>
          {settings?.telegram.configured && (
            <button
              className="text-button danger-text"
              onClick={() =>
                void onClearTelegramBotToken().then((success) =>
                  finishAction(success, "Bot Token 已清除", true),
                )
              }
              disabled={busy}
            >
              清除 Token
            </button>
          )}
          {statusMessage && <span role="status">{statusMessage}</span>}
        </div>
      </section>
      <section
        className="settings-section sources-settings"
        aria-labelledby="sources-title"
      >
        <div className="settings-section-heading">
          <div>
            <p className="eyebrow">链接读取</p>
            <h3 id="sources-title">内容来源</h3>
            <p>按来源展示当前读取能力和账号状态。</p>
          </div>
        </div>
        <div className="source-capability-list">
          {settings?.sources.map((source) => (
            <article className="source-capability" key={source.id}>
              <div>
                <strong>{source.label}</strong>
                <p>{source.detail}</p>
              </div>
              <span className={`status-tag status-${source.status}`}>
                {source.status === "ready"
                  ? "可读取"
                  : source.status === "needs_login"
                    ? "需要登录"
                    : "暂不可用"}
              </span>
            </article>
          )) ?? <p className="muted-copy">正在读取来源配置…</p>}
        </div>
        <XSettings />
      </section>
    </div>
  );
}
