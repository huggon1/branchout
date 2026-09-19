import React, { useEffect, useState } from "react";
import { Icon } from "./Icons.js";
import {
  defaultConnection,
  type ModelConnection,
} from "../core/model-settings.js";
import { BotSettings } from "./BotSettings.js";
type PublicConnection = ModelConnection & { hasApiKey?: boolean };
type Props = {
  state: any;
  initialSection?: string;
  act: (c: any) => Promise<any>;
  refresh: () => Promise<void>;
  onDirty: (dirty: boolean) => void;
  setNotice: (value: string) => void;
};
const sources = [
  {
    id: "github",
    name: "GitHub",
    description: "公开来源探索",
    capabilities:
      "公开探索与转发的 GitHub README／链接读取无需登录。项目回顾只读取你在本机明确选择的 Git checkout，不再使用 GitHub Token。",
  },
  {
    id: "xiaohongshu",
    name: "小红书",
    description: "笔记解析与关键词收集",
    capabilities:
      "扫码连接后可解析笔记、按关键词收集。平台验证可能影响部分内容的可用性。",
  },
  {
    id: "x",
    name: "X",
    description: "关键词收集",
    capabilities: "在独立登录窗口完成登录后，可按关键词收集公开帖子。",
  },
];
type SettingsCategory = "sources" | "forwarding" | "models" | "local";

