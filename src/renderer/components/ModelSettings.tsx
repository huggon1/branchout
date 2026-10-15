import { t } from "../i18n";
import { useEffect, useState } from "react";
import {
  defaultPiOptions,
  type ModelReply,
  type ModelView,
  type PiOptions,
  type ThinkingChoice,
} from "../../shared/model-contracts";
import { failureMessages } from "../../shared/task-failure";
import { bridge } from "../bridge";
import { Button, Dialog } from "./Primitives";

const customTemplate = JSON.stringify(
  {
    providers: {
      "my-provider": {
        name: "My provider",
        baseUrl: "https://api.example.com/v1",
        api: "openai-completions",
        models: [
          {
            id: "my-model",
            name: "My model",
            reasoning: false,
            input: ["text"],
            contextWindow: 32768,
            maxTokens: 8192,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  },
  null,
  2,
);

export function ModelSettings() {
  const [view, setView] = useState<ModelView>();
  const [catalogSource, setCatalogSource] = useState<"builtin" | "custom">(
    "builtin",
  );
  const [creating, setCreating] = useState(false);
  const [modelId, setModelId] = useState("");
  const [name, setName] = useState("");
  const [options, setOptions] = useState<PiOptions>(defaultPiOptions);
  const [apiJson, setApiJson] = useState("{}");
  const [answer, setAnswer] = useState("");
  const [customJson, setCustomJson] = useState(customTemplate);
  const [customProvider, setCustomProvider] = useState("my-provider");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string>();
  useEffect(() => {
    let active = true,
      version = 0;
    const load = async () => {
      const revision = ++version;
      try {
        const result = await bridge.modelView();
        if (!active || revision !== version) return;
        if (result.ok) setView(result.value);
        else setError(result.message);
      } catch {
        if (active) setError(t("无法读取模型连接"));
      }
    };
    const unsubscribe = bridge.onChanged(() => void load());
    void load();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  function restoreSelection(selection: NonNullable<ModelView["selected"]>) {
    setCatalogSource(selection.catalogSource);
    setCreating(false);
    setModelId(selection.modelId ?? "");
    setName(selection.name);
    setOptions(selection.options);
    setApiJson(JSON.stringify(selection.options.apiOptions, null, 2));
  }
  useEffect(() => {
    if (view?.selected) restoreSelection(view.selected);
  }, [view?.selected?.id]);
  useEffect(() => {
    setAnswer("");
  }, [view?.authPrompt?.id]);
  async function action(operation: () => Promise<ModelReply<void>>) {
    setBusy(true);
    setError("");
    try {
      const result = await operation();
      if (!result.ok) setError(result.message);
    } catch {
      setError(t("操作未完成，请重试"));
    } finally {
      setBusy(false);
    }
  }
  const selected =
    !creating && view?.selected?.catalogSource === catalogSource
      ? view.selected
      : undefined;
  const newConnection = (source = catalogSource) => {
    setCatalogSource(source);
    setCreating(true);
    setError("");
  };
  const provider = view?.providers.find((p) => p.id === selected?.providerId);
  const model = view?.models.find((m) => m.id === modelId);
  let advanced = false;
  try {
    advanced = Object.keys(JSON.parse(apiJson)).length > 0;
  } catch {
    advanced = true;
  }
  const update = <K extends keyof PiOptions>(key: K, value: PiOptions[K]) =>
    setOptions((current) => ({ ...current, [key]: value }));
  const save = () => {
    if (!selected) return;
    let apiOptions: PiOptions["apiOptions"];
    try {
      apiOptions = JSON.parse(apiJson);
      if (
        !apiOptions ||
        Array.isArray(apiOptions) ||
        typeof apiOptions !== "object"
      )
        throw new Error();
    } catch {
      setError(t("请填写有效的 JSON 对象"));
      return;
    }
    void action(() =>
      bridge.saveModel({
        method: "pi",
        connectionId: selected.id,
        modelId,
        name,
        options: { ...options, apiOptions },
      }),
    );
  };
  const prompt = view?.authPrompt;
  const status = view
    ? {
        idle: t("尚未检查"),
        running: t("检查中…"),
        passed: view.checkIsCurrent ? t("连接检查通过") : t("先前连接检查通过"),
        failed: view.checkFailure
          ? t(failureMessages[view.checkFailure])
          : t("模型检查失败，请重试。"),
        cancelled: t("检查已取消"),
      }[view.check]
    : "";
  return (
    <section className="model-settings" aria-label={t("模型连接")}>
      <div className="setting-row">
        <div>
          <h2>{t("模型连接")}</h2>
          <p>
            {view?.current
              ? `${view.current.name} · ${view.current.modelId}`
              : t("未配置")}
          </p>
        </div>
      </div>
      <div className="model-form model-saved">
        <label>
          {t("已保存的连接")}
          <select
            value={
              view?.connections.some((c) => c.id === selected?.id)
                ? selected!.id
                : ""
            }
            disabled={busy || view?.auth === "logging_in"}
            onChange={(e) => {
              const connection = view?.connections.find(
                (c) => c.id === e.target.value,
              );
              if (connection && connection.id === view?.selected?.id) {
                restoreSelection(view.selected);
              } else if (connection)
                void action(() =>
                  bridge.selectModelConnection({
                    connectionId: connection.id,
                    providerId: connection.providerId,
                  }),
                );
            }}
          >
            <option value="" disabled>
              {t("请选择")}
            </option>
            {view?.connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.modelId}
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={busy || view?.auth === "logging_in"}
          onClick={() => newConnection()}
        >
          {t("新建连接")}
        </Button>
      </div>
      <div
        className="connection-method"
        role="group"
        aria-label={t("连接方式")}
      >
        {(["builtin", "custom"] as const).map((source) => (
          <button
            key={source}
            type="button"
            aria-pressed={catalogSource === source}
            disabled={busy || view?.auth === "logging_in"}
            onClick={() => {
              if (source !== catalogSource) newConnection(source);
            }}
          >
            {source === "builtin" ? t("内置供应商") : t("自定义供应商")}
          </button>
        ))}
      </div>
      {catalogSource === "custom" && !selected && (
        <div className="model-custom">
          <p>{t("载入 models.json 后完成认证并保存连接。")}</p>
          <div className="model-form">
            <label>
              {t("供应商 ID")}
              <input
                value={customProvider}
                onChange={(e) => setCustomProvider(e.target.value)}
              />
            </label>
            <label>
              Pi models.json
              <textarea
                aria-label="Pi models.json"
                className="model-json"
                rows={12}
                spellCheck={false}
                value={customJson}
                onChange={(e) => setCustomJson(e.target.value)}
              />
            </label>
            <Button
              disabled={busy || view?.auth === "logging_in"}
              onClick={() =>
                void action(() =>
                  bridge.configureModelCatalog({
                    providerId: customProvider,
                    modelsJson: customJson,
                  }),
                )
              }
            >
              {t("载入 Pi 目录")}
            </Button>
          </div>
        </div>
      )}
      <div className="model-form">
        {catalogSource === "builtin" ? (
          <label>
            {t("供应商")}
            <select
              value={selected?.providerId ?? ""}
              disabled={busy || view?.auth === "logging_in"}
              onChange={(e) => {
                if (e.target.value)
                  void action(() =>
                    bridge.selectModelConnection({
                      providerId: e.target.value,
                    }),
                  );
              }}
            >
              <option value="">{t("选择 Pi 供应商")}</option>
              {view?.providers
                .filter((p) => p.builtin)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.modelCount})
                  </option>
                ))}
            </select>
          </label>
        ) : selected ? (
          <label>
            {t("供应商")}
            <input readOnly value={provider?.name ?? selected.providerId} />
          </label>
        ) : null}
        {selected && (
          <>
            <div className="model-actions">
              {view?.auth === "logging_in" ? (
                <Button
                  disabled={busy}
                  onClick={() => void action(bridge.cancelModelLogin)}
                >
                  {t("取消登录")}
                </Button>
              ) : (
                provider?.authMethods.map((method) => (
                  <Button
                    key={method.type}
                    disabled={busy}
                    onClick={() =>
                      void action(() =>
                        bridge.loginModel({ authType: method.type }),
                      )
                    }
                  >
                    {method.name}
                  </Button>
                ))
              )}
              <span role="status">
                {view?.auth === "signed_in"
                  ? t("认证已配置")
                  : view?.auth === "logging_in"
                    ? t("认证中…")
                    : t("请完成认证")}
                {view?.authSource ? ` · ${view.authSource}` : ""}
              </span>
            </div>
            {view?.authEvents.map((event, i) => (
              <div className="connection-status" key={i}>
                {event.type === "auth_url" ? (
                  <>
                    <p>{event.instructions}</p>
                    <Button
                      onClick={() =>
                        void action(() => bridge.openModelAuthUrl(event.url))
                      }
                    >
                      {t("打开认证页面")}
                    </Button>
                  </>
                ) : event.type === "device_code" ? (
                  <>
                    <p>
                      {t("在认证页面输入此代码")}{" "}
                      <strong>{event.userCode}</strong>
                    </p>
                    <Button
                      onClick={() =>
                        void action(() =>
                          bridge.openModelAuthUrl(event.verificationUri),
                        )
                      }
                    >
                      {t("打开认证页面")}
                    </Button>
                  </>
                ) : (
                  <>
                    <p>{event.message}</p>
                    {event.links?.map((link) => (
                      <Button
                        key={link.url}
                        onClick={() =>
                          void action(() => bridge.openModelAuthUrl(link.url))
                        }
                      >
                        {link.label ?? t("打开认证页面")}
                      </Button>
                    ))}
                  </>
                )}
              </div>
            ))}
            {prompt && (
              <form
                className="model-auth-prompt"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = answer;
                  setAnswer("");
                  void action(() =>
                    bridge.respondModelAuth({ id: prompt.id, value }),
                  );
                }}
              >
                <label>
                  {prompt.message}
                  {prompt.type === "select" ? (
                    <select
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      autoFocus
                    >
                      <option value="">{t("请选择")}</option>
                      {prompt.options?.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                          {o.description ? ` · ${o.description}` : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={prompt.type === "secret" ? "password" : "text"}
                      value={answer}
                      placeholder={prompt.placeholder}
                      autoComplete="off"
                      autoFocus
                      onChange={(e) => setAnswer(e.target.value)}
                    />
                  )}
                </label>
                <Button
                  disabled={busy || (prompt.type === "select" && !answer)}
                  type="submit"
                >
                  {t("继续认证")}
                </Button>
              </form>
            )}
            <label>
              {t("连接名称")}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
              />
            </label>
            <label>
              {t("模型")}
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                disabled={busy}
              >
                <option value="">{t("选择 Pi 模型")}</option>
                {modelId && !model && (
                  <option value={modelId} disabled>
                    {modelId} · {t("目录已变化")}
                  </option>
                )}
                {view?.models.map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.compatible}>
                    {m.name} · {m.id}
                    {m.compatible ? "" : ` · ${t("当前认证下未提供")}`}
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={busy || view?.auth === "logging_in"}
              onClick={() => void action(bridge.refreshModels)}
            >
              {t("刷新 Pi 目录")}
            </Button>
            <fieldset className="model-options" disabled={busy}>
              <legend>{t("任务参数")}</legend>
              {(["browser", "reading"] as const).map((role) => {
                const key =
                  role === "browser" ? "browserThinking" : "readingThinking";
                const preferred =
                  role === "browser" && model?.thinkingLevels.includes("medium")
                    ? "medium"
                    : model?.thinkingLevels.includes("off")
                      ? "off"
                      : model?.thinkingLevels[0];
                return (
                  <label key={role}>
                    {role === "browser"
                      ? t("Reasoning（浏览任务）")
                      : t("Reasoning（阅读任务）")}
                    <select
                      value={options[key]}
                      disabled={!model || advanced}
                      onChange={(e) =>
                        update(key, e.target.value as ThinkingChoice)
                      }
                    >
                      <option value="task_default">
                        {t("任务默认")}
                        {preferred ? ` · ${preferred}` : ""}
                      </option>
                      {options[key] !== "task_default" &&
                        !model?.thinkingLevels.includes(options[key]) && (
                          <option value={options[key]} disabled>
                            {options[key]} · {t("目录已变化")}
                          </option>
                        )}
                      {model?.thinkingLevels.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
              <div className="model-option-grid">
                <label>
                  {t("Temperature（留空沿用 Pi）")}
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={options.temperature ?? ""}
                    onChange={(e) =>
                      update(
                        "temperature",
                        e.target.value === ""
                          ? undefined
                          : Number(e.target.value),
                      )
                    }
                  />
                </label>
                <label>
                  {t("最大输出 token（留空沿用任务）")}
                  <input
                    type="number"
                    min="1"
                    value={options.maxTokens ?? ""}
                    onChange={(e) =>
                      update(
                        "maxTokens",
                        e.target.value === ""
                          ? undefined
                          : Number(e.target.value),
                      )
                    }
                  />
                </label>
                <label>
                  {t("传输方式")}
                  <select
                    value={options.transport}
                    onChange={(e) =>
                      update(
                        "transport",
                        e.target.value as PiOptions["transport"],
                      )
                    }
                  >
                    {["auto", "sse", "websocket", "websocket-cached"].map(
                      (v) => (
                        <option key={v}>{v}</option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  {t("缓存偏好")}
                  <select
                    value={options.cacheRetention}
                    onChange={(e) =>
                      update(
                        "cacheRetention",
                        e.target.value as PiOptions["cacheRetention"],
                      )
                    }
                  >
                    {["none", "short", "long"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
              </div>
              <details>
                <summary>{t("高级 Pi API 参数")}</summary>
                <p>
                  {t("填写原生 API 选项 JSON；填写后由 JSON 控制 reasoning。")}
                </p>
                <label>
                  {t("Pi API options JSON")}
                  <textarea
                    aria-label={t("Pi API options JSON")}
                    className="model-json"
                    rows={8}
                    spellCheck={false}
                    value={apiJson}
                    onChange={(e) => setApiJson(e.target.value)}
                  />
                </label>
              </details>
            </fieldset>
            <div className="model-actions">
              <Button
                disabled={
                  busy ||
                  !model?.compatible ||
                  !name.trim() ||
                  view?.auth !== "signed_in"
                }
                onClick={save}
              >
                {t("保存连接")}
              </Button>
            </div>
            {view?.connections.some(
              (connection) => connection.id === selected.id,
            ) && (
              <div className="model-actions">
                <Button
                  disabled={busy || view?.auth === "logging_in"}
                  onClick={() => setRemoving(selected.id)}
                >
                  {t("移除连接")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="model-error">
          {t(error)}
        </p>
      )}
      <p className="connection-status" role="status">
        {selected ? t(view?.message ?? "") : ""}
      </p>
      {view?.current && (
        <div className="connection-check">
          <div>
            <h3>{t("检查已保存的连接")}</h3>
            <p>
              {t(
                "发送固定短句，不含项目数据；可能产生模型费用或消耗订阅额度。",
              )}
            </p>
          </div>
          <div className="inline-actions">
            <Button
              disabled={busy}
              onClick={() =>
                void action(
                  view.check === "running"
                    ? bridge.cancelModelCheck
                    : bridge.checkModel,
                )
              }
            >
              {view.check === "running" ? t("取消连接检查") : t("发送检查请求")}
            </Button>
            <span role="status">{status}</span>
            {view.checkModelId && <span>{view.checkModelId}</span>}
          </div>
        </div>
      )}
      {removing && (
        <Dialog
          title={t("移除模型连接")}
          onClose={() => setRemoving(undefined)}
        >
          <p>
            {t(
              "该连接将从列表移除。运行中的任务沿用当前连接，任务结束后清理本地凭据。供应商账号中的授权可在对应账号页面管理。",
            )}
          </p>
          <div className="dialog-actions">
            <Button onClick={() => setRemoving(undefined)}>
              {t("保留连接")}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                const connectionId = removing;
                setRemoving(undefined);
                void action(() =>
                  bridge.removeModelConnection({ connectionId }),
                );
              }}
            >
              {t("确认移除")}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
