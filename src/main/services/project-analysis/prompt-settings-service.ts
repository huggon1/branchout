import {
  defaultAnalysisPromptSettings,
  projectAnalysisPromptRevision,
  type AnalysisPromptSettings,
  type AnalysisPromptSnapshot,
  type AnalysisPromptView,
} from "../../../shared/analysis-prompt-contracts";
import { AnalysisPromptStore } from "../../storage/analysis-prompt-store";

export class AnalysisPromptSettingsService {
  constructor(
    private readonly store: AnalysisPromptStore,
    private readonly changed: () => void,
  ) {}

  snapshot(): AnalysisPromptSnapshot {
    const settings = this.store.snapshot();
    return { ...settings, revision: projectAnalysisPromptRevision(settings) };
  }

  view(): AnalysisPromptView {
    const snapshot = this.snapshot();
    return {
      ...snapshot,
      customized: snapshot.analysisGoal !== defaultAnalysisPromptSettings.analysisGoal
        || snapshot.cardWriting !== defaultAnalysisPromptSettings.cardWriting,
    };
  }

  async save(settings: AnalysisPromptSettings): Promise<AnalysisPromptView> {
    await this.store.save(settings);
    this.changed();
    return this.view();
  }

  async reset(): Promise<AnalysisPromptView> {
    await this.store.save(defaultAnalysisPromptSettings);
    this.changed();
    return this.view();
  }
}
