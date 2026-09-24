import { useEffect, useState } from "react";
import type { Direction } from "../shared/project-contracts";
import type { AppSnapshot } from "../shared/domain";
import { bridge } from "./bridge";
import { ProjectWorkspace } from "./components/ProjectWorkspace";
import { Materials } from "./components/Materials";
import { ModelSettings } from "./components/ModelSettings";
import { XSettings } from "./components/XSettings";
import {
  Brand,
  Button,
  EmptyState,
  NavigationIcon,
} from "./components/Primitives";
const pages = ["素材", "探索", "项目", "设置"] as const;
export function App() {
  const [page, setPage] = useState<(typeof pages)[number]>("素材");
  const [projectId, setProjectId] = useState("");
  const [direction, setDirection] = useState<Direction>("product");
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
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        <section
          className={`content ${page === "素材" ? "materials-content" : ""}`}
        >
          {page === "素材" && <Materials />}
          {(page === "项目" || page === "探索") && (
            <ProjectWorkspace
              mode={page}
              selected={projectId}
              setSelected={setProjectId}
              direction={direction}
              setDirection={setDirection}
            />
          )}
          {page === "设置" && (
            <div className="settings">
              <ModelSettings />
              <section className="setting-row">
                <div>
                  <h2>转发渠道</h2>
                  <p>飞书、Telegram 尚未接入</p>
                </div>
              </section>
              <XSettings />
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
