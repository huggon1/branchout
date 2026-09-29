// Fictional fixtures for design review. All changes stay in this browser.
const $ = (s, root = document) => root.querySelector(s);
const icon = (name) => `<i class="ph ph-${name}" aria-hidden="true"></i>`;
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const button = (label, action, cls = "", symbol = "") =>
  `<button class="button ${cls}" data-action="${action}">${symbol ? icon(symbol) : ""}${label}</button>`;
const projects = [
  {
    id: "branchout",
    name: "Branchout",
    glyph: "B",
    path: "~/Projects/branchout",
    description: "把外部内容与正在构建的项目联系起来。",
  },
  {
    id: "papertrail",
    name: "Papertrail",
    glyph: "P",
    path: "~/Projects/papertrail",
    description: "面向小团队的文档阅读与审阅工具。",
  },
  {
    id: "daylight",
    name: "Daylight",
    glyph: "D",
    path: "~/Projects/daylight",
    description: "帮助独立开发者安排每天的专注时间。",
  },
];
const initialCards = [
  {
    id: 1,
    project: "branchout",
    title: "长任务中的可见性与信任",
    text: "Branchout 会在后台阅读仓库和工作对话。我关注如何让用户理解当前动作、检查依据，并在失败后知道哪些结果仍然有效。",
    active: true,
    version: 3,
  },
  {
    id: 2,
    project: "branchout",
    title: "内容与项目的关联质量",
    text: "关注外部内容如何回应项目中的具体问题。关联需要说明可借鉴的做法、适用条件和来源依据，让用户能够判断是否值得进一步研究。",
    active: true,
    version: 2,
  },
  {
    id: 3,
    project: "branchout",
    title: "跨来源的阅读体验",
    text: "关注 GitHub、短帖和图文笔记的阅读差异，以及如何在统一阅读界面中保留各自的信息结构。",
    active: false,
    version: 1,
  },
  {
    id: 4,
    project: "papertrail",
    title: "让证据留在结论附近",
    text: "Papertrail 用于团队审阅长文档。我关注结论、引用和原文定位之间的交互，让读者在核对依据后可以回到原来的阅读位置。",
    active: true,
    version: 2,
  },
  {
    id: 5,
    project: "daylight",
    title: "减少计划调整的操作成本",
    text: "Daylight 帮助独立开发者安排工作。我关注任务被打断后，如何用少量操作调整接下来的计划，同时保留已经完成的工作。",
    active: true,
    version: 1,
  },
];
const contents = [
  {
    id: "c1",
    title: "让 Agent 的工作过程变得可理解",
    source: "GitHub",
    symbol: "github-logo",
    origin: "open-workbench / traceview",
    time: "14:32",
    date: "今天",
    project: "branchout",
    focus: 1,
    summary: "用可展开的执行记录解释当前动作，把最终结果留在阅读主线。",
    intro:
      "这份示例项目围绕 Agent 执行记录展开：将模型输出、工具调用和最终结果分层呈现，让使用者可以随时查看过程，也可以直接阅读结果。",
    connection: "任务完成后，结果应该接替进度成为视觉中心",
    reason:
      "Branchout 的项目分析同样需要经历等待、检查和采纳。可以借鉴这种连续的任务详情：运行时呈现当前动作，完成后直接阅读报告，过程保留在折叠区域。",
    evidence:
      "“Execution details stay available in a collapsible timeline. The final artifact becomes the primary view when the run finishes.”",
    points: [
      ["过程按事件组织", "模型消息和工具动作分开呈现，连续读取可以汇总展开。"],
      [
        "阅读位置由用户决定",
        "浏览历史消息时，新活动以轻提示出现，返回最新位置后继续跟随。",
      ],
      [
        "结果具有独立层级",
        "最终结论与引用形成完整阅读区域，执行记录作为辅助信息。",
      ],
    ],
  },
  {
    id: "c2",
    title: "引用应该出现在读者产生疑问的地方",
    source: "X",
    symbol: "chat-text",
    origin: "阅读交互札记",
    time: "11:08",
    date: "今天",
    project: "papertrail",
    focus: 4,
    summary: "把引用放在结论旁边，并让核对原文后的返回路径足够短。",
    intro:
      "这组示例讨论研究了长文档中的引用体验：读者通常在看到判断时产生核对需求，将证据放在当前阅读位置附近，可以减少上下文切换。",
    connection: "在结论旁展开证据，保留原来的阅读位置",
    reason:
      "Papertrail 的审阅者需要在观点与依据之间反复核对。行内引用和原文侧视图可以缩短这条路径，让审阅保持连续。",
    evidence:
      "“A citation is most useful at the exact moment a reader asks: what supports this claim?”",
    points: [
      ["先呈现短引用", "在当前段落提供足够支撑判断的原文片段。"],
      ["完整原文按需查看", "更长上下文通过原文阅读入口展开。"],
      ["返回时保留位置", "核对后继续阅读同一段结论。"],
    ],
  },
  {
    id: "c3",
    title: "任务重试时，哪些工作值得保留下来？",
    source: "GitHub",
    symbol: "github-logo",
    origin: "small-systems / resumable-jobs",
    time: "昨天",
    date: "昨天",
    project: "branchout",
    focus: 1,
    summary: "将有效结果与失败步骤分开保存，让重试的范围更明确。",
    intro:
      "示例仓库展示了分阶段保存后台任务结果的方式。恢复操作读取已经完成的阶段，继续处理仍待完成的部分。",
    connection: "失败界面应该说明已经保留的有效结果",
    reason:
      "当内容抓取完成、关联判断失败时，Branchout 已经拥有可读的原文和内容理解。把这些结果留在界面中，用户可以先阅读，再决定何时重试。",
    evidence:
      "“Persist completed work before scheduling the next stage. Recovery starts from the last valid result.”",
    points: [
      ["每个阶段保存结果", "原文与内容理解可以独立读取。"],
      ["重试范围清晰", "操作前说明即将继续处理的部分。"],
      ["错误靠近受影响的内容", "关联错误与关联区域一起呈现。"],
    ],
  },
  {
    id: "c4",
    title: "一个独立开发者的每周复盘方式",
    source: "小红书",
    symbol: "article",
    origin: "陈序的工作记录",
    time: "昨天",
    date: "昨天",
    project: "daylight",
    focus: 5,
    summary: "把未完成工作重新安排到可执行的时间段，保留调整原因。",
    intro:
      "这篇示例笔记记录了开发者每周整理任务的过程：先回顾实际投入，再将剩余工作拆成可以开始的小段。",
    connection: "调整计划时，同时保留已经发生的工作",
    reason:
      "Daylight 可以把已完成的时间段与待安排工作分开，让一次中断只影响接下来的计划。",
    evidence:
      "“先把已经做完的留下，再安排剩下的。这样调整计划的时候，也看得到这一周实际做了什么。”",
    points: [
      ["记录实际投入", "让复盘建立在已经发生的工作上。"],
      ["缩小下一步", "把宽泛任务改写成可以开始的行动。"],
      ["保存调整原因", "为下一次安排提供背景。"],
    ],
  },
  {
    id: "c5",
    title: "用声音记录城市的一天",
    source: "X",
    symbol: "chat-text",
    origin: "城市声音档案",
    time: "周一",
    date: "更早",
    project: null,
    focus: null,
    summary: "一份关于环境录音与声音整理的创作记录。",
    intro:
      "示例作者用一天时间记录街道、车站和公园的声音，将录音按地点和时间整理成可浏览的档案。",
    points: [
      ["按场景整理素材", "用地点和时间帮助听众理解声音背景。"],
      ["保留录音说明", "记录设备、环境与选择片段的理由。"],
    ],
  },
];
let cards;
try {
  cards =
    JSON.parse(localStorage.getItem("branchout-design-cards")) ||
    structuredClone(initialCards);
} catch {
  cards = structuredClone(initialCards);
}
const state = {
  page: "content",
  content: "c1",
  project: "branchout",
  task: "t1",
  contentFilter: "all",
  query: "",
  taskFilter: "all",
  focusProject: "all",
  focusFilter: "all",
  focusQuery: "",
  mobileDetail: false,
  accepted: new Set(),
  runStep: 0,
  runStatus: "idle",
  sourceFilter: "all",
  taskProject: "all",
};
const tasks = [
  {
    id: "t1",
    name: "重新理解项目的关注方向",
    target: "Branchout",
    project: "branchout",
    status: "completed",
    time: "今天 13:46",
    kind: "analysis",
  },
  {
    id: "t2",
    name: "内容关联处理中断",
    target: "任务重试时，哪些工作值得保留下来？",
    project: "branchout",
    status: "failed",
    time: "今天 12:20",
    kind: "content",
  },
  {
    id: "t3",
    name: "阅读交互与证据呈现",
    target: "Papertrail",
    project: "papertrail",
    status: "completed",
    time: "昨天 16:32",
    kind: "analysis",
  },
];
let runTimer, toastTimer, undoDelete;
const save = () =>
  localStorage.setItem("branchout-design-cards", JSON.stringify(cards));
