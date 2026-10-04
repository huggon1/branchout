import { t } from "../i18n";
import { useEffect, useState } from "react";
import type { AnalysisPromptView } from "../../shared/analysis-prompt-contracts";
import { bridge } from "../bridge";

export function AnalysisPromptSettings() {
  const [saved, setSaved] = useState<AnalysisPromptView>();
  const [analysisGoal, setAnalysisGoal] = useState("");
  const [cardWriting, setCardWriting] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const applyView = (view: AnalysisPromptView) => {
    setSaved(view);
    setAnalysisGoal(view.analysisGoal);
    setCardWriting(view.cardWriting);
  };

  useEffect(() => {
    let active = true;
    void bridge
      .analysisPromptView()
      .then((result) => {
        if (!active) return;
        if (result.ok) applyView(result.value);
        else setError(result.message);
      })
      .catch(() => {
        if (active) setError(t("无法读取项目分析提示词配置"));
      });
    return () => {
      active = false;
    };
  }, []);

  const dirty = Boolean(
    saved &&
    (analysisGoal !== saved.analysisGoal || cardWriting !== saved.cardWriting),
  );
  const fieldError =
    analysisGoal.trim().length > 4000 || cardWriting.trim().length > 4000
      ? t("每个字段最多填写 4000 个字符。")
      : "";

  const save = async () => {
    if (fieldError) {
      setError(fieldError);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await bridge.saveAnalysisPrompt({
        analysisGoal,
        cardWriting,
      });
      if (result.ok) {
        applyView(result.value);
        setNotice(t("已保存；后续分析使用这一版提示词。"));
      } else setError(result.message);
    } catch {
      setError(t("提示词配置未保存，请重试。"));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await bridge.resetAnalysisPrompt();
      if (result.ok) {
        applyView(result.value);
        setNotice(t("已清除补充信息；后续分析使用固定任务说明。"));
      } else setError(result.message);
    } catch {
      setError(t("默认提示词恢复失败，请重试。"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="settings-section analysis-prompt-settings"
      aria-labelledby="analysis-prompt-title"
    >
      <div className="settings-section-heading">
        <div>
          <h3 id="analysis-prompt-title">{t("项目分析提示词")}</h3>
          <p>{t("可选的补充信息。留空时，Agent 使用固定任务说明。")}</p>
        </div>
        <span
          className={`status-tag ${saved?.customized ? "status-active" : "status-paused"}`}
        >
          {saved?.customized ? t("已补充") : t("未补充")}
        </span>
      </div>
      <label className="settings-field" htmlFor="analysis-prompt-goal">
        <span>{t("分析目标")}</span>
        <textarea
          id="analysis-prompt-goal"
          value={analysisGoal}
          onChange={(event) => {
            setAnalysisGoal(event.target.value);
            setError("");
            setNotice("");
          }}
          disabled={busy || !saved}
          rows={3}
          aria-describedby="analysis-prompt-goal-help"
        />
        <small id="analysis-prompt-goal-help">
          {t("调整报告的侧重点、详略和表达。报告围绕 README 实现、测试和文档展开。")}
        </small>
      </label>
      <label className="settings-field" htmlFor="analysis-prompt-card">
        <span>{t("关注卡写作指导")}</span>
        <textarea
          id="analysis-prompt-card"
          value={cardWriting}
          onChange={(event) => {
            setCardWriting(event.target.value);
            setError("");
            setNotice("");
          }}
          disabled={busy || !saved}
          rows={3}
          aria-describedby="analysis-prompt-card-help"
        />
        <small id="analysis-prompt-card-help">
          {t("说明希望关注的场景、痛点和期待，或提供你认可的卡片示例。")}
        </small>
      </label>
      <div className="settings-actions">
        <button
          className="button button-primary"
          onClick={() => void save()}
          disabled={busy || !dirty || Boolean(fieldError)}
        >
          {busy ? t("正在保存…") : t("保存提示词")}
        </button>
        <button
          className="button button-quiet"
          onClick={() => void reset()}
          disabled={busy || !saved || (!saved.customized && !dirty)}
        >
          {t("清除补充信息")}
        </button>
        {dirty && <span>{t("有尚未保存的修改")}</span>}
      </div>
      {fieldError && dirty && (
        <p className="notice notice-warm" role="alert">
          {fieldError}
        </p>
      )}
      {error && (
        <p className="notice notice-warm" role="alert">
          {t(error)}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
