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
  githubKey: string;
  setGithubKey: (value: string) => void;
  setNotice: (value: string) => void;
};
const sources = [
  {
    id: "github",
    name: "GitHub",
    description: "公开探索与授权仓库分析",
    capabilities:
      "公开仓库探索无需登录；私有仓库分析需要对目标仓库具有 Contents 与 Pull requests 只读权限的 Token。",
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
export function Connections({
  state,
  refresh,
  onDirty,
  initialSection,
  act,
  githubKey,
  setGithubKey,
  setNotice,
}: Props) {
  const settings = state.modelSettings || {
    activeId: "codex",
    connections: [defaultConnection],
  };
  const connections: PublicConnection[] = settings.connections;
  const [selected, setSelected] = useState(initialSection || settings.activeId);
  const [draft, setDraft] = useState<PublicConnection>(
    () => connections.find((c) => c.id === selected) || connections[0],
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
  const source = sources.find((p) => selected === `source-${p.id}`);
  const saved = connections.find((c) => c.id === draft.id);
  const dirty =
    !source &&
    !botSelected &&
    (JSON.stringify(draft) !== baseline || Boolean(key) || !saved);
  const anyDirty = dirty || (source?.id === "github" && Boolean(githubKey));
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
    if (!source && !botSelected && draft.mode === "codex" && !catalog)
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
  return (
    <div className="connections-layout">
      <div
        className="connection-list panel"
        role="complementary"
        aria-label="连接列表"
      >
        <div className="connection-list-title">
          <h2>模型服务</h2>
          <button
            aria-label="添加连接"
            onClick={() => setAdding(!adding)}
            disabled={controlsDisabled}
          >
            <Icon name="plus" />
          </button>
        </div>
        {adding && (
          <div
            className="connection-add-options"
            role="group"
            aria-label="连接类型"
          >
            <button onClick={() => add("api")}>自定义 API</button>
            <button onClick={() => add("codex")}>Codex 订阅</button>
          </div>
        )}
        <p className="connection-hint">选择一个服务用于所有 Agent 功能</p>
        {connections.map((c) => (
          <button
            key={c.id}
            className={`connection-choice ${selected === c.id ? "selected" : ""}`}
            onClick={() => choose(c.id, c)}
            disabled={controlsDisabled}
          >
            <span className="connection-avatar">
              {c.mode === "codex" ? "C" : "A"}
            </span>
            <span className="connection-choice-text">
              <strong>{c.name}</strong>
              <small>
                {c.mode === "codex" ? "订阅 · Codex" : "自定义 API"}
              </small>
            </span>
            {settings.activeId === c.id && (
              <span className="connection-tag">使用中</span>
            )}
          </button>
        ))}
        {!saved && !source && !botSelected && (
          <div className="connection-choice selected">
            <span className="connection-avatar">A</span>
            <span className="connection-choice-text">
              <strong>{draft.name || "新连接"}</strong>
              <small>尚未保存</small>
            </span>
          </div>
        )}
        <h2 className="source-list-title">来源平台</h2>
        {sources.map((p) => (
          <button
            key={p.id}
            className={`connection-choice ${selected === `source-${p.id}` ? "selected" : ""}`}
            onClick={() => choose(`source-${p.id}`)}
            disabled={controlsDisabled}
          >
            <span className="connection-avatar">
              {p.id === "github" ? "G" : p.id === "x" ? "X" : "红"}
            </span>
            <span className="connection-choice-text">
              <strong>{p.name}</strong>
              <small>
                {p.id === "github"
                  ? state.hasGithubToken
                    ? "私有仓库已授权"
                    : "公开仓库可用"
                  : state.connections[p.id]
                    ? "已连接"
                    : "未连接或待检查"}
              </small>
            </span>
          </button>
        ))}
        <h2 className="source-list-title">转发接入</h2>
        <button
          className={`connection-choice ${botSelected ? "selected" : ""}`}
          onClick={() => choose("bots")}
          disabled={controlsDisabled}
        >
          <span className="connection-avatar">
            <Icon name="inbox" />
          </span>
          <span className="connection-choice-text">
            <strong>转发机器人</strong>
            <small>Telegram · 飞书</small>
          </span>
        </button>
      </div>
      {botSelected ? (
        <BotSettings bots={state.bots} act={act} />
      ) : (
        <section className="panel connection-detail">
          <header className="connection-detail-header">
            <div>
              <h2>{source?.name || draft.name || "新建连接"}</h2>
              <p className="muted">
                {source?.description ||
                  (draft.mode === "codex"
                    ? "使用订阅登录，选择可用模型。"
                    : "连接 OpenAI 兼容服务，使用你自己的模型与 API Key。")}
              </p>
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
              {source.id === "github" && (
                <>
                  <label>
                    GitHub 只读 Token
                    <input
                      type="password"
                      autoComplete="off"
                      aria-label="GitHub 只读 Token"
                      value={githubKey}
                      onChange={(event) => setGithubKey(event.target.value)}
                      placeholder={
                        state.hasGithubToken
                          ? "已保存，输入新 Token 替换"
                          : "公开仓库可留空"
                      }
                    />
                  </label>
                  <p className="muted">
                    Token 经系统安全存储加密，不进入素材、日志或公开探索查询。
                  </p>
                  <div className="actions">
                    <button
                      className="primary"
                      disabled={controlsDisabled || !githubKey.trim()}
                      onClick={() =>
                        void run("保存 GitHub Token", async () => {
                          await command({
                            type: "sourceKey",
                            source: "github",
                            value: githubKey,
                          });
                          setGithubKey("");
                          await refresh();
                          setNotice("GitHub Token 已保存");
                        })
                      }
                    >
                      保存 Token
                    </button>
                    <button
                      disabled={controlsDisabled || !state.hasGithubToken}
                      onClick={() =>
                        void run("检查 GitHub 连接", async () => {
                          await command({
                            type: "checkSource",
                            source: "github",
                          });
                          setNotice(
                            "GitHub 身份验证通过；仓库权限在绑定时检查",
                          );
                        })
                      }
                    >
                      检查连接
                    </button>
                    <button
                      disabled={controlsDisabled || !state.hasGithubToken}
                      onClick={() => {
                        if (
                          confirm("清除 GitHub Token？私有仓库将无法更新分析。")
                        )
                          void run("清除 GitHub Token", async () => {
                            await command({
                              type: "sourceKey",
                              source: "github",
                              value: "",
                            });
                            setGithubKey("");
                            await refresh();
                            setNotice("GitHub Token 已清除");
                          });
                      }}
                    >
                      清除 Token
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
