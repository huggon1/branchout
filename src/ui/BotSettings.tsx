import React, { useState } from "react";
const names = { telegram: "Telegram", feishu: "飞书" };
export function BotSettings({
  bots,
  act,
}: {
  bots: any;
  act: (c: any) => Promise<any>;
}) {
  const [selected, setSelected] = useState<"telegram" | "feishu" | null>(null);
  return (
    <section className="panel bot-settings">
      {selected ? (
        <>
          <button
            className="settings-back bot-channel-back"
            onClick={() => setSelected(null)}
          >
            返回转发接入
          </button>
          <BotCard
            channel={selected}
            status={bots?.[selected] || {}}
            act={act}
          />
        </>
      ) : (
        <>
          <h2>转发机器人</h2>
          <div className="settings-row-list bot-channel-list">
            {(["telegram", "feishu"] as const).map((channel) => {
              const status = bots?.[channel] || {};
              return (
                <button
                  className="settings-row"
                  key={channel}
                  onClick={() => setSelected(channel)}
                >
                  <span className="connection-avatar">
                    {channel === "telegram" ? "T" : "飞"}
                  </span>
                  <span className="connection-choice-text">
                    <strong>{names[channel]}</strong>
                    <small>接收本人私聊中的支持链接</small>
                  </span>
                  <span
                    className={`connection-status-pill ${status.bound && status.enabled ? "ok" : ""}`}
                  >
                    {status.bound && status.enabled ? "已连接" : "未连接"}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
function BotCard({
  channel,
  status,
  act,
}: {
  channel: "telegram" | "feishu";
  status: any;
  act: (c: any) => Promise<any>;
}) {
  const [secret, setSecret] = useState("");
  const [appId, setAppId] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="bot-card">
      <h3>
        {names[channel]} <small>{status.state || "未配置"}</small>
      </h3>
      <div className="actions">
        <button
          onClick={() =>
            act({
              type: "open",
              url:
                channel === "telegram"
                  ? "https://t.me/BotFather"
                  : "https://open.feishu.cn/",
            })
          }
        >
          {channel === "telegram" ? "打开 BotFather" : "打开飞书开放平台"}
        </button>
        {channel === "telegram" && status.name && (
          <button
            onClick={() =>
              act({
                type: "open",
                url: `https://t.me/${encodeURIComponent(status.name)}`,
              })
            }
          >
            打开机器人私聊
          </button>
        )}
      </div>
      <details>
        <summary>创建与配置步骤</summary>
        {channel === "telegram" ? (
          <ol>
            <li>
              在 Telegram 找到 @BotFather，使用 /newbot 创建专用机器人，复制
              Token。
            </li>
            <li>在下方保存并连接，再生成绑定码。</li>
            <li>
              打开机器人的私聊，发送完整绑定命令。绑定成功后发送分享文案。
            </li>
            <li>
              不要让其他程序同时接收该机器人的消息。离线消息最长保留 24 小时。
            </li>
          </ol>
        ) : (
          <ol>
            <li>
              打开飞书开放平台，创建企业自建应用，启用机器人，获取 App ID 与 App
              Secret。
            </li>
            <li>
              开通接收单聊消息权限 im:message.p2p_msg:readonly 和发送消息权限
              im:message:send_as_bot。
            </li>
            <li>
              在此保存并连接，然后在「事件与回调」选择长连接，订阅
              im.message.receive_v1（接收消息）。
            </li>
            <li>
              发布应用版本，将自己加入可用范围；如组织要求审批，先完成审批。
            </li>
            <li>
              生成绑定码，在飞书与机器人私聊发送绑定命令。长连接成功后仍需发送链接验证事件权限。
            </li>
          </ol>
        )}
      </details>
      {channel === "feishu" && (
        <label>
          App ID
          <input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder={status.appId || "cli_…"}
            autoComplete="off"
          />
        </label>
      )}
      <label>
        {channel === "telegram" ? "Bot Token" : "App Secret"}
        <input
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={
            status.configured ? "已加密保存，留空保留" : "仅在本机加密保存"
          }
        />
      </label>
      <div className="actions">
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await act({
                type: "botSave",
                channel,
                secret: secret || undefined,
                appId: appId || undefined,
              });
              if (r !== undefined) setSecret("");
            } finally {
              setBusy(false);
            }
          }}
        >
          保存并连接
        </button>
        <button
          disabled={!status.enabled}
          onClick={() => act({ type: "botDisable", channel })}
        >
          停用
        </button>
      </div>
      <p>
        {status.bound ? "已绑定本人私聊" : "尚未绑定私聊"}
        {status.name ? ` · @${status.name}` : ""}
      </p>
      <button
        disabled={!status.enabled}
        onClick={() => act({ type: "botBind", channel })}
      >
        {status.bound ? "重新绑定本人私聊" : "生成绑定码"}
      </button>
      {status.bindingCode && (
        <div className="abstract">
          <p>10 分钟内，在机器人私聊中发送：</p>
          <code>/bind {status.bindingCode}</code>
          <button
            onClick={() =>
              act({ type: "copy", text: `/bind ${status.bindingCode}` })
            }
          >
            复制绑定命令
          </button>
        </div>
      )}
      {status.lastReceived && (
        <p className="muted">
          最近接收：{new Date(status.lastReceived).toLocaleString("zh-CN")}
        </p>
      )}
      {status.error && <p className="warning">{status.error}</p>}
      {status.receiptError && <p className="warning">{status.receiptError}</p>}
    </div>
  );
}
