import { useEffect, useState } from "react";
import type { AppSnapshot } from "../shared/domain";
import { bridge } from "./bridge";
import {
  Brand,
  Button,
  EmptyState,
  NavigationIcon,
} from "./components/Primitives";
const pages = ["素材", "探索", "项目", "设置"] as const;
export function App() {
  const [page, setPage] = useState<(typeof pages)[number]>("素材");
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const load = async () => {
      const current = ++revision;
      try {
        const state = await bridge.snapshot();
        if (active && current === revision) setSnapshot(state);
      } catch {
        if (active) setError("无法读取应用状态，请重新打开窗口。");
      }
    };
    const unsubscribe = bridge.onChanged(() => void load());
    void load();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const latest = snapshot?.tasks.at(-1);
  const running =
    busy || latest?.state === "running" || latest?.state === "queued";
  const check = async () => {
    setBusy(true);
    setError("");
    try {
      await bridge.runCheck();
    } catch {
      setError("基础检查未能启动，请重试。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="shell">
      <aside>
        <Brand />
        <nav aria-label="主导航">
          {pages.map((name) => (
            <button
              key={name}
              aria-current={page === name ? "page" : undefined}
              onClick={() => setPage(name)}
            >
              <NavigationIcon name={name} />
              {name}
            </button>
          ))}
        </nav>
        <span className="foundation-label">基础版本</span>
      </aside>
      <main>
        <header>
          <h1>{page}</h1>
          {page === "素材" && <Button disabled>添加链接</Button>}
          {page === "项目" && <Button disabled>添加项目</Button>}
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        <section className="content">
          {page === "素材" && (
            <>
              <div className="toolbar">
                <input aria-label="搜索素材" placeholder="搜索素材" disabled />
                <Button disabled>筛选</Button>
                <Button disabled>开始阅读</Button>
              </div>
              <EmptyState title="还没有素材">
                链接获取与内容理解尚未接入。
              </EmptyState>
            </>
          )}
          {page === "探索" && (
            <EmptyState title="探索尚未开放">
              项目基线与探索方案将在后续阶段接入。
            </EmptyState>
          )}
          {page === "项目" && (
            <EmptyState title="还没有项目">
              本机项目与两类基线尚未接入。
            </EmptyState>
          )}
          {page === "设置" && (
            <div className="settings">
              <section className="setting-row">
                <div>
                  <h2>模型连接</h2>
                  <p>尚未接入通用 API 或 Codex 订阅账号</p>
                </div>
                <span className="badge">未配置</span>
              </section>
              <section className="setting-row">
                <div>
                  <h2>转发渠道与内容平台</h2>
                  <p>尚未接入</p>
                </div>
              </section>
              <section className="diagnostics">
                <div className="setting-row">
                  <div>
                    <h2>基础运行检查</h2>
                    <p>仅检查后台进程、消息传递与本地保存，不调用 AI。</p>
                  </div>
                  <Button
                    onClick={() => void check()}
                    disabled={!snapshot || running}
                  >
                    {running ? "检查中…" : "运行检查"}
                  </Button>
                </div>
                <div aria-live="polite">
                  {latest && (
                    <>
                      <p>
                        {latest.phase} · {latest.progress}/2
                      </p>
                      <ul>
                        {snapshot?.results
                          .filter((result) => result.taskId === latest.taskId)
                          .map((result) => (
                            <li key={result.resultId}>{result.label}</li>
                          ))}
                      </ul>
                      {running && (
                        <Button
                          onClick={() => {
                            void bridge
                              .cancel(latest.taskId)
                              .catch(() => setError("取消失败，请重试。"));
                          }}
                        >
                          取消检查
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </section>
            </div>
          )}
        </section>
        <footer>
          <span>本地工作区</span>
          <span>{snapshot ? "本地状态已读取" : "正在读取本地状态…"}</span>
        </footer>
      </main>
    </div>
  );
}
