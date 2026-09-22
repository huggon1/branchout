import { useEffect, useState } from "react";
import type { ModelReply, ModelView } from "../../shared/model-contracts";
import { bridge } from "../bridge";
import { Button } from "./Primitives";
export function ModelSettings() {
  const [view, setView] = useState<ModelView>();
  const [method, setMethod] = useState<"generic_api" | "codex_subscription">(
    "generic_api",
  );
  const [baseUrl, setBaseUrl] = useState("");
  const [api, setApi] = useState<"openai-responses" | "openai-completions">(
    "openai-responses",
  );
  const [modelId, setModelId] = useState("");
  const [codexModel, setCodexModel] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let initialized = false;
    let version = 0;
    const load = async () => {
      const revision = ++version;
      try {
        const result = await bridge.modelView();
        if (!active || revision !== version) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setView(result.value);
        if (!initialized) {
          initialized = true;
          const current = result.value.current;
          if (current) {
            setMethod(current.method);
            if (current.method === "generic_api") {
              setBaseUrl(current.baseUrl ?? "");
              setApi(current.api ?? "openai-responses");
              setModelId(current.modelId);
            } else setCodexModel(current.modelId);
          }
        }
      } catch {
        if (active) setError("无法读取模型连接");
      }
    };
    const unsubscribe = bridge.onChanged(() => void load());
    void load();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  async function action(operation: () => Promise<ModelReply<void>>) {
    setBusy(true);
    setError("");
    try {
      const result = await operation();
      if (!result.ok) setError(result.message);
    } catch {
      setError("操作未完成，请重试");
    } finally {
      setBusy(false);
    }
  }
  const savedKey =
    view?.current?.method === "generic_api" && view.current.hasCredential;
  const save = () =>
    action(async () => {
      if (method === "codex_subscription")
        return bridge.saveModel({ method, modelId: codexModel });
      const input = {
        method,
        baseUrl,
        api,
        modelId,
        ...(key ? { apiKey: key } : {}),
      };
      setKey("");
      return bridge.saveModel(input);
    });
  return (
    <section className="model-settings" aria-label="模型连接">
      <div className="setting-row">
        <div>
          <h2>模型连接</h2>
          <p>
            {view?.current
              ? `${view.current.method === "generic_api" ? "通用 API" : "Codex 订阅"} · ${view.current.modelId}`
              : "未配置"}
          </p>
        </div>
      </div>
      <div className="connection-method" role="group" aria-label="连接方式">
        {(["generic_api", "codex_subscription"] as const).map((value) => (
          <button
            key={value}
            aria-pressed={method === value}
            onClick={() => {
              setMethod(value);
              setKey("");
              setError("");
            }}
            disabled={busy}
          >
            {value === "generic_api" ? "通用 API" : "Codex 订阅账号"}
          </button>
        ))}
      </div>
      {method === "generic_api" ? (
        <div className="model-form">
          <label>
            服务地址
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <label>
            接口类型
            <select
              aria-label="接口类型"
              value={api}
              onChange={(event) => setApi(event.target.value as typeof api)}
              disabled={busy}
            >
              <option value="openai-responses">OpenAI Responses</option>
              <option value="openai-completions">
                OpenAI Chat Completions
              </option>
            </select>
          </label>
          <label>
            模型标识
            <input
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              placeholder="模型 ID"
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <label>
            API Key
            <input
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder={savedKey ? "已配置，留空保留" : "填写 API Key"}
              autoComplete="new-password"
              disabled={busy}
            />
          </label>
        </div>
      ) : (
        <div className="codex-form">
          <p>
            {view?.auth === "signed_in"
              ? `已登录${view.accountLabel ? ` · ${view.accountLabel}` : ""}`
              : view?.auth === "logging_in"
                ? "等待浏览器登录"
                : "尚未登录"}
          </p>
          <div className="inline-actions">
            {view?.auth === "signed_in" ? (
              <Button
                disabled={busy}
                onClick={() => void action(bridge.refreshModels)}
              >
                刷新模型
              </Button>
            ) : view?.auth === "logging_in" ? (
              <Button
                disabled={busy}
                onClick={() => void action(bridge.cancelModelLogin)}
              >
                取消登录
              </Button>
            ) : (
              <Button
                disabled={busy}
                onClick={() => void action(bridge.loginModel)}
              >
                登录 ChatGPT
              </Button>
            )}
          </div>
          {view?.auth === "signed_in" && (
            <label>
              模型
              <select
                aria-label="模型"
                value={codexModel}
                onChange={(event) => setCodexModel(event.target.value)}
                disabled={busy || view.catalog !== "ready"}
              >
                <option value="">选择模型</option>
                {codexModel &&
                  !view.models.some((model) => model.id === codexModel) && (
                    <option value={codexModel} disabled>
                      {codexModel} · 待刷新确认
                    </option>
                  )}
                {view.models.map((model) => (
                  <option
                    key={model.id}
                    value={model.id}
                    disabled={!model.compatible}
                  >
                    {model.name}
                    {model.compatible ? "" : " · 当前 Pi 不支持"}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      <div className="model-actions">
        <Button
          disabled={
            busy ||
            !view ||
            (method === "generic_api"
              ? !baseUrl || !modelId || (!key && !savedKey)
              : !codexModel || view.catalog !== "ready")
          }
          onClick={() => void save()}
        >
          保存连接
        </Button>
        <span>新连接将用于后续任务</span>
      </div>
      {error && (
        <p role="alert" className="model-error">
          {error}
        </p>
      )}
      <p className="connection-status" role="status">
        {view?.message}
      </p>
      {view?.current && (
        <div className="connection-check">
          <div>
            <h3>检查已保存的连接</h3>
            <p>发送固定短句，不含项目数据；可能产生模型费用或消耗订阅额度。</p>
          </div>
          <div className="inline-actions">
            {view.check === "running" ? (
              <Button
                onClick={() => void action(bridge.cancelModelCheck)}
                disabled={busy}
              >
                取消连接检查
              </Button>
            ) : (
              <Button
                onClick={() => void action(bridge.checkModel)}
                disabled={busy}
              >
                发送检查请求
              </Button>
            )}
            <span role="status">
              {
                {
                  idle: "尚未检查",
                  running: "检查中…",
                  passed: view.checkIsCurrent
                    ? "连接检查通过"
                    : "先前连接检查通过",
                  failed: "检查失败，请核对配置、权限或网络",
                  cancelled: "检查已取消",
                }[view.check]
              }
            </span>
            {view.checkModelId && <span>{view.checkModelId}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
