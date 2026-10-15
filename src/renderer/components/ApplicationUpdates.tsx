import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowClockwise,
  CaretRight,
  X,
} from "@phosphor-icons/react";
import { bridge } from "../bridge";
import { t, tf, dateTime } from "../i18n";
import { Dialog, Markdown } from "./Primitives";
import type { ApplicationUpdateView } from "../../shared/update-contracts";
import { buildIdentity } from "../../shared/build-identity";

export function useApplicationUpdates() {
  const [view, setView] = useState<ApplicationUpdateView>();
  const [confirmation, setConfirmation] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void bridge
        .applicationUpdates()
        .then((reply) => {
          if (active && reply.ok) setView(reply.value);
        })
        .catch(() => {
          if (active) setError(t("更新状态读取失败"));
        });
    refresh();
    const unsubscribe = bridge.onUpdateChanged(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const requestInstall = async (wait = false) => {
    try {
      const reply = await bridge.installUpdate(wait);
      if (reply.ok) setConfirmation(reply.value.requiresWait);
      else setError(reply.message);
    } catch {
      setError(t("更新操作失败，请重试"));
    }
  };
  const action = async (callback: () => Promise<unknown>) => {
    setError("");
    try {
      await callback();
    } catch {
      setError(t("更新操作失败，请重试"));
    }
  };
  return { view, confirmation, setConfirmation, requestInstall, action, error };
}
type Controller = ReturnType<typeof useApplicationUpdates>;
const bytes = (value: number) =>
  value >= 1024 * 1024
    ? `${(value / 1024 / 1024).toFixed(1)} MB`
    : `${(value / 1024).toFixed(0)} KB`;

export function UpdateSettings({
  updates,
  onTasks,
  onLater,
}: {
  updates: Controller;
  onTasks(): void;
  onLater(): void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const view = updates.view;
  if (
    !view ||
    (view.state === "disabled" && buildIdentity.platform.startsWith("win32"))
  )
    return null;
  const { state, release, progress, failure } = view;
  const messages: Record<ApplicationUpdateView["state"], string> = {
    disabled: "安装版支持应用更新。",
    idle: "检查是否有新版本。",
    checking: "正在检查更新…",
    latest: "已是最新版本",
    available: "有新版本可用",
    downloading: "正在下载更新",
    downloaded: "更新已下载",
    waiting: "等待当前任务完成",
    installing: "正在验证安装包并准备重启…",
    failed:
      failure === "check"
        ? "检查更新失败，请检查网络后重试。"
        : failure === "download"
          ? "下载失败，请检查网络后重试。"
          : "安装包验证失败或更新未完成。应用已保留，可以重试。",
  };
  const retry = () =>
    failure === "install"
      ? updates.requestInstall()
      : updates.action(
          failure === "download"
            ? bridge.downloadUpdate
            : bridge.checkForUpdates,
        );
  return (
    <section
      className="settings-section application-updates"
      aria-labelledby="application-updates-title"
      id="application-updates"
    >
      <div className="update-heading">
        <img src="../assets/postrove.png" alt="" width="48" height="48" />
        <div>
          <h2 id="application-updates-title">{t("应用更新")}</h2>
          <p className="muted">Postrove {view.version}</p>
        </div>
      </div>
      <p role="status">
        {t(messages[state])}
        {release && <> · {release.version}</>}
      </p>
      {view.checkedAt &&
        !["downloading", "waiting", "installing"].includes(state) && (
          <p className="muted">
            {t("上次检查")} {dateTime(view.checkedAt)}
          </p>
        )}
      {release?.notes && (
        <div className="update-notes">
          <button
            className="button button-quiet update-disclosure"
            aria-expanded={notesOpen}
            onClick={() => setNotesOpen(!notesOpen)}
          >
            {t("更新说明")}
            <CaretRight size={14} className={notesOpen ? "open" : ""} />
          </button>
          {notesOpen && <Markdown>{release.notes}</Markdown>}
        </div>
      )}
      {release?.size && state === "available" ? (
        <p className="muted">{bytes(release.size)}</p>
      ) : null}
      {state === "downloading" && (
        <div className="update-progress">
          <progress
            aria-label={t("下载进度")}
            max="100"
            value={progress?.percent ?? 0}
          />
          <p className="muted">
            {Math.floor(progress?.percent ?? 0)}% ·{" "}
            {bytes(progress?.transferred ?? 0)} /{" "}
            {bytes(progress?.total ?? release?.size ?? 0)} ·{" "}
            {bytes(progress?.bytesPerSecond ?? 0)}/s
          </p>
        </div>
      )}
      {state === "waiting" && (
        <>
          <p className="muted">
            {t("当前任务结束后自动安装。新任务暂缓开始。")}
          </p>
          <JobList view={view} />
        </>
      )}
      <div className="row-actions">
        {["idle", "latest", "checking", "disabled"].includes(state) && (
          <button
            className="button"
            disabled={state === "checking" || state === "disabled"}
            onClick={() => void updates.action(bridge.checkForUpdates)}
          >
            <ArrowClockwise size={16} />
            {t("检查更新")}
          </button>
        )}
        {state === "available" && (
          <button
            className="button button-primary"
            onClick={() => void updates.action(bridge.downloadUpdate)}
          >
            <ArrowDown size={16} />
            {t("下载更新")}
          </button>
        )}
        {state === "downloading" && (
          <button
            className="button"
            onClick={() => void updates.action(bridge.cancelUpdateDownload)}
          >
            {t("取消下载")}
          </button>
        )}
        {state === "downloaded" && (
          <>
            <button
              className="button button-primary"
              onClick={() => void updates.requestInstall()}
            >
              {t("安装并重启")}
            </button>
            <button className="button button-quiet" onClick={onLater}>
              {t("稍后")}
            </button>
          </>
        )}
        {state === "waiting" && (
          <>
            <button className="button" onClick={onTasks}>
              {t("查看任务")}
            </button>
            <button
              className="button button-quiet"
              onClick={() => void updates.action(bridge.cancelUpdateWait)}
            >
              {t("取消等待")}
            </button>
          </>
        )}
        {state === "failed" && (
          <button className="button" onClick={() => void retry()}>
            {t("重试")}
          </button>
        )}
      </div>
      {updates.error && (
        <p role="alert" className="error-text">
          {updates.error}
        </p>
      )}
    </section>
  );
}
function JobList({ view }: { view: ApplicationUpdateView }) {
  return (
    <ul className="update-jobs">
      {view.jobs.map((job) => (
        <li key={job.id}>
          <span>{t(job.kind === "search" ? "搜索" : "解析")}</span>
          <strong>{job.label}</strong>
        </li>
      ))}
    </ul>
  );
}
export function UpdateExperience({
  updates,
  onOpen,
}: {
  updates: Controller;
  onOpen(): void;
}) {
  const [dismissed, setDismissed] = useState("");
  const view = updates.view;
  if (!view) return null;
  return (
    <>
      {view.state === "installing" && (
        <div className="update-installation" role="status">
          <img src="../assets/postrove.png" alt="" width="76" height="76" />
          <h2>{t("正在准备安装更新")}</h2>
          <p className="muted">
            {t("正在验证安装包并保存状态，随后重启应用。")}
          </p>
        </div>
      )}
      {view.state === "available" && dismissed !== view.release?.version && (
        <div className="update-toast" role="status">
          <span>{tf("Postrove {0} 已发布", view.release?.version)}</span>
          <button
            className="button button-quiet"
            onClick={() => {
              setDismissed(view.release!.version);
              onOpen();
            }}
          >
            {t("查看更新")}
          </button>
          <button
            className="button button-quiet"
            onClick={() => setDismissed(view.release!.version)}
          >
            {t("稍后")}
          </button>
        </div>
      )}
      {view.updatedFrom && (
        <div className="update-toast" role="status">
          <span>{tf("已更新至 Postrove {0}", view.version)}</span>
          <button
            className="icon-button"
            aria-label={t("关闭提示")}
            onClick={() => void updates.action(bridge.dismissUpdateSuccess)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {updates.confirmation && (
        <Dialog
          title={tf("{0} 个任务正在运行", view.jobs.length)}
          onClose={() => updates.setConfirmation(false)}
        >
          <p>{t("当前任务完成后再安装更新。等待期间，新任务会暂缓开始。")}</p>
          <JobList view={view} />
          <div className="dialog-actions">
            <button
              className="button"
              onClick={() => updates.setConfirmation(false)}
            >
              {t("返回")}
            </button>
            <button
              className="button button-primary"
              onClick={() => void updates.requestInstall(true)}
            >
              {t("任务完成后安装")}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