const project = (id) => projects.find((p) => p.id === id) || projects[0];
const glyph = (id) => `<span class="project-glyph">${project(id).glyph}</span>`;
const labelStatus = (status) =>
  ({
    completed: "已完成",
    failed: "需要处理",
    running: "运行中",
    cancelled: "已停止",
    queued: "等待中",
  })[status];
const statusIcon = (status) =>
  ({
    completed: "check-circle",
    failed: "warning-circle",
    running: "circle-notch",
    cancelled: "stop-circle",
    queued: "clock",
  })[status];
function toast(text, undo = false) {
  clearTimeout(toastTimer);
  $("#toast").innerHTML =
    `<span>${esc(text)}</span>${undo ? '<button data-action="undo-delete">撤销</button>' : ""}`;
  $("#toast").classList.add("show");
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 6500);
}
function navigation() {
  return `<aside class="sidebar"><div class="brand"><img src="assets/brand.png" alt=""><span>Branchout</span></div><nav class="nav" aria-label="主导航">${[
    ["content", "tray", "内容"],
    ["tasks", "activity", "任务"],
    ["projects", "folder-simple", "项目"],
    ["focus", "bookmark-simple", "关注卡"],
  ]
    .map(
      ([id, i, t]) =>
        `<button data-page="${id}" class="${state.page === id ? "active" : ""}" aria-label="${t}" ${state.page === id ? 'aria-current="page"' : ""}>${icon(i)}<span class="nav-label">${t}</span>${id === "tasks" && state.runStatus === "running" ? '<span class="count">1</span>' : ""}</button>`,
    )
    .join(
      "",
    )}</nav><div class="side-projects"><div class="side-label">项目</div>${projects.map((p) => `<button class="project-shortcut" data-project="${p.id}">${glyph(p.id)}${esc(p.name)}</button>`).join("")}</div><div class="bottom-nav"><button data-page="settings" aria-label="设置">${icon("gear-six")}<span class="nav-label">设置</span></button><div class="demo-note"><span>交互原型 · 示例数据</span><button data-action="about" title="原型说明" aria-label="原型说明">${icon("info")}</button></div></div></aside>`;
}
function topbar() {
  const titles = {
    content: "内容",
    tasks: "任务",
    projects: "项目",
    focus: "关注卡",
    settings: "设置",
  };
  const actions = {
    content: button("添加链接", "add-link", "primary", "plus"),
    tasks: button("演示运行", "demo-run", "quiet", "play"),
    projects: button("添加项目", "add-project", "primary", "plus"),
    focus: button("新建关注卡", "new-focus", "primary", "plus"),
    settings: "",
  };
  return `<header class="topbar"><div class="crumb"><strong>${titles[state.page]}</strong>${state.page === "content" ? '<span class="slash">/</span><span class="muted">全部内容</span>' : ""}</div><div class="top-actions">${actions[state.page]}</div></header>`;
}
function render() {
  const view = {
    content: contentView,
    tasks: tasksView,
    projects: projectsView,
    focus: focusView,
    settings: settingsView,
  }[state.page];
  $("#app").innerHTML =
    `<div class="shell">${navigation()}<main class="main">${topbar()}${view()}</main></div>`;
}
function navigate(page) {
  state.page = page;
  state.mobileDetail = false;
  render();
}
function back() {
  return `<button class="button quiet mobile-back" data-action="back-list">${icon("arrow-left")}返回列表</button>`;
}
function contentView() {
  const filtered = contents.filter(
    (c) =>
      (state.contentFilter !== "connected" || c.project) &&
      (state.sourceFilter === "all" || c.source === state.sourceFilter) &&
      (!state.query ||
        (c.title + c.summary + c.origin)
          .toLowerCase()
          .includes(state.query.toLowerCase())),
  );
  if (filtered.length && !filtered.some((c) => c.id === state.content))
    state.content = filtered[0].id;
  const selected = filtered.find((c) => c.id === state.content);
  return `<div class="workspace ${state.mobileDetail ? "mobile-detail" : ""}"><section class="index-pane" aria-label="内容列表"><div class="index-tools"><div class="search">${icon("magnifying-glass")}<input id="content-search" aria-label="搜索内容" placeholder="搜索内容" value="${esc(state.query)}"><span class="kbd">⌘ K</span></div><div class="tabs" aria-label="内容筛选"><button data-content-filter="all" class="${state.contentFilter === "all" ? "active" : ""}">全部</button><button data-content-filter="connected" class="${state.contentFilter === "connected" ? "active" : ""}">与项目有关</button></div></div><div style="padding:7px 20px"><select class="select" id="source-filter" aria-label="来源筛选"><option value="all">全部来源</option>${["GitHub", "X", "小红书"].map((s) => `<option ${state.sourceFilter === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>${
    filtered.length
      ? ["今天", "昨天", "更早"]
          .map((date) => {
            const items = filtered.filter((c) => c.date === date);
            return items.length
              ? `<div class="group-label">${date}</div><div class="items">${items.map((c) => `<button class="item ${c.id === state.content ? "selected" : ""}" data-content="${c.id}" ${c.id === state.content ? 'aria-current="true"' : ""}><span class="item-meta">${icon(c.symbol)}${c.source}<time>${c.time}</time></span><strong>${esc(c.title)}</strong><p>${esc(c.summary)}</p><span class="item-bottom">${c.project ? `${icon("link-simple")}<span>${project(c.project).name}</span><span class="mini-label">1 个关联</span>` : "暂无关注关联"}</span></button>`).join("")}</div>`
              : "";
          })
          .join("")
      : `<div class="empty">${icon("magnifying-glass")}<h2>没有匹配的内容</h2><p>试试其他关键词或来源。</p>${button("清除筛选", "clear-search", "quiet")}</div>`
  }<div class="index-footer">${filtered.length} 条内容</div></section><section class="reader" aria-label="内容阅读">${selected ? contentArticle(selected) : `<div class="empty"><h2>选择内容开始阅读</h2></div>`}</section></div>`;
}
function contentArticle(c) {
  return `<article class="reading">${back()}<div class="byline">${icon(c.symbol)}<span>${esc(c.origin)}</span><span>今天 ${c.time === "14:32" ? "14:32" : "已保存"}</span></div><h1>${esc(c.title)}</h1><p class="deck">${esc(c.summary)}</p><div class="lead">${esc(c.intro)}</div><section class="read-section"><div class="section-title"><h2>与你的关注有关</h2>${c.project ? '<span class="muted">1 个关联</span>' : ""}</div>${c.project ? `<div class="relation primary-relation"><div class="project-ref">${glyph(c.project)}${project(c.project).name}<span>/</span>${esc(initialCards.find((f) => f.id === c.focus)?.title || "关注方向")}</div><h3>${esc(c.connection)}</h3><p>${esc(c.reason)}</p><div class="relation-footer"><button class="text-button" data-evidence="${c.id}" aria-expanded="false">${icon("quotes")}查看依据</button><button class="text-button" data-open-focus="${c.focus}">查看关注卡${icon("arrow-up-right")}</button></div><div class="evidence hidden" id="evidence-${c.id}">${esc(c.evidence)}<cite>示例原文摘录 <button class="text-button" data-source="${c.id}">打开上下文${icon("arrow-up-right")}</button></cite></div></div>` : `<div class="compact-body">这条内容与当前启用的关注卡暂时没有明确关联。你仍然可以阅读内容理解和原文。</div>`}</section><section class="read-section"><h2>内容要点</h2><div class="insights">${c.points.map(([title, text]) => `<div class="insight">${icon("minus")}<div><h3>${title}</h3><p>${text}</p></div></div>`).join("")}</div></section><details class="disclosure"><summary>${icon("caret-right")}来源与读取范围<span class="trailing">示例完整内容</span></summary><div class="inside">本原型使用虚构内容与引用展示阅读层级。正式报告将在此呈现来源、读取范围与缺失部分。</div></details><div class="article-actions"><button class="button" data-source="${c.id}">${icon("article")}阅读原文</button><button class="button quiet" data-action="content-task">${icon("activity")}查看处理任务</button></div></article>`;
}
function tasksView() {
  let visible = tasks.filter(
    (t) =>
      (state.taskFilter === "all" || t.status === state.taskFilter) &&
      (state.taskProject === "all" || t.project === state.taskProject),
  );
  if (visible.length && !visible.some((t) => t.id === state.task))
    state.task = visible[0].id;
  const selected = visible.find((t) => t.id === state.task);
  return `<div class="workspace ${state.mobileDetail ? "mobile-detail" : ""}"><section class="index-pane" aria-label="任务列表"><div class="index-tools"><div class="tabs" style="margin-top:2px">${[
    ["all", "全部"],
    ["running", "运行中"],
    ["failed", "需要处理"],
  ]
    .map(
      ([id, t]) =>
        `<button data-task-filter="${id}" class="${state.taskFilter === id ? "active" : ""}">${t}</button>`,
    )
    .join(
      "",
    )}</div></div><div style="padding:8px 20px"><select class="select" id="task-project" aria-label="任务项目筛选"><option value="all">全部项目</option>${projects.map((p) => `<option value="${p.id}" ${state.taskProject === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div><div class="group-label">最近任务</div><div class="items">${visible.map((t) => `<button class="item ${t.id === state.task ? "selected" : ""}" data-task="${t.id}"><span class="item-meta"><span class="status ${t.status}">${icon(statusIcon(t.status))}${labelStatus(t.status)}</span></span><strong>${esc(t.name)}</strong><p>${esc(t.target)}</p><span class="item-bottom">${t.time}</span></button>`).join("")}</div>${visible.length ? "" : `<div class="empty">${icon("check-circle")}<h2>${state.taskFilter === "running" ? "当前没有运行中的任务" : "当前没有待处理任务"}</h2><p>从项目开始一次分析，或添加内容链接。</p>${button("查看全部任务", "all-tasks", "quiet")}</div>`}<div class="index-footer">过程和结果保存在每次任务中</div></section><section class="reader" aria-label="任务详情">${selected ? taskArticle(selected) : '<div class="empty"><h2>任务完成后可以在这里阅读结果</h2></div>'}</section></div>`;
}
const activityTexts = [
  [
    "读取项目概况",
    "我会先了解项目的主要流程，再结合选中的工作对话，整理值得持续关注的问题。",
  ],
  [
    "查看相关实现",
    "已查看任务详情和报告呈现方式。接下来核对结果的保存位置与建议采纳流程。",
  ],
  [
    "理解工作对话",
    "近期讨论集中在阅读连续性和任务可见性。我会区分持续关注的问题与一次性的界面修改。",
  ],
  ["整理关注卡建议", "正在将发现整理为可独立理解的关注卡，并附上对应依据。"],
];
function activityHtml(steps = 4) {
  return `<ol class="activity">${activityTexts
    .slice(0, steps)
    .map(
      ([title, body], i) =>
        `<li><time>00:${String(8 + i * 13).padStart(2, "0")}</time><div><strong>${title}</strong><p>${body}</p>${i === 1 ? "<details><summary>查看读取的 3 份材料</summary><pre>README.md\nui/task-detail.tsx\nnotes/selected-conversations.xml</pre></details>" : ""}</div></li>`,
    )
    .join("")}</ol>`;
}
function taskArticle(t) {
  if (t.status === "running" || t.status === "cancelled")
    return runningArticle(t);
  if (t.status === "failed")
    return `<article class="reading">${back()}<div class="byline"><span class="status failed">${icon("warning-circle")}需要处理</span><span>内容理解</span></div><h1>内容已读取，关联判断需要重试</h1><p class="deck">${esc(t.target)}</p><div class="attention"><h3>关联判断时连接超时</h3><p>原文和内容理解已经保留。重试将继续评估它与关注卡的关系。</p></div><div class="article-actions">${button("重试关联判断", "retry-task", "primary", "arrow-clockwise")}${button("阅读已保存内容", "saved-content", "", "article")}</div><section class="read-section"><h2>已经完成</h2><div class="insights"><div class="insight">${icon("check")}<div><h3>原文读取</h3><p>正文与来源信息已保存。</p></div></div><div class="insight">${icon("check")}<div><h3>内容理解</h3><p>已形成内容概述与三个要点。</p></div></div></div></section><details class="disclosure"><summary>${icon("caret-right")}查看运行过程<span class="trailing">3 条记录</span></summary><div class="inside">14:20 读取来源完成<br>14:21 内容理解已保存<br>14:22 关联判断请求超时</div></details></article>`;
  if (t.kind === "content")
    return `<article class="reading">${back()}<div class="byline"><span class="status">${icon("check-circle")}已完成</span><span>内容理解</span></div><h1>${esc(t.target)}</h1><p class="deck">内容理解与关注关联已生成。</p><div class="article-actions">${button("阅读内容报告", "saved-content", "primary", "article")}</div><details class="disclosure"><summary>${icon("caret-right")}查看运行过程</summary><div class="inside">来源读取完成<br>内容理解完成<br>关注关联已保存</div></details></article>`;
  const p = project(t.project);
  return `<article class="reading">${back()}<div class="byline"><span class="status">${icon("check-circle")}已完成</span><span>${esc(p.name)}</span><span>${t.time}</span><span>${t.startedAt ? "示例运行 18 秒" : "用时 1 分 48 秒"}</span></div><h1>${t.project === "papertrail" ? "让审阅过程中的证据更容易核对" : "让分析结果更容易被理解和采纳"}</h1><div class="report-overview"><p>${esc(p.name)} 的下一步值得围绕<strong>阅读连续性</strong>展开：把结论、依据和下一步操作放在同一条阅读路径上。建议保留现有关注方向，并进一步明确任务过程与最终结果之间的关系。</p><div class="fact-row"><span>${icon("files")}12 份项目文件</span><span>${icon("chat-text")}${t.sessionCount ?? 3} 条工作对话</span><span>${icon("bookmark-simple")}2 条关注卡建议</span></div></div><details class="disclosure"><summary>${icon("caret-right")}查看运行过程<span class="trailing">4 条记录</span></summary>${activityHtml()}</details><section class="read-section"><h2>主要发现</h2><div class="insights"><div class="insight">${icon("arrow-elbow-down-right")}<div><h3>用户需要在任务完成的位置直接阅读结果</h3><p>过程与结果分散会增加找回上下文的成本。任务详情适合承载一次分析的完整记录。</p><button class="text-button" data-action="report-evidence">查看 2 处依据${icon("arrow-up-right")}</button></div></div><div class="insight">${icon("arrow-elbow-down-right")}<div><h3>建议的价值在于帮助用户做出具体决定</h3><p>把拟议的卡片内容、调整理由和采纳操作放在一起，让判断在当前阅读位置完成。</p></div></div></div></section><section class="read-section"><div class="section-title"><h2>关注卡建议</h2><span class="muted">逐条查看并采纳</span></div>${suggestionHtml(1, t.project)}${suggestionHtml(2, t.project)}</section><details class="disclosure"><summary>${icon("caret-right")}输入覆盖范围<span class="trailing">文件与对话</span></summary><div class="inside">示例分析查看了 12 份项目文件和 ${t.sessionCount ?? 3} 条选中的工作对话。所有结论、引用与数量均用于交互演示。</div></details></article>`;
}
function suggestionHtml(n, p) {
  const key = state.task + "-" + n;
  const accepted = state.accepted.has(key);
  return `<div class="suggestion"><div class="suggestion-head"><span class="tag">${n === 1 ? "更新关注卡" : "新建关注卡"}</span>${accepted ? `<span class="accepted">${icon("check")}已采纳</span>` : ""}</div><h3>${n === 1 ? "长任务中的可见性与信任" : "从发现到行动的阅读连续性"}</h3><p>${n === 1 ? "将关注范围从运行进度延伸到结果阅读与失败恢复。" : "关注结论、证据和操作如何组成一次完整的判断过程。"}</p>${n === 1 ? '<details class="disclosure" style="margin:12px 0;border-bottom:0"><summary>' + icon("caret-right") + '查看当前内容</summary><div class="inside">关注后台任务的进度反馈，帮助用户了解当前阶段和完成情况。</div></details>' : ""}<div class="proposed">${n === 1 ? `${project(p).name} 会在后台分析项目材料。我关注用户如何了解当前动作、核对依据，并在任务结束后直接阅读结果，在失败时继续使用已保存的有效内容。` : `${project(p).name} 需要把分析发现变成可以判断的建议。我关注结论、引用和采纳操作之间的距离，以及用户核对原文后如何回到原来的阅读位置。`}</div><div class="relation-footer"><span class="note">${n === 1 ? "基于当前关注卡 v3" : "采纳后加入 " + project(p).name}</span>${accepted ? `<button class="text-button" data-action="go-focus">查看关注卡${icon("arrow-up-right")}</button>` : `<button class="button ${n === 1 ? "primary" : ""}" data-accept="${n}" data-for-project="${p}">${icon(n === 1 ? "check" : "plus")}${n === 1 ? "采纳更新" : "创建关注卡"}</button>`}</div></div>`;
}
function runningArticle(t) {
  const stopped = t.status === "cancelled";
  return `<article class="reading">${back()}<div class="byline"><span class="status ${stopped ? "" : "running"}">${icon(stopped ? "stop-circle" : "circle-notch")}${stopped ? "已停止" : "运行中"}</span><span>${esc(t.target)}</span><span>示例运行</span></div><div class="run-main"><div class="run-symbol">${icon(stopped ? "stop" : "sparkle")}</div><h1>${stopped ? "分析已停止" : activityTexts[Math.min(state.runStep, 3)][0]}</h1><p>${stopped ? "已发生的活动保留在下方，可以重新开始。" : activityTexts[Math.min(state.runStep, 3)][1]}</p></div><div class="article-actions">${stopped ? button("重新分析", "demo-run", "primary", "arrow-clockwise") : button("停止分析", "stop-run", "", "stop")}</div><details class="disclosure" id="run-disclosure"><summary>${icon("caret-right")}查看运行过程<span class="trailing">${Math.min(state.runStep + 1, 4)} 条记录</span></summary>${activityHtml(Math.min(state.runStep + 1, 4))}</details>${stopped ? "" : `<div class="run-lines" aria-label="等待分析结果"><span></span><span></span><span></span></div><p class="note" style="margin-top:18px">报告生成后将在这里呈现</p>`}</article>`;
}
function projectsView() {
  const p = project(state.project);
  const pc = cards.filter((c) => c.project === p.id);
  return `<div class="workspace ${state.mobileDetail ? "mobile-detail" : ""}"><section class="index-pane" aria-label="项目列表"><div class="group-label" style="padding-top:25px">已绑定项目</div><div class="items">${projects.map((pr) => `<button class="item ${pr.id === p.id ? "selected" : ""}" data-project-select="${pr.id}"><span style="display:flex;gap:10px;align-items:center;margin-bottom:9px">${glyph(pr.id)}<strong style="margin:0">${esc(pr.name)}</strong></span><p>${esc(pr.description)}</p><span class="item-bottom">${cards.filter((c) => c.project === pr.id && c.active).length} 张启用的关注卡</span></button>`).join("")}</div><div class="index-footer">${projects.length} 个项目</div></section><section class="reader" aria-label="项目管理"><article class="reading">${back()}<div class="project-profile">${glyph(p.id)}<div><h1>${esc(p.name)}</h1><p>${esc(p.description)}</p></div></div><section class="project-primary"><h2>重新理解项目的关注方向</h2><p>结合当前仓库与选中的工作对话，整理值得持续关注的问题，并生成关注卡建议。</p>${button("开始分析", "preflight", "primary", "arrow-up-right")}</section><section class="read-section"><div class="section-title"><h2>关注卡</h2><button class="text-button" data-action="project-focus">管理${icon("arrow-up-right")}</button></div><div class="project-card-count"><span><b>${pc.filter((c) => c.active).length}</b>启用</span><span><b>${pc.filter((c) => !c.active).length}</b>暂停</span></div>${pc
    .slice(0, 3)
    .map(
      (c) =>
        `<button class="inline-link" data-open-focus="${c.id}"><span>${esc(c.title)}</span>${icon("caret-right")}</button>`,
    )
    .join(
      "",
    )}</section><section class="read-section"><h2>仓库信息</h2><dl><div class="property"><dt>本机目录</dt><dd class="mono">${esc(p.path)}</dd></div><div class="property"><dt>当前分支</dt><dd>main</dd></div><div class="property"><dt>绑定状态</dt><dd>可访问 <span class="muted">（示例）</span></dd></div></dl></section><div class="divider"></div><button class="inline-link" data-action="project-tasks"><span>查看这个项目的分析任务</span>${icon("arrow-up-right")}</button><div style="margin-top:15px">${button("管理项目绑定", "manage-project", "quiet", "folder-simple")}</div></article></section></div>`;
}
function focusView() {
  const filtered = cards.filter(
    (c) =>
      (state.focusProject === "all" || c.project === state.focusProject) &&
      (state.focusFilter === "all" ||
        (state.focusFilter === "active" ? c.active : !c.active)) &&
      (!state.focusQuery || (c.title + c.text).includes(state.focusQuery)),
  );
  return `<section class="focus-layout"><div class="focus-inner"><div class="focus-controls"><div class="search">${icon("magnifying-glass")}<input id="focus-search" aria-label="搜索关注卡" placeholder="搜索关注卡" value="${esc(state.focusQuery)}"></div><select class="select" id="focus-project" aria-label="关注卡项目筛选"><option value="all">全部项目</option>${projects.map((p) => `<option value="${p.id}" ${state.focusProject === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select><select class="select" id="focus-state" aria-label="关注卡状态筛选"><option value="all">全部状态</option><option value="active" ${state.focusFilter === "active" ? "selected" : ""}>启用</option><option value="paused" ${state.focusFilter === "paused" ? "selected" : ""}>暂停</option></select></div>${
    filtered.length
      ? projects
          .map((p) => {
            const group = filtered.filter((c) => c.project === p.id);
            return group.length
              ? `<section class="focus-group"><div class="focus-group-title">${glyph(p.id)}<h2>${esc(p.name)}</h2><small>${group.length} 张关注卡</small></div>${group.map((c) => `<article class="focus-row ${c.active ? "" : "paused"}" id="focus-${c.id}"><div><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p><div class="row-meta"><span>v${c.version}</span><span>${c.active ? "参与后续内容关联" : "已暂停关联"}</span><button class="text-button" data-edit-focus="${c.id}">编辑</button></div></div><div class="row-actions"><button class="switch ${c.active ? "on" : ""}" role="switch" aria-checked="${c.active}" aria-label="${c.active ? "暂停" : "启用"} ${esc(c.title)}" data-toggle-focus="${c.id}"><span class="switch-track"></span>${c.active ? "启用" : "暂停"}</button><button class="icon-button" data-delete-focus="${c.id}" aria-label="删除 ${esc(c.title)}" title="删除关注卡">${icon("trash")}</button></div></article>`).join("")}</section>`
              : "";
          })
          .join("")
      : `<div class="empty">${icon("bookmark-simple")}<h2>这里还没有关注卡</h2><p>写下一个希望持续关注的问题，或调整当前筛选。</p>${button("新建关注卡", "new-focus", "primary", "plus")}</div>`
  }</div></section>`;
}
function settingsView() {
  return `<section class="settings"><h1>连接与偏好</h1><h2>模型</h2><div class="setting-row"><div><h3>Codex 订阅</h3><p>示例连接，用于预览配置状态</p></div>${button("查看配置", "model-settings", "", "sliders-horizontal")}</div><h2>内容来源</h2>${[
    ["GitHub", "公开仓库内容", "已就绪"],
    ["X", "帖子与讨论", "示例已连接"],
    ["小红书", "图文笔记", "需要登录"],
  ]
    .map(
      ([name, desc, status]) =>
        `<div class="setting-row"><div><h3>${name}</h3><p>${desc}</p></div><button class="button quiet" data-setting-source="${name}">${status}${icon("caret-right")}</button></div>`,
    )
    .join(
      "",
    )}<h2>Telegram</h2><div class="setting-row"><div><h3>从聊天转发链接</h3><p>绑定后，转发的链接进入内容处理任务。</p></div>${button("设置连接", "telegram-settings", "", "link-simple")}</div><h2>原型数据</h2><div class="setting-row"><div><h3>恢复示例</h3><p>重置本浏览器中的关注卡修改与采纳状态。</p></div>${button("重置", "reset-demo", "quiet", "arrow-clockwise")}</div></section>`;
}
function showDialog(title, subtitle, body, footer, cls = "") {
  const d = $("#dialog");
  d.className = cls;
  d.innerHTML = `<div class="dialog-head"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ""}</div><button class="icon-button" data-action="close-dialog" aria-label="关闭">${icon("x")}</button></div><div class="dialog-body">${body}</div>${footer ? `<div class="dialog-foot">${footer}</div>` : ""}`;
  if (!d.open) d.showModal();
}
function sourceDialog(id) {
  const c = contents.find((x) => x.id === id) || contents[0];
  showDialog(
    "原文阅读",
    `${c.source} / 示例材料`,
    `<div class="source-cover">${icon(c.symbol)}<div><strong>${esc(c.origin)}</strong><p style="margin:4px 0 0;font-size:12px">为本次交互演示编写的来源内容</p></div></div><h2>${esc(c.title)}</h2><p style="margin-top:17px">${esc(c.intro)}</p>${c.evidence ? `<blockquote>${esc(c.evidence)}</blockquote>` : ""}${c.points.map(([t, b]) => `<h3>${t}</h3><p>${b} 这段材料用于展示阅读正文、检查引用和返回结论之间的交互。</p>`).join("")}`,
    button("返回阅读", "close-dialog", "primary"),
    "source-dialog",
  );
}
function preflight() {
  const p = project(state.project);
  showDialog(
    "分析 " + p.name,
    "选择这次分析使用的工作对话。",
    `<div class="status-strip">${icon("folder-simple")}<span>${esc(p.name)} 仓库已纳入</span><span class="note" style="margin-left:auto">示例材料</span></div><div class="section-title"><h3>工作对话</h3><span class="muted" id="selected-count">已选择 3 条</span></div>${[
      [
        "任务结果的阅读路径",
        "讨论报告应该在哪里呈现，以及如何在任务结束后继续阅读。",
        "今天",
      ],
      ["关注卡建议的采纳方式", "讨论卡片更新、历史版本与原位采纳。", "昨天"],
      [
        "项目分析的输入范围",
        "确定仓库与工作对话各自提供哪些背景。",
        "9 月 26 日",
      ],
    ]
      .map(
        ([t, b, date]) =>
          `<label class="session"><input type="checkbox" class="session-check" checked><span><strong>${t}</strong><p>${b}</p><small>${date}</small></span></label>`,
      )
      .join(
        "",
      )}<details class="disclosure"><summary>${icon("caret-right")}补充本次分析目标</summary><div class="form-field"><label for="analysis-goal">分析目标</label><textarea id="analysis-goal" style="min-height:85px" placeholder="例如：优先关注结果阅读与建议采纳的体验"></textarea></div></details>`,
    `<span class="hint">约 20 秒的模拟运行</span>${button("取消", "close-dialog", "quiet")}${button("开始分析", "start-run", "primary", "arrow-right")}`,
  );
}
function startRun(kind = "analysis") {
  if (state.runStatus === "running") {
    const active = tasks.find((t) => t.status === "running");
    state.page = "tasks";
    state.task = active.id;
    state.taskFilter = "all";
    state.taskProject = "all";
    state.mobileDetail = true;
    $("#dialog").close();
    render();
    toast("已返回正在运行的示例任务");
    return;
  }
  const selectedSessions = document.querySelectorAll(
    ".session-check:checked",
  ).length;
  clearInterval(runTimer);
  $("#dialog").close();
  state.runStatus = "running";
  state.runStep = 0;
  state.page = "tasks";
  state.taskFilter = "all";
  state.taskProject = "all";
  state.mobileDetail = true;
  const id = "run-" + Date.now();
  state.task = id;
  tasks.unshift({
    id,
    name: kind === "content" ? "理解内容与关注关联" : "分析项目的关注方向",
    target:
      kind === "content" ? "新提交的示例内容" : project(state.project).name,
    project: state.project,
    status: "running",
    time: "刚刚",
    kind,
    sessionCount: selectedSessions,
    startedAt: Date.now(),
    contentId: kind === "content" ? "c3" : undefined,
  });
  render();
  runTimer = setInterval(() => {
    state.runStep++;
    if (state.runStep >= 4) {
      clearInterval(runTimer);
      state.runStatus = "completed";
      tasks.find((t) => t.id === id).status = "completed";
      toast("分析完成，结果已呈现");
    }
    if (state.page === "tasks" && state.task === id) {
      const open = $("#run-disclosure")?.open;
      const scroll = $(".reader")?.scrollTop;
      render();
      if (open && $("#run-disclosure")) $("#run-disclosure").open = true;
      if ($(".reader")) $(".reader").scrollTop = scroll || 0;
    } else render();
  }, 4500);
}
function focusEditor(id) {
  const c = cards.find((c) => c.id === id);
  showDialog(
    c ? "编辑关注卡" : "新建关注卡",
    "写下项目背景，以及你希望持续关注的问题。",
    `<div class="form-field"><label for="card-project">所属项目</label><select id="card-project">${projects.map((p) => `<option value="${p.id}" ${(c?.project || state.project) === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div><div class="form-field"><label for="card-title">简短标题</label><input id="card-title" value="${esc(c?.title || "")}" placeholder="例如：任务结果的阅读体验"></div><div class="form-field"><label for="card-body">关注内容</label><textarea id="card-body" placeholder="这个项目在做什么？你希望从外部内容中了解什么？">${esc(c?.text || "")}</textarea><p class="help">保存后，启用的关注卡会参与后续内容关联。</p></div><div class="form-error" id="card-error" role="alert"></div>`,
    `${button("取消", "close-dialog", "quiet")}<button class="button primary" data-save-focus="${id || ""}">保存关注卡</button>`,
  );
}
const actions = {
  "back-list": () => {
    state.mobileDetail = false;
    render();
  },
  "close-dialog": () => $("#dialog").close(),
  "clear-search": () => {
    state.query = "";
    state.sourceFilter = "all";
    state.contentFilter = "all";
    render();
  },
  "all-tasks": () => {
    state.taskFilter = "all";
    state.taskProject = "all";
    render();
  },
  preflight: preflight,
  "start-run": () => startRun(),
  "demo-run": () => startRun(),
  "stop-run": () => {
    clearInterval(runTimer);
    state.runStatus = "cancelled";
    tasks.find((t) => t.id === state.task).status = "cancelled";
    render();
    toast("分析已停止");
  },
  "retry-task": () => startRun("content"),
  "saved-content": () => {
    const t = tasks.find((t) => t.id === state.task);
    state.page = "content";
    state.content = t?.contentId || "c3";
    state.query = "";
    state.contentFilter = "all";
    state.sourceFilter = "all";
    state.mobileDetail = true;
    render();
  },
  "content-task": () => {
    const c = contents.find((c) => c.id === state.content);
    let t = tasks.find((t) => t.contentId === c.id);
    if (!t) {
      t = {
        id: "content-" + c.id,
        contentId: c.id,
        name: "理解内容与关注关联",
        target: c.title,
        project: c.project,
        status: "completed",
        time: "今天",
        kind: "content",
      };
      tasks.unshift(t);
    }
    state.page = "tasks";
    state.task = t.id;
    state.taskFilter = "all";
    state.taskProject = "all";
    state.mobileDetail = true;
    render();
  },
  "project-focus": () => {
    state.focusProject = state.project;
    state.focusFilter = "all";
    state.focusQuery = "";
    navigate("focus");
  },
  "go-focus": () => {
    state.focusProject = "all";
    state.focusFilter = "all";
    navigate("focus");
  },
  "project-tasks": () => {
    const t = tasks.find((t) => t.project === state.project);
    state.task = t?.id || "t1";
    state.taskFilter = "all";
    state.taskProject = state.project;
    navigate("tasks");
  },
  "new-focus": () => focusEditor(),
  "undo-delete": () => {
    if (undoDelete) {
      cards.splice(undoDelete.index, 0, undoDelete.card);
      undoDelete = null;
      save();
      render();
      toast("关注卡已恢复");
    }
  },
  "add-link": () =>
    showDialog(
      "添加内容链接",
      "支持 GitHub、X 与小红书。",
      `<form id="link-form"><div class="form-field"><label for="content-url">内容链接</label><input id="content-url" type="url" placeholder="https://github.com/…" required><p class="help">本原型将使用示例内容演示处理过程。</p></div><p class="form-error" id="url-error" role="alert"></p></form>`,
      `${button("取消", "close-dialog", "quiet")}${button("开始理解", "submit-link", "primary", "arrow-right")}`,
    ),
  "submit-link": () => {
    const input = $("#content-url");
    let url;
    try {
      url = new URL(input.value);
    } catch {}
    if (
      !url ||
      url.protocol !== "https:" ||
      ![
        "github.com",
        "x.com",
        "twitter.com",
        "xiaohongshu.com",
        "www.xiaohongshu.com",
        "xhslink.com",
      ].includes(url.hostname)
    ) {
      $("#url-error").textContent = "填写 GitHub、X 或小红书的 HTTPS 链接。";
      input.focus();
      return;
    }
    startRun("content");
  },
  "report-evidence": () =>
    showDialog(
      "发现的依据",
      "示例项目文件与工作对话",
      `<div class="evidence">“任务完成后，使用者希望直接查看报告，并当场处理关注卡建议。”<cite>工作对话 / 任务结果的阅读路径</cite></div><div class="evidence">任务详情保存运行状态，报告包含结论、依据与关注卡建议。<cite>示例项目 / ui/task-detail.tsx</cite></div>`,
      button("返回报告", "close-dialog", "primary"),
    ),
  about: () =>
    showDialog(
      "交互原型",
      "用于确认内容组织、视觉层级和操作体验。",
      `<p class="compact-body">所有项目内容、模型输出与引用都是示例。分析过程采用模拟运行，关注卡修改保存在当前浏览器。</p><div class="divider"></div><p class="compact-body">建议体验：内容阅读与证据展开 → 项目分析 → 任务过程与报告 → 采纳建议 → 关注卡编辑、暂停、删除与撤销。</p>`,
      button("开始体验", "close-dialog", "primary"),
    ),
  "manage-project": () =>
    showDialog(
      "项目绑定",
      project(state.project).name,
      `<div class="form-field"><label>项目目录</label><p class="mono">${project(state.project).path}</p></div><p class="compact-body" style="margin-top:18px">此处为项目管理的呈现示例。正式应用将在这里提供更换目录、重命名与解绑操作。</p>`,
      button("完成", "close-dialog", "primary"),
    ),
  "add-project": () =>
    showDialog(
      "添加项目",
      "预览项目绑定的入口。",
      `<div class="form-field"><label for="project-name">项目名称</label><input id="project-name" placeholder="例如：Fieldnote"></div><div class="form-field"><label for="project-directory">目录</label><input id="project-directory" placeholder="~/Projects/fieldnote"></div><p class="form-error" id="project-error" role="alert"></p>`,
      `${button("取消", "close-dialog", "quiet")}${button("添加项目", "save-project", "primary")}`,
    ),
  "save-project": () => {
    const name = $("#project-name").value.trim(),
      path = $("#project-directory").value.trim();
    if (!name || !path) {
      $("#project-error").textContent = "填写项目名称和目录。";
      return;
    }
    const id = "p" + Date.now();
    projects.push({
      id,
      name,
      path,
      glyph: name[0].toUpperCase(),
      description: "刚刚添加的示例项目",
    });
    state.project = id;
    state.mobileDetail = true;
    $("#dialog").close();
    render();
    toast("示例项目已添加");
  },
  "model-settings": () =>
    showDialog(
      "模型连接",
      "配置状态示例",
      `<div class="form-field"><label for="model-type">连接方式</label><select id="model-type"><option>Codex 订阅</option><option>通用 API</option></select></div><p class="compact-body" style="margin-top:20px">本原型展示连接配置的层级。真实登录与凭据保存由正式应用处理。</p>`,
      button("完成", "close-dialog", "primary"),
    ),
  "telegram-settings": () =>
    showDialog(
      "Telegram",
      "连接设置示例",
      `<p class="compact-body">设置机器人后，绑定接收链接的聊天。转发的内容会进入任务列表，处理完成后在内容页阅读。</p>`,
      button("完成", "close-dialog", "primary"),
    ),
  "reset-demo": () => {
    cards = structuredClone(initialCards);
    save();
    state.accepted.clear();
    toast("示例关注卡已恢复");
    render();
  },
};
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.action) {
    actions[b.dataset.action]?.();
    return;
  }
  if (b.dataset.page) {
    navigate(b.dataset.page);
    return;
  }
  if (b.dataset.project) {
    state.project = b.dataset.project;
    navigate("projects");
    state.mobileDetail = true;
    render();
    return;
  }
  if (b.dataset.projectSelect) {
    state.project = b.dataset.projectSelect;
    state.mobileDetail = true;
    render();
    return;
  }
  if (b.dataset.content) {
    state.content = b.dataset.content;
    state.mobileDetail = true;
    render();
    return;
  }
  if (b.dataset.contentFilter) {
    state.contentFilter = b.dataset.contentFilter;
    render();
    return;
  }
  if (b.dataset.taskFilter) {
    state.taskFilter = b.dataset.taskFilter;
    render();
    return;
  }
  if (b.dataset.task) {
    state.task = b.dataset.task;
    state.mobileDetail = true;
    render();
    return;
  }
  if (b.dataset.evidence) {
    const el = $("#evidence-" + b.dataset.evidence);
    el.classList.toggle("hidden");
    const expanded = !el.classList.contains("hidden");
    b.setAttribute("aria-expanded", expanded);
    b.innerHTML = icon("quotes") + (expanded ? "收起依据" : "查看依据");
    return;
  }
  if (b.dataset.source) {
    sourceDialog(b.dataset.source);
    return;
  }
  if (b.dataset.openFocus) {
    state.page = "focus";
    state.focusProject = "all";
    state.focusFilter = "all";
    state.focusQuery = "";
    render();
    const el = $("#focus-" + b.dataset.openFocus);
    if (el) {
      el.scrollIntoView({
        block: "center",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
      el.animate([{ background: "#eef1ff" }, { background: "transparent" }], {
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 1200,
      });
    } else toast("当前卡片已删除，历史报告保留当时的引用");
    return;
  }
  if (b.dataset.toggleFocus) {
    const c = cards.find((c) => c.id === Number(b.dataset.toggleFocus));
    c.active = !c.active;
    c.version++;
    save();
    render();
    toast(c.active ? "已启用，将参与后续内容关联" : "已暂停，历史关联仍然保留");
    return;
  }
  if (b.dataset.deleteFocus) {
    const index = cards.findIndex(
      (c) => c.id === Number(b.dataset.deleteFocus),
    );
    undoDelete = { index, card: cards[index] };
    cards.splice(index, 1);
    save();
    render();
    toast("关注卡已删除，历史报告保留引用", true);
    return;
  }
  if (b.dataset.editFocus) {
    focusEditor(Number(b.dataset.editFocus));
    return;
  }
  if ("saveFocus" in b.dataset) {
    const title = $("#card-title").value.trim(),
      text = $("#card-body").value.trim(),
      p = $("#card-project").value;
    if (!title || !text) {
      $("#card-error").textContent = "填写标题与关注内容后保存。";
      return;
    }
    const c = cards.find((c) => c.id === Number(b.dataset.saveFocus));
    if (c) {
      Object.assign(c, { title, text, project: p, version: c.version + 1 });
    } else
      cards.push({
        id: Date.now(),
        title,
        text,
        project: p,
        version: 1,
        active: true,
      });
    save();
    $("#dialog").close();
    render();
    toast("关注卡已保存");
    return;
  }
  if (b.dataset.accept) {
    const n = Number(b.dataset.accept),
      p = b.dataset.forProject;
    state.accepted.add(state.task + "-" + n);
    if (n === 1) {
      const c = cards.find((c) => c.project === p && c.id === 1);
      if (c) {
        c.text = `${project(p).name} 会在后台分析项目材料。我关注用户如何了解当前动作、核对依据，并在任务结束后直接阅读结果，在失败时继续使用已保存的有效内容。`;
        c.version++;
      } else
        cards.push({
          id: Date.now(),
          project: p,
          title: "长任务中的可见性与信任",
          text: "关注用户如何了解当前动作、核对依据，并在任务结束后直接阅读结果。",
          active: true,
          version: 1,
        });
    } else
      cards.push({
        id: Date.now(),
        project: p,
        title: "从发现到行动的阅读连续性",
        text: `${project(p).name} 需要把分析发现变成可以判断的建议。我关注结论、引用和采纳操作之间的距离，以及用户核对原文后如何回到原来的阅读位置。`,
        active: true,
        version: 1,
      });
    save();
    const top = $(".reader").scrollTop;
    render();
    $(".reader").scrollTop = top;
    toast(n === 1 ? "关注卡已更新" : "关注卡已创建");
    return;
  }
  if (b.dataset.settingSource) {
    showDialog(
      b.dataset.settingSource + " 来源",
      "连接状态示例",
      `<p class="compact-body">正式应用将在这里显示登录状态、可读取的内容范围与对应的配置操作。</p>`,
      button("完成", "close-dialog", "primary"),
    );
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "content-search" || e.target.id === "focus-search") {
    const id = e.target.id,
      pos = e.target.selectionStart;
    state[id === "content-search" ? "query" : "focusQuery"] = e.target.value;
    render();
    const input = $("#" + id);
    input.focus();
    input.setSelectionRange(pos, pos);
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "task-project") {
    state.taskProject = e.target.value;
    render();
  }
  if (e.target.id === "source-filter") {
    state.sourceFilter = e.target.value;
    render();
  }
  if (e.target.id === "focus-project") {
    state.focusProject = e.target.value;
    render();
  }
  if (e.target.id === "focus-state") {
    state.focusFilter = e.target.value;
    render();
  }
  if (e.target.classList.contains("session-check"))
    $("#selected-count").textContent =
      "已选择 " +
      document.querySelectorAll(".session-check:checked").length +
      " 条";
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    if (state.page !== "content") navigate("content");
    $("#content-search")?.focus();
  }
  if (e.key === "Enter" && e.target.id === "content-url") {
    e.preventDefault();
    actions["submit-link"]();
  }
});
$("#dialog").addEventListener("click", (e) => {
  if (e.target === $("#dialog")) {
    const rect = e.target.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    )
      e.target.close();
  }
});
render();
