import { useEffect, useState } from "react";
import type { UiSettings } from "../product-ui";
import { ModelSettings } from "./ModelSettings";
import { XSettings } from "./XSettings";

export function SettingsPage({
  settings,
  busy,
  onSaveTelegram,
}: {
  settings?: UiSettings;
  busy: boolean;
  onSaveTelegram: (input: {
    botToken?: string;
    chats: string[];
  }) => Promise<boolean>;
}) {
  const [botToken, setBotToken] = useState("");
  const [chats, setChats] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  useEffect(
    () =>
      setChats(
        settings?.telegram.chats
          .filter((chat) => chat.allowed)
          .map((chat) => chat.chatId) ?? [],
      ),
    [settings?.telegram.chats],
  );
  const saveTelegram = async () => {
    if (await onSaveTelegram({ ...(botToken ? { botToken } : {}), chats })) {
      setBotToken("");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2600);
    }
  };
  const toggleChat = (chatId: string, enabled: boolean) =>
    setChats((current) =>
      enabled
        ? [...new Set([...current, chatId])]
        : current.filter((item) => item !== chatId),
    );
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
            {settings?.telegram.connected ? "已连接" : "未连接"}
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
              settings?.telegram.connected
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
          <legend>允许接收链接的聊天</legend>
          {settings?.telegram.chats.length ? (
            settings.telegram.chats.map((chat) => (
              <label className="chat-option" key={chat.chatId}>
                <input
                  type="checkbox"
                  checked={chats.includes(chat.chatId)}
                  onChange={(event) =>
                    toggleChat(chat.chatId, event.target.checked)
                  }
                  disabled={busy}
                />
                <span>
                  <strong>{chat.label}</strong>
                  <small>{chat.chatId}</small>
                </span>
              </label>
            ))
          ) : (
            <p className="muted-copy">
              连接 Bot 后，在 Telegram
              向它发送一条消息，再刷新已发现聊天列表以完成绑定。
            </p>
          )}
        </fieldset>
        <div className="settings-actions">
          <button
            className="button button-primary"
            onClick={() => void saveTelegram()}
            disabled={
              busy || (!settings?.telegram.connected && !botToken.trim())
            }
          >
            {busy ? "正在保存…" : "保存 Telegram 设置"}
          </button>
          {saved && <span role="status">设置已保存</span>}
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
