import { useState } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { Dialog } from "./Primitives";
import { bridge } from "../bridge";
import { t, tf } from "../i18n";
import type { UiSettings } from "../product-ui";

export interface TelegramSettingsProps {
  settings?: UiSettings;
  busy: boolean;
  onSaveTelegramToken: (token: string) => Promise<boolean>;
  onClearTelegramBotToken: () => Promise<boolean>;
  onVerifyTelegramBot: () => Promise<boolean>;
  onAuthorizeTelegramChat: (id: string) => Promise<boolean>;
  onRevokeTelegramChat: (id: string) => Promise<boolean>;
  onOpenContent: () => void;
}

export function TelegramSettings(props: TelegramSettingsProps) {
  const { settings, busy } = props;
  const telegram = settings?.telegram;
  const [expanded, setExpanded] = useState(false);
  const [guide, setGuide] = useState(false);
  const [step, setStep] = useState(0);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    title: string;
    action: () => Promise<boolean>;
  }>();
  const status = telegram?.connected
    ? t("正在接收")
    : telegram?.error
      ? t("连接异常")
      : telegram?.configured
        ? t("已配置")
        : t("未连接");
  const start = () => {
    setError("");
    setStep(
      !telegram?.configured || !telegram?.botUsername
        ? 0
        : telegram.chats.length
          ? 2
          : 1,
    );
    setGuide(true);
  };
  const finish = () => {
    setGuide(false);
    setToken("");
    setError("");
  };
  async function action(work: () => Promise<boolean>) {
    setError("");
    try {
      const ok = await work();
      if (!ok) setError(t("操作未完成，请检查 Token、网络和聊天状态后重试。"));
      return ok;
    } catch {
      setError(t("操作未完成，请检查 Token、网络和聊天状态后重试。"));
      return false;
    }
  }
  const chats = (
    <div className="telegram-authorizations">
      <h4>{t("已授权聊天")}</h4>
      {telegram?.chats.length ? (
        telegram.chats.map((chat) => (
          <div className="chat-option" key={chat.chatId}>
            <span>
              <strong>{chat.label}</strong>
              <small>{chat.chatId}</small>
            </span>
            <button
              className="text-button danger-text"
              disabled={busy}
              aria-label={tf("撤销 {0} 授权", chat.label)}
              onClick={() =>
                setConfirmation({
                  title: t("撤销聊天授权"),
                  action: () => props.onRevokeTelegramChat(chat.chatId),
                })
              }
            >
              {t("撤销")}
            </button>
          </div>
        ))
      ) : (
        <p className="muted-copy">
          {t("授权后，该聊天发送的新链接会加入解析。")}
        </p>
      )}
      <h4>{t("待授权聊天")}</h4>
      {telegram?.pendingChats.length ? (
        telegram.pendingChats.map((chat) => (
          <div className="chat-option" key={chat.chatId}>
            <span>
              <strong>{chat.label}</strong>
              <small>{chat.chatId}</small>
            </span>
            <button
              className="button button-quiet"
              disabled={busy}
              aria-label={tf("授权 {0}", chat.label)}
              onClick={() =>
                void action(() => props.onAuthorizeTelegramChat(chat.chatId))
              }
            >
              {t("授权")}
            </button>
          </div>
        ))
      ) : (
        <p className="muted-copy">
          {t("向 Bot 发送 /start 后，新聊天会出现在这里。")}
        </p>
      )}
    </div>
  );
  return (
    <section
      className="settings-section telegram-settings"
      aria-label="Telegram"
    >
      <button
        className="telegram-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span>
          <strong>Telegram</strong>
          <small>{t("链接转发到应用内阅读")}</small>
        </span>
        <span>
          <span
            className={`status-tag ${telegram?.connected ? "status-active" : "status-paused"}`}
          >
            {status}
          </span>
          {telegram?.botUsername && <small>@{telegram.botUsername}</small>}
        </span>
        <CaretRight className={expanded ? "expanded" : ""} size={16} />
      </button>
      {expanded && (
        <div className="telegram-management">
          {telegram?.error && (
            <p className="notice notice-warm" role="alert">
              {t(telegram.error)}
            </p>
          )}
          {error && !guide && <p role="alert">{error}</p>}
          {telegram?.configured ? (
            <>
              <div className="telegram-maintenance-row">
                <h3>{t("Telegram 管理")}</h3>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void action(props.onVerifyTelegramBot)}
                >
                  {t("验证连接")}
                </button>
              </div>
              {chats}
              <div className="settings-actions">
                <button
                  className="text-button"
                  onClick={() => {
                    setStep(1);
                    setGuide(true);
                  }}
                >
                  {t("添加聊天")}
                </button>
                <button className="text-button" onClick={start}>
                  {t("查看接入步骤")}
                </button>
              </div>
              <details>
                <summary>{t("维护")}</summary>
                <div className="settings-actions">
                  <button
                    className="text-button"
                    onClick={() => {
                      setStep(0);
                      setGuide(true);
                    }}
                  >
                    {t("更换 Token")}
                  </button>
                  <button
                    className="text-button danger-text"
                    disabled={busy}
                    onClick={() =>
                      setConfirmation({
                        title: t("清除 Token"),
                        action: props.onClearTelegramBotToken,
                      })
                    }
                  >
                    {t("清除 Token")}
                  </button>
                </div>
              </details>
            </>
          ) : (
            <>
              <p>{t("连接一个 Bot，并授权用于发送链接的聊天。")}</p>
              <button className="button" onClick={start}>
                {t("开始配置")}
              </button>
            </>
          )}
        </div>
      )}
      {guide && (
        <Dialog
          title={t("Telegram 接入")}
          className="telegram-guide"
          onClose={finish}
        >
          <ol className="telegram-steps">
            {["连接 Bot", "授权聊天", "完成配置"].map((label, i) => (
              <li key={label} aria-current={step === i ? "step" : undefined}>
                {i + 1} · {t(label)}
              </li>
            ))}
          </ol>
          {error && (
            <p className="notice notice-warm" role="alert">
              {error}
            </p>
          )}
          {step === 0 && (
            <>
              <h3>{t("连接 Bot")}</h3>
              <p>
                {t(
                  "在 Telegram 中打开 BotFather，发送 /newbot，按提示创建 Bot 并复制 Token。",
                )}
              </p>
              <button
                className="text-button"
                onClick={() =>
                  void bridge.openRepositoryLink("https://t.me/BotFather")
                }
              >
                {t("打开 BotFather")}
              </button>
              <label className="settings-field">
                <span>Bot Token</span>
                <input
                  aria-label="Bot Token"
                  type="password"
                  autoComplete="new-password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder={
                    telegram?.configured
                      ? t("输入新的 Token")
                      : t("粘贴 BotFather 提供的 Token")
                  }
                  disabled={busy}
                />
                <small>{t("Token 保存在本机当前用户的凭据文件中。")}</small>
              </label>
              <button
                className="button button-primary"
                disabled={busy || !token.trim()}
                onClick={() =>
                  void action(async () => {
                    if (!(await props.onSaveTelegramToken(token.trim())))
                      return false;
                    setToken("");
                    setStep(1);
                    return true;
                  })
                }
              >
                {busy ? t("正在验证…") : t("保存并验证")}
              </button>
            </>
          )}
          {step === 1 && (
            <>
              <h3>{t("授权聊天")}</h3>
              <p>
                {t(
                  "向你的 Bot 发送 /start。选择出现的聊天并授权，再发送新的链接。",
                )}
              </p>
              {telegram?.botUsername && (
                <button
                  className="text-button"
                  onClick={() =>
                    void bridge.openRepositoryLink(
                      `https://t.me/${telegram.botUsername}`,
                    )
                  }
                >
                  @{telegram.botUsername}
                </button>
              )}
              {chats}
              <div className="settings-actions">
                <button
                  className="button button-quiet"
                  onClick={() => setStep(0)}
                >
                  {t("上一步")}
                </button>
                <button
                  className="button button-primary"
                  disabled={busy || !telegram?.chats.length}
                  onClick={() => setStep(2)}
                >
                  {t("继续")}
                </button>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <h3>{t("接入已配置")}</h3>
              <p>
                {t(
                  "现在可以向已授权聊天发送一条 HTTPS 链接。Bot 确认收取后，在内容中查看解析结果，在顶部任务面板查看进度。",
                )}
              </p>
              <div className="settings-actions">
                <button
                  className="button button-quiet"
                  onClick={() => {
                    finish();
                    props.onOpenContent();
                  }}
                >
                  {t("查看解析结果")}
                </button>
                <button className="button button-primary" onClick={finish}>
                  {t("完成")}
                </button>
              </div>
            </>
          )}
        </Dialog>
      )}
      {confirmation && (
        <Dialog
          title={confirmation.title}
          onClose={() => setConfirmation(undefined)}
        >
          <p>
            {t(
              "后续链接按更新后的配置接收。已保存的内容、任务和收取记录保留。",
            )}
          </p>
          <div className="dialog-actions">
            <button
              className="button"
              onClick={() => setConfirmation(undefined)}
            >
              {t("保留配置")}
            </button>
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() =>
                void action(confirmation.action).then((ok) => {
                  if (ok) setConfirmation(undefined);
                })
              }
            >
              {t("确认")}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
