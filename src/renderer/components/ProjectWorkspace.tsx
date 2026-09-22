import { useEffect, useState } from "react";
import type { Direction, ProjectState } from "../../shared/project-contracts";
import { bridge } from "../bridge";
import { Button, EmptyState } from "./Primitives";
export function ProjectWorkspace({
  mode,
  selected,
  setSelected,
  direction,
  setDirection,
}: {
  mode: "项目" | "探索";
  selected: string;
  setSelected: (value: string) => void;
  direction: Direction;
  setDirection: (value: Direction) => void;
}) {
  const [state, setState] = useState<ProjectState>();
  const [editing, setEditing] = useState<{
    content: string;
    revision: number;
    projectId: string;
    direction: Direction;
  } | null>(null);
  const [regenerate, setRegenerate] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true,
      revision = 0;
    const load = async () => {
      const ticket = ++revision;
      try {
        const reply = await bridge.projects();
        if (alive && ticket === revision) {
          if (reply.ok) setState(reply.value);
          else setError(reply.message);
        }
      } catch {
        if (alive) setError("项目状态读取失败，请重新打开窗口");
      }
    };
    const off = bridge.onChanged(() => void load());
    void load();
    return () => {
      alive = false;
      off();
    };
  }, []);
  const project =
    state?.projects.find((item) => item.projectId === selected) ??
    state?.projects[0];
  const baseline = project?.baselines[direction];
  const tasks =
    state?.tasks.filter(
      (task) =>
        task.projectId === project?.projectId && task.direction === direction,
    ) ?? [];
  const active = tasks.find((task) =>
    ["queued", "running", "awaiting_user"].includes(task.state),
  );
  const latest = active ?? tasks.at(-1);
  const act = async (
    work: () => Promise<{ ok: boolean; message?: string }>,
  ) => {
    setBusy(true);
    setError("");
    try {
      const reply = await work();
      if (!reply.ok) setError(reply.message ?? "操作未完成");
      return reply.ok;
    } catch {
      setError("操作未完成，请重试");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const bind = () =>
    act(async () => {
      const reply = await bridge.bindProject();
      if (reply.ok && reply.value) {
        setSelected(reply.value);
        setEditing(null);
      }
      return reply;
    });
  const start = (kind: "baseline" | "exploration", replace: boolean) => {
    if (project)
      void act(() =>
        bridge.startProjectTask({
          projectId: project.projectId,
          direction,
          kind,
          regenerate: replace,
        }),
      );
  };
  return (
    <div className="project-workspace">
      <div className="project-toolbar">
        <label>
          当前项目
          <select
            aria-label="当前项目"
            value={project?.projectId ?? ""}
            disabled={!!editing || busy}
            onChange={(event) => {
              setSelected(event.target.value);
              setRegenerate(false);
              setError("");
            }}
          >
            <option value="" disabled>
              选择项目
            </option>
            {state?.projects.map((item) => (
              <option key={item.projectId} value={item.projectId}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <Button disabled={busy || !!editing} onClick={() => void bind()}>
          绑定仓库
        </Button>
      </div>
      {error && (
        <p role="alert" className="model-error">
          {error}
        </p>
      )}
      {!project ? (
        <EmptyState title="还没有项目">
          绑定本地 Git 仓库，建立独立的产品与 UI/UX 基线。
        </EmptyState>
      ) : (
        <>
          <p className="project-directory">{project.directory}</p>
          <div className="connection-method" role="group" aria-label="基线方向">
            {(["product", "uiux"] as const).map((value) => (
              <button
                key={value}
                disabled={!!editing}
                aria-pressed={direction === value}
                onClick={() => {
                  setDirection(value);
                  setRegenerate(false);
                  setError("");
                }}
              >
                {value === "product" ? "产品" : "UI/UX"}
                {mode === "项目" ? "基线" : "探索"}
              </button>
            ))}
          </div>
          <p className="model-disclosure">
            {mode === "项目"
              ? "生成会将安全选读的当前代码与文档发送到已配置模型，不运行仓库代码。"
              : "探索使用当前基线；缺少基线时会先将安全选读的代码与文档发送到当前模型生成基线，再继续探索。"}
            可能消耗额度或产生费用。
          </p>
          {mode === "探索" && (
            <section className="exploration-plan">
              <h2>GitHub 公开仓库方案</h2>
              <p>
                {direction === "product"
                  ? "基于产品能力与使用场景，多轮搜索、筛选并读取相关 README。"
                  : "基于信息架构与交互流程，多轮搜索、筛选并读取相关 README。"}
              </p>
              <p>
                搜索与 README 读取可用，无需 GitHub 登录；本方案只覆盖
                GitHub，不覆盖 X、小红书。
              </p>
              <p>
                {baseline
                  ? "已有基线，将直接复用。"
                  : "尚无此方向基线，启动后自动生成并继续。"}
              </p>
              {baseline && (
                <label className="regenerate-option">
                  <input
                    type="checkbox"
                    checked={regenerate}
                    disabled={busy || !!active}
                    onChange={(event) => setRegenerate(event.target.checked)}
                  />
                  重新生成基线，确认替换后再探索
                </label>
              )}
              <Button
                disabled={busy || !!active}
                onClick={() => start("exploration", regenerate)}
              >
                开始探索
              </Button>
            </section>
          )}
          {latest && (
            <section className="project-task" aria-live="polite">
              <h2>
                {latest.kind === "baseline" ? "基线生成" : "探索任务"} ·{" "}
                {latest.phase}
              </h2>
              {latest.kind === "exploration" && (
                <p>
                  候选 {latest.progress.found} · 已读取 {latest.progress.read} ·
                  已入库 {latest.progress.saved} · 失败 {latest.progress.failed}
                </p>
              )}
              {latest.kind === "exploration" && (
                <p>
                  GitHub：
                  {latest.coverage.phase === "pending"
                    ? "尚未搜索"
                    : latest.coverage.phase === "searching"
                      ? "搜索中"
                      : (
                          {
                            results: "已找到候选",
                            no_results: "已搜索，无结果",
                            not_covered: "未覆盖",
                            failed: "搜索失败",
                          } as const
                        )[latest.coverage.outcome ?? "not_covered"]}
                  {latest.coverage.message
                    ? ` · ${latest.coverage.message}`
                    : ""}
                </p>
              )}
              {latest.message && <p>{latest.message}</p>}
              {["queued", "running"].includes(latest.state) && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act(() => bridge.cancelProjectTask(latest.taskId))
                  }
                >
                  取消任务
                </Button>
              )}
              {latest.state === "failed" && (
                <p>
                  任务未完成，已保存内容保留。检查仓库、模型与网络后可重新启动。
                </p>
              )}
            </section>
          )}
          {active?.state === "awaiting_user" && active.preview && (
            <section className="baseline-preview">
              <h2>新结果预览 · 尚未替换</h2>
              <div className="baseline-actions">
                <Button
                  disabled={
                    busy ||
                    (baseline?.revision ?? 0) !== active.expectedRevision
                  }
                  onClick={() =>
                    void act(() => bridge.confirmBaseline(active.taskId))
                  }
                >
                  {active.kind === "exploration"
                    ? "替换并继续探索"
                    : "替换基线"}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act(() => bridge.cancelProjectTask(active.taskId))
                  }
                >
                  取消预览
                </Button>
              </div>
              <p>{active.preview.readingNote}</p>
              <div className="document-text">{active.preview.content}</div>
            </section>
          )}
          {mode === "项目" && (
            <section className="baseline-document">
              <div className="baseline-heading">
                <h2>
                  {direction === "product" ? "产品基线" : "UI/UX 基线"} ·{" "}
                  {baseline ? "已保存" : "未填写"}
                </h2>
                {!editing && (
                  <div className="inline-actions">
                    <Button
                      disabled={busy}
                      onClick={() =>
                        setEditing({
                          content: baseline?.content ?? "",
                          revision: baseline?.revision ?? 0,
                          projectId: project.projectId,
                          direction,
                        })
                      }
                    >
                      {baseline ? "编辑" : "自行填写"}
                    </Button>
                    <Button
                      disabled={busy || !!active}
                      onClick={() => start("baseline", !!baseline)}
                    >
                      {baseline ? "重新生成" : "生成基线"}
                    </Button>
                  </div>
                )}
              </div>
              {editing ? (
                <>
                  <div className="baseline-actions">
                    <Button
                      disabled={busy || !editing.content.trim()}
                      onClick={() =>
                        void act(() =>
                          bridge.editBaseline({
                            projectId: editing.projectId,
                            direction: editing.direction,
                            content: editing.content,
                            expectedRevision: editing.revision,
                          }),
                        ).then((ok) => {
                          if (ok) setEditing(null);
                        })
                      }
                    >
                      保存基线
                    </Button>
                    <Button disabled={busy} onClick={() => setEditing(null)}>
                      取消编辑
                    </Button>
                  </div>
                  <textarea
                    aria-label="基线正文"
                    className="baseline-editor"
                    value={editing.content}
                    onChange={(event) =>
                      setEditing({ ...editing, content: event.target.value })
                    }
                    rows={14}
                  />
                </>
              ) : baseline ? (
                <>
                  <p>
                    {baseline.origin === "manual"
                      ? "手动编辑"
                      : baseline.readingNote}{" "}
                    · {new Date(baseline.updatedAt).toLocaleString()}
                  </p>
                  <div className="document-text">{baseline.content}</div>
                </>
              ) : (
                <p>可以一键生成，也可以完全自行填写。</p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
