import { useState } from "react";
import { bridge } from "../bridge";
import { t } from "../i18n";
import { Dialog } from "./Primitives";
import type { UiFocusCard, UiProject } from "../product-ui";
import type {
  SearchPeriod,
  SearchPlatform,
} from "../../shared/focus-search-contracts";
export function FocusSearchDialog({
  cards,
  projects,
  onClose,
  onStarted,
}: {
  cards: UiFocusCard[];
  projects: UiProject[];
  onClose: () => void;
  onStarted: (taskId: string) => void;
}) {
  const available = cards.filter(
    (c) =>
      !c.deletedAt &&
      projects.some(
        (p) => p.projectId === c.projectId && p.status === "active",
      ),
  );
  const [selected, setSelected] = useState(available.map((c) => c.focusId));
  const [platforms, setPlatforms] = useState<SearchPlatform[]>([
    "xiaohongshu",
    "x",
  ]);
  const [period, setPeriod] = useState<SearchPeriod>("week");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog title={t("搜索相关讨论")} onClose={onClose}>
      <fieldset className="search-options">
        <legend>{t("关注卡")}</legend>
        {available.map((card) => (
          <label key={card.focusId}>
            <input
              type="checkbox"
              checked={selected.includes(card.focusId)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, card.focusId]
                    : selected.filter((id) => id !== card.focusId),
                )
              }
            />
            <span>{card.current.content}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="search-options">
        <legend>{t("搜索平台")}</legend>
        {(["xiaohongshu", "x"] as const).map((platform) => (
          <label key={platform}>
            <input
              type="checkbox"
              checked={platforms.includes(platform)}
              onChange={(e) =>
                setPlatforms(
                  e.target.checked
                    ? [...platforms, platform]
                    : platforms.filter((p) => p !== platform),
                )
              }
            />
            {platform === "x" ? "X" : t("小红书")}
          </label>
        ))}
      </fieldset>
      <label className="settings-field">
        <span>{t("讨论时段")}</span>
        <select
          aria-label={t("讨论时段")}
          value={period}
          onChange={(e) => setPeriod(e.target.value as SearchPeriod)}
        >
          <option value="day">{t("近 1 天")}</option>
          <option value="week">{t("近 1 周")}</option>
          <option value="month">{t("近 1 个月")}</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button
          className="button button-primary"
          disabled={busy || !selected.length || !platforms.length}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const reply = await bridge.startFocusSearch({
                focusIds: selected,
                platforms,
                period,
              });
              if (reply.ok) onStarted(reply.value);
              else setError(reply.message);
            } catch {
              setError(t("搜索启动失败"));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? t("正在启动…") : t("开始搜索")}
        </button>
      </div>
    </Dialog>
  );
}