const categoryForSelection = (selection?: string): SettingsCategory => {
  if (selection === "bots") return "forwarding";
  if (selection?.startsWith("source-")) return "sources";
  if (selection?.startsWith("local-")) return "local";
  if (selection) return "models";
  return "sources";
};
export function Connections({
  state,
  refresh,
  onDirty,
  initialSection,
  act,
  setNotice,
}: Props) {
  const settings = state.modelSettings || {
    activeId: "codex",
    connections: [defaultConnection],
  };
  const connections: PublicConnection[] = settings.connections;
  const [category, setCategory] = useState<SettingsCategory>(() =>
    categoryForSelection(initialSection),
  );
  const [selected, setSelected] = useState(initialSection || "");
  const [draft, setDraft] = useState<PublicConnection>(
    () =>
      connections.find((c) => c.id === (initialSection || settings.activeId)) ||
      connections[0],
  );
  const [baseline, setBaseline] = useState(() => JSON.stringify(draft));
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [test, setTest] = useState<any>();
  const [catalog, setCatalog] = useState<any>();
  const [loadingModels, setLoadingModels] = useState(false);
  const [qr, setQr] = useState("");
  const [adding, setAdding] = useState(false);
  const botSelected = selected === "bots";
  const localSelected = selected.startsWith("local-");
  const source = sources.find((p) => selected === `source-${p.id}`);
  const saved = connections.find((c) => c.id === draft.id);
  const dirty =
    Boolean(selected) &&
    !source &&
    !botSelected &&
    !localSelected &&
    (JSON.stringify(draft) !== baseline || Boolean(key) || !saved);
  const anyDirty = dirty;
  useEffect(() => {
    onDirty(anyDirty);
    return () => onDirty(false);
  }, [anyDirty, onDirty]);
  const command = async (value: any) => {
    const r = await window.feedloom.command(value);
    if (!r.ok) throw Error(r.error);
    return r.value;
  };
  const run = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      setBusy("");
    }
  };
  useEffect(
    () => () => {
      void window.feedloom.command({ type: "cancelModelOperation" });
    },
    [],
  );
  const loadModels = async () => {
    setCatalog(undefined);
    setTest(undefined);
    setLoadingModels(true);
    try {
      const value = await command({ type: "codexModels" });
      setCatalog(value);
    } finally {
      setLoadingModels(false);
    }
  };
  useEffect(() => {
    if (
      selected &&
      !source &&
      !botSelected &&
      !localSelected &&
      draft.mode === "codex" &&
      !catalog
    )
      void loadModels().catch((e) => setError(e.message));
  }, [selected]);
  const edit = (patch: Partial<PublicConnection>) => {
    setDraft({ ...draft, ...patch });
    setMessage("");
    setError("");
    setTest(undefined);
  };
  const choose = (id: string, next?: PublicConnection) => {
    if (busy || loadingModels) return;
    if (dirty && !confirm("连接有未保存的修改，切换并放弃这些修改？")) return;
    setSelected(id);
    setKey("");
    setError("");
    setMessage("");
    setTest(undefined);
    setQr("");
    if (next) {
      setDraft(next);
      setBaseline(JSON.stringify(next));
    }
  };
  const chooseCategory = (next: SettingsCategory) => {
    if (busy || loadingModels) return;
    if (dirty && !confirm("连接有未保存的修改，切换并放弃这些修改？")) return;
    setCategory(next);
    setSelected("");
    setKey("");
    setError("");
    setMessage("");
    setTest(undefined);
    setQr("");
  };
  const add = (mode: "api" | "codex") => {
    setAdding(false);
    const existingCodex = connections.find((c) => c.mode === "codex");
    if (mode === "codex" && existingCodex) {
      choose(existingCodex.id, existingCodex);
      return;
    }
    const next: PublicConnection = {
      ...defaultConnection,
      id: crypto.randomUUID(),
      name: mode === "api" ? "自定义 API" : "Codex 订阅",
      mode,
      model: mode === "api" ? "" : defaultConnection.model,
      protocol: "openai-completions",
    };
    choose(next.id, next);
  };
  const valid = Boolean(
    draft.name.trim() && draft.model.trim() && draft.baseUrl.trim(),
  );
  const available =
    draft.mode === "api" ||
    catalog?.models.some((m: any) => m.id === draft.model && m.supported);
  const controlsDisabled = Boolean(busy || loadingModels);
  const canKeepKey = saved?.hasApiKey && saved.baseUrl === draft.baseUrl;
  const fields = () => ({
    id: draft.id,
    name: draft.name,
    mode: draft.mode,
    model: draft.model,
    baseUrl: draft.baseUrl,
    protocol: draft.protocol,
  });
  const categoryTitle: Record<SettingsCategory, string> = {
    sources: "来源平台",
    forwarding: "转发接入",
    models: "模型服务",
    local: "数据与隐私",
  };
  const settingsRows =
    category === "sources"
      ? sources.map((item) => ({
          id: `source-${item.id}`,
          name: item.name,
          mark: item.id === "github" ? "G" : item.id === "x" ? "X" : "红",
          description: item.description,
          status:
            item.id === "github"
              ? "可用"
              : state.connections[item.id]
                ? "已连接"
                : "需要登录",
          ok: item.id === "github" || Boolean(state.connections[item.id]),
        }))
      : category === "forwarding"
        ? [
            {
              id: "bots",
              name: "转发机器人",
              mark: "转",
              description: "Telegram 与飞书私聊接收",
              status: Object.values(state.bots || {}).some(
                (bot: any) => bot.bound && bot.enabled,
              )
                ? "已连接"
                : "未连接",
              ok: Object.values(state.bots || {}).some(
                (bot: any) => bot.bound && bot.enabled,
              ),
            },
          ]
        : category === "models"
          ? connections.map((item) => ({
              id: item.id,
              connection: item,
              name: item.name,
              mark: item.mode === "codex" ? "C" : "A",
              description:
                item.mode === "codex"
                  ? `${item.model} · Codex 订阅`
                  : `${item.model || "未选择模型"} · 自定义 API`,
              status: settings.activeId === item.id ? "使用中" : "已保存",
              ok: true,
            }))
          : [
              {
                id: "local-data",
                name: "数据存储",
                mark: "D",
                description: "数据、登录状态与缓存",
                status: "仅此设备",
                ok: true,
              },
            ];
  return (
    <div className="connections-layout">
      <div
        className="settings-categories"
        role="complementary"
        aria-label="设置分类"
      >
        {(
          [
            ["sources", "source", "来源平台"],
            ["forwarding", "send", "转发接入"],
            ["models", "sparkle", "模型服务"],
            ["local", "local", "数据与隐私"],
          ] as const
        ).map(([id, icon, label]) => (
          <button
            key={id}
            className={category === id ? "active" : ""}
            aria-current={category === id ? "page" : undefined}
            onClick={() => chooseCategory(id)}
          >
            <Icon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      {!selected ? (
        <section
          className="settings-index"
          aria-labelledby="settings-category-title"
        >
          <header className="settings-index-header">
            <h2 id="settings-category-title">{categoryTitle[category]}</h2>
            {category === "models" && (
              <button
                className="icon-button"
                aria-label="添加连接"
                aria-expanded={adding}
                onClick={() => setAdding((value) => !value)}
              >
                <Icon name="plus" />
              </button>
            )}
          </header>
          {adding && category === "models" && (
            <div
              className="connection-add-options"
              role="group"
              aria-label="连接类型"
            >
              <button onClick={() => add("api")}>自定义 API</button>
              <button onClick={() => add("codex")}>Codex 订阅</button>
            </div>
          )}
          <div className="settings-row-list">
            {settingsRows.map((item: any) => (
              <button
                key={item.id}
                className="settings-row"
                onClick={() => choose(item.id, item.connection)}
              >
                <span className="connection-avatar">{item.mark}</span>
                <span className="connection-choice-text">
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </span>
                <span
                  className={`connection-status-pill ${item.ok ? "ok" : ""}`}
                >
                  {item.status}
                </span>
                <Icon name="chevron" />
              </button>
            ))}
          </div>
        </section>
      ) : botSelected ? (
        <section className="settings-bot-detail">
          <button className="settings-back" onClick={() => setSelected("")}>
            <Icon name="back" /> {categoryTitle[category]}
          </button>
          <BotSettings bots={state.bots} act={act} />
        </section>
      ) : localSelected ? (
        <section className="panel connection-detail settings-static-detail">
          <button className="settings-back" onClick={() => setSelected("")}>
            <Icon name="back" /> {categoryTitle[category]}
          </button>
          <header className="connection-detail-header">
            <div>
              <h2>数据存储</h2>
            </div>
            <span className="connection-status">仅此设备</span>
          </header>
          <div className="connection-note">
            <strong>不会自动同步</strong>
            <p>
              仓库内容仅在执行分析时按需发送给你配置的模型服务；不会发送给搜索平台。
            </p>
          </div>
        </section>
      ) : (
        <section className="panel connection-detail">
          <button className="settings-back" onClick={() => setSelected("")}>
            <Icon name="back" /> {categoryTitle[category]}
          </button>
          <header className="connection-detail-header">
            <div>
              <h2>{source?.name || draft.name || "新建连接"}</h2>
            </div>
            <span className={`connection-status ${dirty ? "draft" : ""}`}>
              {source
                ? source.id === "github"
                  ? "无需登录"
                  : state.connections[source.id]
                    ? "已连接"
                    : "待检查"
                : dirty
                  ? "未保存"
                  : settings.activeId === draft.id
                    ? "当前使用"
                    : "已保存"}
            </span>
          </header>
          {source ? (
            <div className="connection-form">
              <div className="connection-note">
                <strong>可用能力</strong>
                <p>{source.capabilities}</p>
              </div>
              {source.id !== "github" && (
                <>
                  <p className="muted">
                    登录成功与解析、收集成功分别判断，实际运行结果以任务记录为准。
                  </p>
                  <div className="actions">
                    <button
                      className="primary"
                      disabled={controlsDisabled}
                      onClick={() =>
                        void run("检查登录", async () => {
                          const r = await command({
                            type: "connect",
                            platform: source.id,
                          });
                          if (r?.qr) setQr(r.qr);
                          if (r?.loggedIn) {
                            setQr("");
                            setMessage("登录检查通过");
                          } else if (!r?.qr)
                            setMessage(
                              "请在打开的窗口中完成登录，再检查连接。",
                            );
                          await refresh();
                        })
                      }
                    >
                      连接／检查登录
                    </button>
                    <button
                      disabled={
                        controlsDisabled || !state.connections[source.id]
                      }
                      onClick={() => {
                        if (
                          confirm(
                            `退出 ${source.name} 登录？之后需要重新登录。`,
                          )
                        )
                          void run("退出连接", async () => {
                            await command({
                              type: "disconnect",
                              platform: source.id,
                            });
                            setQr("");
                            await refresh();
                            setMessage("已退出连接");
                          });
                      }}
                    >
                      退出连接
                    </button>
                  </div>
                </>
              )}
              {qr && (
                <div className="qr">
                  <img src={qr} alt="小红书登录二维码" />
                  <p>使用小红书扫码，完成后点击检查登录。</p>
                </div>
              )}
            </div>
          ) : (
            <>
              <fieldset className="connection-form" disabled={controlsDisabled}>
                <label>
                  连接名称
                  <input
                    value={draft.name}
                    maxLength={80}
                    onChange={(e) => edit({ name: e.target.value })}
                  />
                </label>
                {draft.mode === "api" ? (
                  <>
                    <label>
                      服务地址（Base URL）
                      <input
                        value={draft.baseUrl}
                        placeholder="https://api.example.com/v1"
                        onChange={(e) => {
                          edit({ baseUrl: e.target.value });
                          setKey("");
                        }}
                      />
                    </label>
                    <label>
                      API Key
                      <input
                        type="password"
                        autoComplete="off"
                        value={key}
                        placeholder={
                          canKeepKey
                            ? "已安全保存，留空保留"
                            : "输入这个服务的 API Key"
                        }
                        onChange={(e) => {
                          setKey(e.target.value);
                          setTest(undefined);
                          setError("");
                        }}
                      />
                    </label>
                    {saved?.hasApiKey && !canKeepKey && (
                      <p className="connection-hint">
                        服务地址已改变，请重新填写 API Key。
                      </p>
                    )}
                    <label>
                      模型名称
                      <input
                        value={draft.model}
                        maxLength={160}
                        placeholder="填写服务商提供的模型 ID"
                        onChange={(e) => edit({ model: e.target.value })}
                      />
                    </label>
                    <details>
                      <summary>高级设置</summary>
                      <label>
                        接口类型
                        <select
                          aria-label="接口类型"
                          value={draft.protocol}
                          onChange={(e) =>
                            edit({
                              protocol: e.target
                                .value as ModelConnection["protocol"],
                            })
                          }
                        >
                          <option value="openai-completions">
                            Chat Completions
                          </option>
                          <option value="openai-responses">Responses</option>
                        </select>
                      </label>
                      <p className="connection-hint">
                        按服务商文档选择接口。此连接处理文本，单次输出上限为
                        4096 tokens。
                      </p>
                    </details>
                  </>
                ) : (
                  <>
                    <div className="connection-note">
                      <strong>
                        {catalog ? "已识别订阅登录" : "Codex 订阅登录"}
                      </strong>
                      <p>
                        {catalog?.source ||
                          "可复用本机 Codex 文件登录，或在 nature-feed 中独立登录。"}
                      </p>
                      <p className="connection-hint">
                        独立登录由官方组件管理；已有本机登录过期时，可在 Codex
                        中刷新或在这里重新登录。
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          void run("等待浏览器登录", async () => {
                            setTest(undefined);
                            setCatalog(undefined);
                            await command({ type: "loginCodex" });
                            setCatalog(undefined);
                            await loadModels();
                            setTest(undefined);
                            setMessage("登录已完成，请选择模型并测试连接。");
                          })
                        }
                      >
                        登录 Codex
                      </button>
                    </div>
                    <label>
                      模型
                      <select
                        aria-label="模型"
                        value={draft.model}
                        onChange={(e) => edit({ model: e.target.value })}
                      >
                        {!catalog?.models.some(
                          (m: any) => m.id === draft.model,
                        ) && (
                          <option value={draft.model}>
                            {draft.model} · 待验证
                          </option>
                        )}
                        {catalog?.models.map((m: any) => (
                          <option
                            key={m.id}
                            value={m.id}
                            disabled={!m.supported}
                          >
                            {m.name}
                            {!m.supported ? " · 需更新应用" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="connection-model-refresh">
                      <small className="muted">
                        名单来自 Codex；模型是否可调用以测试结果为准。
                      </small>
                      <button
                        onClick={() =>
                          void run("刷新模型", async () => {
                            await loadModels();
                            setTest(undefined);
                          })
                        }
                      >
                        刷新模型列表
                      </button>
                    </div>
                  </>
                )}
              </fieldset>
              <div className="connection-test" aria-live="polite">
                <strong>
                  {busy === "测试连接"
                    ? "正在验证模型响应…"
                    : test
                      ? "连接测试通过"
                      : "待测试"}
                </strong>
                <p>
                  {test
                    ? `${test.model} · ${(test.elapsedMs / 1000).toFixed(1)} 秒 · ${new Date(test.checkedAt).toLocaleTimeString("zh-CN")}`
                    : "发送一条不含业务内容的短请求，消耗少量模型额度。修改配置后需要重新测试。"}
                </p>
              </div>
              <footer className="connection-footer">
                <div className="actions">
                  <button
                    disabled={controlsDisabled || !valid || !available}
                    onClick={() =>
                      void run("测试连接", async () => {
                        setTest(undefined);
                        const result = await command({
                          type: "testModelConnection",
                          connection: fields(),
                          apiKey: key || undefined,
                        });
                        setTest(result);
                      })
                    }
                  >
                    测试连接
                  </button>
                  <button
                    className="primary"
                    disabled={controlsDisabled || !dirty || !valid}
                    onClick={() =>
                      void run("保存配置", async () => {
                        await command({
                          type: "saveModelConnection",
                          connection: fields(),
                          apiKey: key || undefined,
                        });
                        const next = {
                          ...fields(),
                          hasApiKey:
                            draft.mode === "api" && Boolean(key || canKeepKey),
                        };
                        setDraft(next);
                        setBaseline(JSON.stringify(next));
                        setKey("");
                        await refresh();
                        setMessage("配置已保存");
                      })
                    }
                  >
                    保存配置
                  </button>
                  {settings.activeId !== draft.id && saved && (
                    <button
                      disabled={controlsDisabled || dirty}
                      onClick={() =>
                        void run("启用连接", async () => {
                          await command({
                            type: "activateModelConnection",
                            id: draft.id,
                          });
                          await refresh();
                          setMessage("所有 Agent 功能将使用这个连接");
                        })
                      }
                    >
                      设为当前使用
                    </button>
                  )}
                </div>
                {saved && settings.activeId !== draft.id && (
                  <button
                    className="connection-delete"
                    disabled={controlsDisabled}
                    onClick={() => {
                      if (confirm(`删除连接「${draft.name}」？`))
                        void run("删除连接", async () => {
                          await command({
                            type: "deleteModelConnection",
                            id: draft.id,
                          });
                          const next = connections.find(
                            (c) => c.id === settings.activeId,
                          )!;
                          setSelected(next.id);
                          setDraft(next);
                          setBaseline(JSON.stringify(next));
                          setKey("");
                          await refresh();
                        });
                    }}
                  >
                    删除连接
                  </button>
                )}
              </footer>
              <p className="connection-hint connection-bottom-note">
                保存不等于连接可用。不会自动切换模型或计费方式。
              </p>
            </>
          )}
          {busy && (
            <p role="status" className="connection-feedback">
              {busy}…
              {["测试连接", "等待浏览器登录"].includes(busy) && (
                <button
                  onClick={() => void command({ type: "cancelModelOperation" })}
                >
                  取消
                </button>
              )}
            </p>
          )}
          {error && (
            <p role="alert" className="connection-feedback error">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="connection-feedback">
              {message}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
