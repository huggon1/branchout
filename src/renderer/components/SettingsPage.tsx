import { dateTime } from "../i18n";
import { useLanguage, selectLanguage } from "../i18n";
import { t, tf } from "../i18n";
import { useState } from "react";
import type { UiSettings } from "../product-ui";
import { ModelSettings } from "./ModelSettings";
import { AnalysisPromptSettings } from "./AnalysisPromptSettings";
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
  const language = useLanguage();
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
      <header className="page-intro"></header>
      <section className="settings-section">
        <label className="settings-field">
          <span>{t("语言")}</span>
          <select
            aria-label="Language"
            value={language}
            onChange={async (event) => {
              const value = event.target.value as "en" | "zh-CN";
              try {
                await window.branchout.saveLanguage(value);
                selectLanguage(value);
              } catch {
                setStatusMessage(t("设置保存失败"));
              }
            }}
          >
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </label>
      </section>
      <ModelSettings />
      <AnalysisPromptSettings />
      <section
        className="settings-section telegram-settings"
        aria-labelledby="telegram-settings-title"
      >
        <div className="settings-section-heading">
          <div>
            <p className="eyebrow">{t("消息接入")}</p>
            <h3 id="telegram-settings-title">Telegram</h3>
            <p>
              {t(
                "在获准的聊天里转发链接。Bot 收到后确认收取，完整报告保存在应用内。",
              )}
            </p>
          </div>
          <span
            className={`status-tag ${settings?.telegram.connected ? "status-active" : "status-paused"}`}
          >
            {settings?.telegram.connected
              ? t("正在接收")
              : settings?.telegram.configured
                ? t("已配置")
                : t("未连接")}
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
                ? t("已配置，留空保留当前凭据")
                : t("从 Telegram BotFather 获取")
            }
            disabled={busy}
          />
          <small>
            {t(
              "Bot Token 保存在本机仅当前用户可读的文件中；已保存值不会回传到界面。",
            )}
          </small>
        </label>
        <div className="telegram-status-grid">
          <div>
            <span>{t("接收状态")}</span>
            <strong>{settings?.telegram.status ?? t("正在读取…")}</strong>
          </div>
          <div>
            <span>{t("待处理消息")}</span>
            <strong>{settings?.telegram.pendingCount ?? 0}</strong>
          </div>
          <div>
            <span>{t("最近拉取")}</span>
            <strong>
              {settings?.telegram.lastPollAt
                ? dateTime(settings.telegram.lastPollAt)
                : t("尚未拉取")}
            </strong>
          </div>
        </div>
        {settings?.telegram.error && (
          <p className="notice notice-warm" role="status">
            {t(settings.telegram.error ?? "")}
          </p>
        )}
        <fieldset className="telegram-chat-list">
          <legend>{t("已授权聊天")}</legend>
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
                      finishAction(success, t("聊天授权已撤销")),
                    )
                  }
                  disabled={busy}
                  data-chat-id={chat.chatId}
                  aria-label={tf("撤销 {0} 授权", chat.label)}
                >
                  {t("撤销")}
                </button>
              </div>
            ))
          ) : (
            <p className="muted-copy">
              {t(
                "授权聊天发送给 Bot 的链接后，应用会在这里显示获准接收的聊天。",
              )}
            </p>
          )}
        </fieldset>
        <fieldset className="telegram-chat-list">
          <legend>{t("待授权聊天")}</legend>
          {settings?.telegram.pendingChats.length ? (
            settings.telegram.pendingChats.map((chat) => (
              <div className="chat-option" key={chat.chatId}>
                <span>
                  <strong>{chat.label}</strong>
                  <small>
                    {chat.chatId}
                    {t("· 最近发现")} {dateTime(chat.lastSeenAt)}
                  </small>
                </span>
                <button
                  className="button button-quiet"
                  onClick={() =>
                    void onAuthorizeTelegramChat(chat.chatId).then((success) =>
                      finishAction(success, t("聊天授权已更新")),
                    )
                  }
                  disabled={busy}
                  data-chat-id={chat.chatId}
                  aria-label={tf("授权 {0}", chat.label)}
                >
                  {t("授权")}
                </button>
              </div>
            ))
          ) : (
            <p className="muted-copy">{t("还没有发现新的 Telegram 聊天。")}</p>
          )}
        </fieldset>
        <div className="settings-actions">
          <button
            className="button button-primary"
            onClick={() =>
              void onSaveTelegramToken(botToken.trim()).then((success) =>
                finishAction(success, t("设置已保存"), true),
              )
            }
            disabled={busy || !botToken.trim()}
          >
            {busy ? t("正在保存…") : t("保存 Bot Token")}
          </button>
          <button
            className="button button-quiet"
            onClick={() =>
              void onVerifyTelegramBot().then((success) =>
                finishAction(success, t("Bot 验证成功")),
              )
            }
            disabled={busy || !settings?.telegram.configured}
          >
            {t("验证 Bot")}
          </button>
          {settings?.telegram.configured && (
            <button
              className="text-button danger-text"
              onClick={() =>
                void onClearTelegramBotToken().then((success) =>
                  finishAction(success, t("Bot Token 已清除"), true),
                )
              }
              disabled={busy}
            >
              {t("清除 Token")}
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
            <p className="eyebrow">{t("链接读取")}</p>
            <h3 id="sources-title">{t("公开来源")}</h3>
          </div>
        </div>
        <p className="muted-copy">
          {t(
            "通用浏览器可读取网页正文。所有任务复用已保存的网站登录；平台增强说明按需加载。",
          )}
        </p>
        <div className="source-capability-list">
          {settings?.sources
            .filter((source) => source.id === "github")
            .map((source) => (
              <article className="source-capability" key={source.id}>
                <div>
                  <strong>{source.label}</strong>
                  <p>{source.detail}</p>
                </div>
                <span className={`status-tag status-${source.status}`}>
                  {source.status === "ready"
                    ? t("可读取")
                    : source.status === "needs_login"
                      ? t("需要登录")
                      : t("暂不可用")}
                </span>
              </article>
            )) ?? <p className="muted-copy">{t("正在读取来源配置…")}</p>}
        </div>
        <h3>{t("需要登录的平台")}</h3>
        <XSettings />
      </section>
    </div>
  );
}
