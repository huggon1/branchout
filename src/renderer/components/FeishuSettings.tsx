import { useEffect, useState } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { Dialog } from "./Primitives";
import { bridge } from "../bridge";
import { t, tf } from "../i18n";
import type { BotStatus } from "../../shared/bot-contracts";

/** Feishu setup uses the common bot management API and existing settings styles. */
export function FeishuSettings({
  onOpenContent,
}: {
  onOpenContent: () => void;
}) {
  const channel = "feishu" as const;
  const name = t("飞书");
  const [status, setStatus] = useState<BotStatus>();
  const [expanded, setExpanded] = useState(false),
    [guide, setGuide] = useState(false);
  const [step, setStep] = useState(0),
    [manual, setManual] = useState(false);
  const [appId, setAppId] = useState(""),
    [secret, setSecret] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<() => Promise<unknown>>();
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const reply = await bridge.botStatus(channel);
      if (active && reply.ok) setStatus(reply.value);
    };
    void refresh();
    const unsubscribe = bridge.onChanged(() => void refresh());
    return () => {
      active = false;
      unsubscribe();
    };
  }, [channel]);
  async function action(
    work: () => Promise<{ ok: boolean; message?: string }>,
  ) {
    setBusy(true);
    setError("");
    try {
      const reply = await work();
      if (!reply.ok) setError(reply.message ?? t("机器人操作未完成"));
      return reply.ok;
    } catch {
      setError(t("机器人操作未完成"));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const finish = () => {
    setGuide(false);
    setSecret("");
    setError("");
    void bridge.cancelBotRegistration(channel);
  };
  const start = () => {
    setStep(status?.configured ? (status.authorizedChatIds.length ? 2 : 1) : 0);
    setError("");
    setGuide(true);
  };
  const authorized = new Set(status?.authorizedChatIds ?? []);
  const chats = (
    <div className="telegram-authorizations">
      <h4>{t("已授权聊天")}</h4>
      {(status?.authorizedChatIds ?? []).map((id) => (
        <div className="chat-option" key={id}>
          <span>
            <strong>{id}</strong>
          </span>
          <button
            className="text-button danger-text"
            disabled={busy}
            aria-label={tf("撤销 {0} 授权", id)}
            onClick={() =>
              setConfirm(
                () => async () =>
                  action(() => bridge.revokeBotChat(channel, id)),
              )
            }
          >
            {t("撤销")}
          </button>
        </div>
      ))}
      <h4>{t("待授权聊天")}</h4>
      {(status?.pendingChats ?? [])
        .filter((chat) => !authorized.has(chat.chatId))
        .map((chat) => (
          <div className="chat-option" key={chat.chatId}>
            <span>
              <strong>{chat.title}</strong>
              <small>{chat.chatId}</small>
            </span>
            <button
              className="button button-quiet"
              disabled={busy}
              aria-label={tf("授权 {0}", chat.title)}
              onClick={() =>
                void action(() => bridge.authorizeBotChat(channel, chat.chatId))
              }
            >
              {t("授权")}
            </button>
          </div>
        ))}
      <p className="muted-copy">
        {t(
          "向机器人发送一条消息后，在这里授权本人单聊。授权后发送的新链接会加入解析。",
        )}
      </p>
    </div>
  );
  return (
    <section className="settings-section bot-settings" aria-label={name}>
      <button
        className="telegram-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span>
          <strong>{name}</strong>
          <small>{t("链接转发到应用内阅读")}</small>
        </span>
        <span>
          <span
            className={`status-tag ${status?.status === "connected" ? "status-active" : "status-paused"}`}
          >
            {t(
              status?.status === "connected"
                ? "正在接收"
                : status?.lastError
                  ? "连接异常"
                  : status?.configured
                    ? "已配置"
                    : "未连接",
            )}
          </span>
          {status?.botName && <small>{status.botName}</small>}
        </span>
        <CaretRight className={expanded ? "expanded" : ""} size={16} />
      </button>
      {expanded && (
        <div className="telegram-management">
          {((error && !guide) || status?.lastError) && (
            <p className="notice notice-warm" role="alert">
              {error || t(status!.lastError!)}
            </p>
          )}
          {status?.configured ? (
            <>
              <div className="telegram-maintenance-row">
                <h3>{tf("{0}管理", name)}</h3>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void action(() => bridge.verifyBot(channel))}
                >
                  {t("验证连接")}
                </button>
              </div>
              {chats}
              <p className="muted-copy">
                {t("待入队")}: {status.queued} · {t("待发送回执")}:{" "}
                {status.pendingAcknowledgements}
              </p>
              <div className="settings-actions">
                <button className="text-button" onClick={start}>
                  {t("查看接入步骤")}
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setStep(0);
                    setGuide(true);
                  }}
                >
                  {t("更换应用")}
                </button>
                <button
                  className="text-button danger-text"
                  disabled={busy}
                  onClick={() =>
                    setConfirm(
                      () => async () =>
                        action(() => bridge.clearBotCredentials(channel)),
                    )
                  }
                >
                  {t("清除配置")}
                </button>
              </div>
            </>
          ) : (
            <button className="button" onClick={start}>
              {t("开始配置")}
            </button>
          )}
        </div>
      )}
      {guide && (
        <Dialog
          title={tf("{0}接入", name)}
          className="telegram-guide"
          onClose={finish}
        >
          <ol className="telegram-steps">
            {["连接机器人", "授权聊天", "完成配置"].map((label, i) => (
              <li key={label} aria-current={step === i ? "step" : undefined}>
                {i + 1} · {t(label)}
              </li>
            ))}
          </ol>
          {(error || status?.registration?.error) && (
            <p className="notice notice-warm" role="alert">
              {error || t(status!.registration!.error!)}
            </p>
          )}
          {step === 0 && (
            <>
              <h3>{t("连接机器人")}</h3>
              <p>
                {t(
                  "创建自己的飞书应用机器人，并将事件订阅设为长连接。每个应用由一台 Postrove 接收消息。",
                )}
              </p>
              <div className="settings-actions">
                <button
                  className="button button-primary"
                  disabled={busy || !!status?.registration?.url}
                  onClick={() =>
                    void action(() => bridge.startBotRegistration(channel))
                  }
                >
                  {t("扫码创建应用")}
                </button>
                <button
                  className="text-button"
                  onClick={() => setManual(!manual)}
                >
                  {t("使用已有应用")}
                </button>
              </div>
              {status?.registration?.url && (
                <div className="notice">
                  <p>{t("打开飞书授权页面并扫码确认，凭据会保存到本机。")}</p>
                  <button
                    className="button"
                    onClick={() =>
                      void bridge.openRepositoryLink(status.registration!.url!)
                    }
                  >
                    {t("打开扫码授权页面")}
                  </button>
                  <p>
                    {t("链接到期时间")}:{" "}
                    {new Date(
                      status.registration.expiresAt!,
                    ).toLocaleTimeString()}
                  </p>
                  <button
                    className="text-button"
                    onClick={() => void bridge.cancelBotRegistration(channel)}
                  >
                    {t("取消连接")}
                  </button>
                </div>
              )}
              <p>
                {t(
                  "在飞书开放平台启用机器人、单聊接收、发送消息和读取历史消息权限，订阅接收消息事件，设置长连接并发布应用。",
                )}
              </p>
              <button
                className="text-button"
                onClick={() =>
                  void bridge.openRepositoryLink("https://open.feishu.cn/app")
                }
              >
                {t("打开飞书开放平台")}
              </button>
              {status?.configured && (
                <button className="button" onClick={() => setStep(1)}>
                  {t("继续")}
                </button>
              )}
              {manual && (
                <>
                  <label className="settings-field">
                    <span>App ID</span>
                    <input
                      aria-label="App ID"
                      value={appId}
                      onChange={(event) => setAppId(event.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <label className="settings-field">
                    <span>App Secret</span>
                    <input
                      aria-label="App Secret"
                      type="password"
                      autoComplete="new-password"
                      value={secret}
                      onChange={(event) => setSecret(event.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <button
                    className="button button-primary"
                    disabled={busy || !appId.trim() || !secret.trim()}
                    onClick={() =>
                      void action(async () => {
                        const reply = await bridge.saveBotCredentials(channel, {
                          appId: appId.trim(),
                          appSecret: secret.trim(),
                        });
                        if (reply.ok) {
                          setSecret("");
                          setStep(1);
                        }
                        return reply;
                      })
                    }
                  >
                    {t("保存并验证")}
                  </button>
                </>
              )}
            </>
          )}
          {step === 1 && (
            <>
              <h3>{t("授权聊天")}</h3>
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
                  disabled={!status?.authorizedChatIds.length}
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
                    onOpenContent();
                  }}
                >
                  {t("打开解析结果")}
                </button>
                <button className="button button-primary" onClick={finish}>
                  {t("完成")}
                </button>
              </div>
            </>
          )}
        </Dialog>
      )}
      {confirm && (
        <Dialog
          title={t("确认修改机器人配置")}
          onClose={() => setConfirm(undefined)}
        >
          <p>
            {t(
              "后续链接按更新后的配置接收。已保存的内容、任务和收取记录保留。",
            )}
          </p>
          <div className="settings-actions">
            <button
              className="button button-quiet"
              onClick={() => setConfirm(undefined)}
            >
              {t("保留配置")}
            </button>
            <button
              className="button"
              onClick={async () => {
                await confirm();
                setConfirm(undefined);
              }}
            >
              {t("确认")}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
