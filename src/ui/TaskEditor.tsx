import React, { useEffect, useState } from "react";
import {
  DEFAULT_COLLECTION_BUDGET,
  type Task,
  type TaskInput,
} from "../core/contracts.js";
const platforms = { github: "GitHub", xiaohongshu: "小红书", x: "X" };
const draft = (t: Task): TaskInput => ({
  name: t.name,
  description: t.description,
  collectionMode: t.collectionMode ?? "keyword",
  budget: t.budget,
  sources: t.sources,
  schedule: t.schedule,
  time: t.time,
  paused: t.paused,
});
export function TaskEditor({
  task,
  save,
  run,
  remove,
  onDirty,
}: {
  task: Task;
  save: (t: TaskInput) => Promise<Task | undefined>;
  run: (id: string) => Promise<unknown>;
  remove: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [d, set] = useState<TaskInput>(() => draft(task));
  const [busy, setBusy] = useState(false);
  const dirty = !task.id || JSON.stringify(d) !== JSON.stringify(draft(task));
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    set(draft(task));
  }, [task]);
  const intent = d.collectionMode === "intent";
  const budget = d.budget ?? DEFAULT_COLLECTION_BUDGET;
  const changeSource = (
    index: number,
    value: Partial<TaskInput["sources"][number]>,
  ) =>
    set({
      ...d,
      sources: d.sources.map((s, i) => (i === index ? { ...s, ...value } : s)),
    });
  return (
    <form
      className="panel editor"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const shouldRun =
          (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
          "run";
        setBusy(true);
        try {
          const saved = await save(d);
          if (saved) {
            onDirty(false);
            if (shouldRun) await run(saved.id);
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="editor-heading">
        <div>
          <h2>{task.id ? "编辑任务" : "新建收集任务"}</h2>
          <p className="muted">
            告诉 Feedloom 你想找到什么，再选择发现它的地方。
          </p>
        </div>
        <span className={`status ${dirty ? "partial" : "success"}`}>
          {dirty ? "未保存" : "已保存"}
        </span>
      </div>
      <label>
        任务名称
        <input
          required
          maxLength={80}
          value={d.name}
          onChange={(e) => set({ ...d, name: e.target.value })}
          placeholder="例如：改善 PEAK 游戏体验的模组"
        />
      </label>
      <label>
        关注描述
        <textarea
          rows={3}
          maxLength={500}
          value={d.description}
          onChange={(e) => set({ ...d, description: e.target.value })}
          placeholder="想找到什么？关注哪些场景？哪些内容不需要？"
        />
      </label>
      <label>
        收集方式
        <select
          aria-label="收集方式"
          value={d.collectionMode ?? "keyword"}
          onChange={(e) =>
            set({
              ...d,
              collectionMode: e.target.value as "intent" | "keyword",
            })
          }
        >
          <option value="intent">按意图探索 · AI 规划与筛选</option>
          <option value="keyword">固定关键词 · 单次检索</option>
        </select>
      </label>
      <div className="mode-note">
        <strong>
          {intent ? "围绕你的关注方向寻找信息" : "使用已保存的关键词和规则"}
        </strong>
        <p>
          {intent
            ? "AI 理解意图、规划查询，分析候选后按需补搜。收录理由和原文依据保存在收集记录中；模型调用使用连接与模型中的设置。"
            : "关键词模式不会扩词或判断相关性。切换为「按意图探索」后，关注描述将参与规划与筛选。"}
        </p>
      </div>
      <div className="platformchoices">
        {(["github", "xiaohongshu", "x"] as const).map((p) => (
          <label key={p}>
            <input
              type="checkbox"
              checked={d.sources.some((c) => c.platform === p)}
              onChange={(e) =>
                set({
                  ...d,
                  sources: e.target.checked
                    ? [
                        ...d.sources,
                        {
                          platform: p,
                          keyword: "",
                          searchMode: p === "github" ? "search" : undefined,
                          period: "daily",
                          limit: 10,
                          thresholds: {},
                        },
                      ]
                    : d.sources.filter((c) => c.platform !== p),
                })
              }
            />
            {platforms[p]}
          </label>
        ))}
      </div>
      {!d.sources.length && <p className="warning">至少选择一个来源平台。</p>}
      {d.sources.map((c, i) => {
        const trending = c.platform === "github" && c.searchMode !== "search";
        const metric = c.platform === "github" ? "stars" : "likes";
        return (
          <fieldset key={c.platform}>
            <legend>{platforms[c.platform]}</legend>
            {c.platform === "github" && (
              <label>
                GitHub 收集入口
                <select
                  aria-label="GitHub 收集入口"
                  value={c.searchMode ?? "trending"}
                  onChange={(e) =>
                    changeSource(i, {
                      searchMode: e.target.value as "trending" | "search",
                    })
                  }
                >
                  <option value="search">仓库搜索 · 按方向发现项目</option>
                  <option value="trending">Trending · 浏览热门榜单</option>
                </select>
              </label>
            )}
            {trending ? (
              <p className="muted">
                Trending 从榜单获取候选。
                {intent
                  ? "AI 根据关注方向筛选榜单中的项目。"
                  : "不会按任务名称或描述筛选。"}
              </p>
            ) : (
              <label>
                {intent ? "起始搜索词（选填）" : "搜索词"}
                <input
                  required={!intent}
                  maxLength={200}
                  value={c.keyword}
                  placeholder={
                    intent
                      ? "留空由 AI 规划，也可以提供关键词或别名"
                      : "输入平台搜索词"
                  }
                  onChange={(e) => changeSource(i, { keyword: e.target.value })}
                />
              </label>
            )}
            <div className="formrow">
              <label>
                {trending ? "榜单周期" : "时间范围"}
                <select
                  value={c.period}
                  onChange={(e) =>
                    changeSource(i, {
                      period: e.target.value as "daily" | "weekly" | "monthly",
                    })
                  }
                >
                  <option value="daily">{trending ? "日榜" : "一天内"}</option>
                  <option value="weekly">{trending ? "周榜" : "一周内"}</option>
                  {c.platform !== "xiaohongshu" && (
                    <option value="monthly">
                      {trending ? "月榜" : "近 30 天"}
                    </option>
                  )}
                </select>
              </label>
              <label>
                每平台最多入库
                <input
                  required
                  type="number"
                  min={1}
                  max={100}
                  value={c.limit}
                  onChange={(e) =>
                    changeSource(i, { limit: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                {c.platform === "github" ? "Stars" : "点赞"}至少
                <input
                  type="number"
                  min={0}
                  value={c.thresholds[metric] ?? ""}
                  placeholder="不限制"
                  onChange={(e) => {
                    const thresholds = { ...c.thresholds };
                    if (e.target.value === "") delete thresholds[metric];
                    else thresholds[metric] = Number(e.target.value);
                    changeSource(i, { thresholds });
                  }}
                />
              </label>
            </div>
          </fieldset>
        );
      })}
      {intent && (
        <details className="budget">
          <summary>
            探索预算{" "}
            <span>
              最多 {budget.maxRounds} 轮 · {budget.maxQueries} 次查询 ·{" "}
              {budget.maxDurationSeconds} 秒
            </span>
          </summary>
          <p className="muted">
            达到任一上限就停止，保留已收录素材。查询、候选、模型调用和时长由所有平台共享；轮数按每个平台限制。
          </p>
          <div className="formrow">
            {(
              [
                ["maxRounds", "每平台轮数", 1, 5],
                ["maxQueries", "总查询数", 1, 30],
                ["maxCandidates", "总候选数", 1, 150],
                ["maxModelCalls", "模型调用数", 1, 40],
                ["maxDurationSeconds", "总时长（秒）", 15, 900],
              ] as const
            ).map(([field, label, min, max]) => (
              <label key={field}>
                {label}
                <input
                  required
                  type="number"
                  min={min}
                  max={max}
                  value={budget[field]}
                  onChange={(e) =>
                    set({
                      ...d,
                      budget: { ...budget, [field]: Number(e.target.value) },
                    })
                  }
                />
              </label>
            ))}
          </div>
        </details>
      )}
      <div className="formrow">
        <label>
          执行频率
          <select
            value={d.schedule}
            onChange={(e) =>
              set({ ...d, schedule: e.target.value as TaskInput["schedule"] })
            }
          >
            <option value="manual">仅手动</option>
            <option value="hourly">每小时</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
          </select>
        </label>
        <label>
          本机时间
          <input
            type="time"
            disabled={d.schedule === "manual" || d.schedule === "hourly"}
            value={d.time}
            onChange={(e) => set({ ...d, time: e.target.value })}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={d.paused}
            onChange={(e) => set({ ...d, paused: e.target.checked })}
          />
          暂停定时收集
        </label>
      </div>
      <div className="actions editor-actions">
        <button className="primary" disabled={busy || !d.sources.length}>
          保存任务
        </button>
        <button type="submit" value="run" disabled={busy || !d.sources.length}>
          {busy ? "正在提交…" : dirty ? "保存并立即执行" : "立即执行"}
        </button>
        {task.id && (
          <button
            type="button"
            className="quiet push"
            disabled={busy}
            onClick={remove}
          >
            删除任务
          </button>
        )}
      </div>
    </form>
  );
}
