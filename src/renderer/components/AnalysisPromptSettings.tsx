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
    void bridge.analysisPromptView().then((result) => {
      if (!active) return;
      if (result.ok) applyView(result.value);
      else setError(result.message);
    }).catch(() => {
      if (active) setError("无法读取项目分析提示词配置");
    });
    return () => { active = false; };
  }, []);

  const dirty = Boolean(saved && (
    analysisGoal !== saved.analysisGoal || cardWriting !== saved.cardWriting
  ));
  const fieldError = !analysisGoal.trim() || !cardWriting.trim()
    ? "请填写分析目标和卡片写作指导。"
    : analysisGoal.trim().length > 4000 || cardWriting.trim().length > 4000
      ? "每个字段最多填写 4000 个字符。"
      : "";

  const save = async () => {
    if (fieldError) { setError(fieldError); return; }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await bridge.saveAnalysisPrompt({ analysisGoal, cardWriting });
      if (result.ok) {
        applyView(result.value);
        setNotice("已保存；后续分析使用这一版提示词。");
      } else setError(result.message);
    } catch {
      setError("提示词配置未保存，请重试。");
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
        setNotice("已恢复默认提示词；后续分析使用默认内容。");
      } else setError(result.message);
    } catch {
      setError("默认提示词恢复失败，请重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section analysis-prompt-settings" aria-labelledby="analysis-prompt-title">
      <div className="settings-section-heading">
        <div>
          <h3 id="analysis-prompt-title">项目分析提示词</h3>
          <p>调整分析重点和关注卡写法。证据引用、输出格式和资料边界由应用固定。</p>
        </div>
        <span className={`status-tag ${saved?.customized ? "status-active" : "status-paused"}`}>
          {saved?.customized ? "自定义" : "默认"}
        </span>
      </div>
      <label className="settings-field" htmlFor="analysis-prompt-goal">
        <span>分析目标</span>
        <textarea
          id="analysis-prompt-goal"
          value={analysisGoal}
          onChange={(event) => { setAnalysisGoal(event.target.value); setError(""); setNotice(""); }}
          disabled={busy || !saved}
          rows={3}
          aria-describedby="analysis-prompt-goal-help"
        />
        <small id="analysis-prompt-goal-help">描述希望从项目资料中识别的长期目标、取舍和问题。</small>
      </label>
      <label className="settings-field" htmlFor="analysis-prompt-card">
        <span>关注卡写作指导</span>
        <textarea
          id="analysis-prompt-card"
          value={cardWriting}
          onChange={(event) => { setCardWriting(event.target.value); setError(""); setNotice(""); }}
          disabled={busy || !saved}
          rows={3}
          aria-describedby="analysis-prompt-card-help"
        />
        <small id="analysis-prompt-card-help">说明卡片应如何概括可持续关注的角度。</small>
      </label>
      <div className="settings-actions">
        <button className="button button-primary" onClick={() => void save()} disabled={busy || !dirty || Boolean(fieldError)}>
          {busy ? "正在保存…" : "保存提示词"}
        </button>
        <button className="button button-quiet" onClick={() => void reset()} disabled={busy || !saved || (!saved.customized && !dirty)}>
          恢复默认
        </button>
        {dirty && <span>有尚未保存的修改</span>}
      </div>
      {fieldError && dirty && <p className="notice notice-warm" role="alert">{fieldError}</p>}
      {error && <p className="notice notice-warm" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
    </section>
  );
}
