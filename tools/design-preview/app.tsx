import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArticleIcon,
  FolderSimpleIcon,
  CrosshairIcon,
  PulseIcon,
  GearSixIcon,
  CheckIcon,
  PlusIcon,
  ArrowLeftIcon,
  XIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react";
import {
  DesignButton as Button,
  Disclosure,
} from "../../src/renderer/design/Components";
import { Dialog } from "../../src/renderer/components/Primitives";
import "./style.css";
function App() {
  const [page, setPage] = useState("report"),
    [modal, setModal] = useState(false),
    [accepted, setAccepted] = useState(false),
    [saved, setSaved] = useState(false);
  const [cardText, setCardText] = useState(
    "哪些阅读线索值得进入项目的长期关注？观察它们如何从单次发现演变成可行动的判断。",
  );
  const [draft, setDraft] = useState(cardText);
  const openEditor = () => {
    setDraft(cardText);
    setModal(true);
  };
  return (
    <div className="design-scope preview">
      <aside>
        <div className="brand">
          <img src="mark.svg" />
          Branchout
        </div>
        <div className="workspace-label">工作空间</div>
        <nav>
          {[
            [ArticleIcon, "内容"],
            [FolderSimpleIcon, "项目"],
            [CrosshairIcon, "关注卡"],
            [PulseIcon, "任务"],
          ].map(([Icon, label]: any) => (
            <div
              key={label}
              className={`nav-row ${label === "任务" ? "selected" : ""}`}
            >
              <Icon size={18} />
              {label}
            </div>
          ))}
        </nav>
        <div className="aside-bottom">
          <span>
            <GearSixIcon size={18} />
            设置
          </span>
          <small>设计预览 · 虚构数据</small>
        </div>
      </aside>
      <main>
        <header>
          <strong>任务</strong>
          <div className="switch">
            <button
              className={page === "report" ? "active" : ""}
              onClick={() => setPage("report")}
            >
              报告场景
            </button>
            <button
              className={page === "kit" ? "active" : ""}
              onClick={() => setPage("kit")}
            >
              组件样张
            </button>
          </div>
          <span className="edition">设计草案 / 01</span>
        </header>
        {page === "report" ? (
          <div className="report-layout">
            <section className="index">
              <div className="index-top">
                最近任务 <span>3</span>
              </div>
              <div className="task selected">
                <span className="task-meta">
                  <CheckIcon /> 已完成 · 今天 14:32
                </span>
                <strong>项目分析</strong>
                <p>Fieldnotes</p>
                <small>2 条发现 · 1 条关注卡建议</small>
              </div>
              <div className="task">
                <span className="task-meta">昨天 18:06</span>
                <strong>理解一篇内容</strong>
                <p>让阅读中的线索重新相遇</p>
              </div>
              <div className="task">
                <span className="task-meta">昨天 10:24</span>
                <strong>项目分析</strong>
                <p>Atlas</p>
              </div>
            </section>
            <article className="reader">
              <div className="report-top">
                <span>Fieldnotes / 项目分析</span>
                <span className="status">
                  <CheckIcon size={13} />
                  已完成
                </span>
              </div>
              <h1>让每条发现，都有下一步</h1>
              <p className="lead">
                阅读与项目之间的关联已经清楚。下一步应让发现进入持续关注，而不是停留在一份报告里。
              </p>
              <div className="report-meta">
                今天 14:32 <span>耗时 2 分 18 秒</span>
                <span>2 条发现</span>
              </div>
              <Disclosure title="输入覆盖范围" count="2 类来源">
                <p>仓库现状 · 阅读流程、项目关联与关注卡模块</p>
                <p>项目对话 · 3 段相关讨论，覆盖产品目标与交互决策</p>
              </Disclosure>
              <section className="finding">
                <div className="section-label">
                  发现 01 <span>阅读体验</span>
                </div>
                <h2>先给出理解，再让证据按需展开</h2>
                <p>
                  读者首先需要知道这篇内容说了什么、与项目有什么关系。来源与引用适合跟随具体结论，在需要核对时打开。
                </p>
                <Disclosure title="支持这条发现的证据" count="3 条">
                  <p>
                    阅读页已包含独立的理解摘要；项目关联提供明确理由；引用可回溯到原始内容。
                  </p>
                  <code>reader / understanding → connections → evidence</code>
                </Disclosure>
              </section>
              <section className="finding">
                <div className="section-label">
                  发现 02 <span>持续关注</span>
                </div>
                <h2>把一次性建议变成可持续追踪的问题</h2>
                <p>
                  关注卡适合保存仍需观察的方向。使用具体的问题，可以让后续内容围绕同一主题积累证据。
                </p>
                <div className="suggestion">
                  <div className="suggestion-heading">
                    <CrosshairIcon size={18} />
                    <strong>建议新增关注卡</strong>
                    <span>Fieldnotes</span>
                  </div>
                  <p>{cardText}</p>
                  <div className="actions">
                    <Button
                      variant="primary"
                      disabled={accepted}
                      onClick={() => setAccepted(true)}
                    >
                      {accepted ? (
                        <CheckIcon size={16} />
                      ) : (
                        <PlusIcon size={16} />
                      )}{" "}
                      {accepted ? "已加入关注卡" : "加入关注卡"}
                    </Button>
                    <Button variant="quiet" onClick={openEditor}>
                      编辑内容
                    </Button>
                  </div>
                </div>
              </section>
              <Disclosure title="运行过程" count="3 条记录">
                <div className="event">
                  <span>14:30</span>
                  <div>
                    <strong>阅读项目材料</strong>
                    <p>已整理阅读流程与关注卡的关系。</p>
                  </div>
                </div>
                <div className="event">
                  <span>14:31</span>
                  <div>
                    <strong>模型回复</strong>
                    <p>
                      两条线索值得进一步观察：
                      <br />• 理解摘要如何帮助快速判断相关性
                      <br />• 持续关注如何承接一次性建议
                    </p>
                  </div>
                </div>
                <div className="event">
                  <span>14:32</span>
                  <strong>报告已生成</strong>
                </div>
              </Disclosure>
            </article>
          </div>
        ) : (
          <article className="kit">
            <div className="report-top">Branchout / 组件语言</div>
            <h1>清楚、轻盈，有一点温度。</h1>
            <p className="lead">
              白色承载内容，墨色承载操作，柔黄只留下品牌的辨识度。
            </p>
            <section>
              <h2>品牌与功能图标</h2>
              <div className="brand-examples">
                <div className="app-mark">
                  <img src="mark.svg" />
                </div>
                <div>
                  <div className="icons">
                    {[
                      ArticleIcon,
                      FolderSimpleIcon,
                      CrosshairIcon,
                      PulseIcon,
                      GearSixIcon,
                    ].map((Icon, i) => (
                      <Icon key={i} size={20} />
                    ))}
                  </div>
                  <p>统一线宽与中性墨色，状态跟随所在控件。</p>
                </div>
              </div>
              <div className="swatches">
                {[
                  ["#ffffff", "画布"],
                  ["#f7f7f5", "次级表面"],
                  ["#242421", "墨色"],
                  ["#f2d76b", "品牌黄"],
                  ["#355ec7", "焦点蓝"],
                ].map(([color, label]) => (
                  <div key={label}>
                    <i style={{ background: color }} />
                    <small>{label}</small>
                    <code>{color}</code>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h2>操作的层级与距离</h2>
              <div className="actions">
                <Button variant="primary" onClick={openEditor}>
                  <PlusIcon size={16} />
                  新建关注卡
                </Button>
                <Button onClick={openEditor}>
                  <PencilSimpleIcon size={16} />
                  编辑
                </Button>
                <Button variant="quiet" onClick={() => setSaved(!saved)}>
                  {saved ? "已保存" : "保存草稿"}
                </Button>
                <span className="group-divider" />
                <Button disabled>处理中</Button>
              </div>
              <p className="caption">
                常规高度 36 · 组内间距 8 · 图标与文字 8 · 跨组间距 24
              </p>
              <div className="actions">
                <Button compact onClick={openEditor}>
                  紧凑操作
                </Button>
                <Button
                  compact
                  variant="quiet"
                  onClick={() => setPage("report")}
                >
                  <ArrowLeftIcon size={16} />
                  返回报告
                </Button>
              </div>
            </section>
            <section>
              <h2>辅助信息，按需出现</h2>
              <Disclosure title="输入覆盖范围" count="2 类来源">
                <p>仓库现状与项目对话共同支撑本次分析。</p>
              </Disclosure>
              <Disclosure title="支持证据" count="3 条">
                <p>证据就近放在它支持的结论下方，展开后继续沿正文阅读。</p>
              </Disclosure>
              <p className="caption">
                整行可操作 · 查看 / 收起 · 辅助数量降一级 · 键盘焦点清晰
              </p>
            </section>
          </article>
        )}
        {modal && (
          <Dialog title="编辑关注卡" onClose={() => setModal(false)}>
            <label className="editor-label" htmlFor="card">
              持续关注的问题
            </label>
            <textarea
              id="card"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="modal-footer">
              <Button variant="quiet" onClick={() => setModal(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setCardText(draft);
                  setModal(false);
                  setSaved(true);
                }}
              >
                保存草稿
              </Button>
            </div>
          </Dialog>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
