import { randomUUID } from "node:crypto";
import {
  startFocusSearchSchema,
  type FocusSearchReport,
  type SearchSection,
  type SearchAddition,
} from "../../../shared/focus-search-contracts";
import { FocusSearchStore } from "../../storage/focus-search-store";
import type { FocusCardService } from "../focus-cards/focus-card-service";
import type { TaskService } from "../tasks/task-service";
import type { ForwardingPipelineService } from "../forwarding/service";
import { searchInstruction } from "../../../platforms/browser/prompts";
const now = () => new Date().toISOString();
export class FocusSearchService {
  private active = new Map<string, AbortController>();
  private queue: Promise<unknown> = Promise.resolve();
  private mutations: Promise<unknown> = Promise.resolve();
  constructor(
    private store: FocusSearchStore,
    private cards: FocusCardService,
    private tasks: TaskService,
    private forwarding: ForwardingPipelineService,
    private prepareExecution: () => Promise<{
      execute: (
        section: SearchSection,
        signal: AbortSignal,
      ) => Promise<{
        rawReply: string;
        candidates: SearchSection["candidates"];
        platformPrompt?: string;
        warnings?: string[];
      }>;
      release: () => Promise<void>;
    }>,
    private changed: () => void,
  ) {}
  reports() {
    return this.store.snapshot().reports;
  }
  readTask(taskId: string) {
    const report = this.reports().find((r) => r.taskId === taskId);
    if (!report) throw new Error("Search report not found");
    return report;
  }
  async recover() {
    await this.store.update((state) => {
      for (const report of state.reports)
        for (const section of report.sections)
          if (section.state === "running" || section.state === "pending") {
            section.state = "failed";
            section.error = "上次搜索中断，请重试继续";
          }
    });
  }
  async start(raw: unknown) {
    const input = startFocusSearchSchema.parse(raw);
    const snapshot = this.cards.retainedSnapshot();
    snapshot.cards = snapshot.cards.filter((c) =>
      input.focusIds.includes(c.focusId),
    );
    if (snapshot.cards.length !== input.focusIds.length)
      throw new Error("Selected cards changed or are unavailable");
    const taskId = randomUUID();
    const report: FocusSearchReport = {
      reportId: randomUUID(),
      taskId,
      createdAt: now(),
      period: input.period,
      platforms: input.platforms,
      focusSet: snapshot,
      submissions: [],
      sections: input.platforms.flatMap((platform) =>
        snapshot.cards.map((card) => ({
          sectionId: randomUUID(),
          focusId: card.focusId,
          platform,
          promptLanguage: platform === "x" ? "en" : "zh-CN",
          prompt: searchInstruction(platform, card.content, input.period),
          state: "pending" as const,
          rawReply: "",
          candidates: [],
        })),
      ),
    };
    await this.store.update((s) => s.reports.push(report));
    await this.tasks.create({
      taskId,
      kind: "focus_search",
      target: { kind: "none" },
      phase: "搜索讨论",
      focusSetSnapshot: snapshot,
    });
    this.enqueue(taskId);
    this.changed();
    return taskId;
  }
  private enqueue(taskId: string) {
    const controller = new AbortController();
    this.active.set(taskId, controller);
    const run = this.queue
      .catch(() => {})
      .then(() => this.run(taskId, controller));
    this.queue = run.catch(() => {});
  }
  private async run(taskId: string, controller: AbortController) {
    let execution:
      Awaited<ReturnType<FocusSearchService["prepareExecution"]>> | undefined;
    try {
      if (controller.signal.aborted) return;
      execution = await this.prepareExecution();
      for (const initial of this.readTask(taskId).sections) {
        if (controller.signal.aborted) break;
        if (initial.state === "completed") continue;
        await this.store.update((s) => {
          const section = s.reports
            .find((r) => r.taskId === taskId)!
            .sections.find((v) => v.sectionId === initial.sectionId)!;
          section.state = "running";
          delete section.error;
        });
        this.changed();
        await this.tasks.receive(taskId, {
          type: "activity",
          taskId,
          action: "search",
          summary: `正在搜索 ${initial.platform === "x" ? "X" : "小红书"} 的一张关注卡`,
          target: {
            kind: "focus_card",
            id: initial.focusId,
            label: this.readTask(taskId)
              .focusSet.cards.find((card) => card.focusId === initial.focusId)!
              .content.split("\n")[0]
              .slice(0, 300),
          },
        });
        try {
          const result = await execution.execute(initial, controller.signal);
          if (controller.signal.aborted) break;
          await this.store.update((s) => {
            const section = s.reports
              .find((r) => r.taskId === taskId)!
              .sections.find((v) => v.sectionId === initial.sectionId)!;
            Object.assign(section, result, {
              state: "completed",
              finishedAt: now(),
            });
          });
        } catch (error) {
          if (controller.signal.aborted) break;
          const code = error instanceof Error ? error.message : "";
          const accessMessages: Record<string, string> = {
            login_required: "请在设置中登录平台后重试",
            verification_required: "请在平台浏览器中完成验证后重试",
            access_limited: "平台访问受限，请稍后重试",
            browser_interaction_failed: "平台页面操作未完成，请重试",
          };
          await this.store.update((s) => {
            const section = s.reports
              .find((r) => r.taskId === taskId)!
              .sections.find((v) => v.sectionId === initial.sectionId)!;
            section.state = "failed";
            section.error =
              accessMessages[code] ??
              "搜索失败，请检查平台登录和模型设置后重试";
            section.finishedAt = now();
          });
        }
        const report = this.readTask(taskId);
        await this.tasks.receive(taskId, {
          type: "progress",
          taskId,
          completed: report.sections.filter(
            (s) => s.state === "completed" || s.state === "failed",
          ).length,
          total: report.sections.length,
        });
        this.changed();
      }
      if (!controller.signal.aborted) {
        const report = this.readTask(taskId);
        if (report.sections.every((section) => section.state === "failed"))
          await this.tasks.receive(taskId, {
            type: "failed",
            taskId,
            code: "search_failed",
            message: "所有平台搜索均未完成，请检查登录和模型设置后重试",
          });
        else
          await this.tasks.receive(taskId, {
            type: "completed",
            taskId,
            result: { kind: "focus_search_report", id: report.reportId },
          });
      }
    } catch {
      await this.store.update((state) => {
        const report = state.reports.find((r) => r.taskId === taskId);
        for (const section of report?.sections ?? [])
          if (section.state !== "completed") {
            section.state = "failed";
            section.error = "搜索启动失败，请检查模型连接或平台设置后重试";
          }
      });
      await this.tasks.receive(taskId, {
        type: "failed",
        taskId,
        code: "search_failed",
        message: "Search could not be saved or started",
      });
    } finally {
      await execution?.release();
      if (controller.signal.aborted)
        await this.store.update((state) => {
          const report = state.reports.find((r) => r.taskId === taskId);
          for (const section of report?.sections ?? [])
            if (section.state === "running" || section.state === "pending") {
              section.state = "failed";
              section.error = "搜索已停止，请重试继续";
            }
        });
      this.active.delete(taskId);
      this.changed();
    }
  }
  async retry(taskId: string) {
    if (this.active.has(taskId)) throw new Error("Search is already running");
    const previous = this.readTask(taskId);
    if (!previous.sections.some((s) => s.state !== "completed"))
      throw new Error("All sections completed");
    // A retry has a fresh task identity, retaining the original frozen report inputs.
    const next = structuredClone(previous);
    next.taskId = randomUUID();
    next.reportId = randomUUID();
    next.createdAt = now();
    for (const section of next.sections)
      if (section.state !== "completed") {
        section.sectionId = randomUUID();
        section.state = "pending";
        delete section.error;
      }
    await this.store.update((s) => s.reports.push(next));
    await this.tasks.create({
      taskId: next.taskId,
      kind: "focus_search",
      target: { kind: "none" },
      phase: "搜索讨论",
      focusSetSnapshot: next.focusSet,
    });
    this.enqueue(next.taskId);
    this.changed();
    return next.taskId;
  }
  async cancel(taskId: string) {
    this.active.get(taskId)?.abort();
    await this.tasks.cancel(taskId);
  }
  add(reportId: string, candidateIds: string[]): Promise<SearchAddition[]> {
    const operation = this.mutations
      .catch(() => {})
      .then(async () => {
        const reply: SearchAddition[] = [];
        for (const candidateId of new Set(candidateIds)) {
          try {
            const report = this.reports().find((r) => r.reportId === reportId);
            if (!report) throw new Error("Report unavailable");
            const candidate = report.sections
              .flatMap((s) => s.candidates)
              .find((c) => c.candidateId === candidateId);
            if (!candidate) throw new Error("Candidate unavailable");
            let submission = report.submissions.find(
              (s) => s.postKey === candidate.postKey,
            );
            if (!submission) {
              submission = {
                postKey: candidate.postKey,
                taskId: randomUUID(),
                resultId: randomUUID(),
                submitted: false,
              };
              const reserved = submission;
              await this.store.update((s) =>
                s.reports
                  .find((r) => r.reportId === reportId)!
                  .submissions.push(reserved),
              );
            }
            const taskId = await this.forwarding.submit(
              candidate.url,
              submission,
            );
            await this.store.update((s) => {
              s.reports
                .find((r) => r.reportId === reportId)!
                .submissions.find(
                  (v) => v.postKey === candidate.postKey,
                )!.submitted = true;
            });
            reply.push({ candidateId, taskId });
          } catch {
            reply.push({
              candidateId,
              error: "Could not add this post; retry",
            });
          }
        }
        this.changed();
        return reply;
      });
    this.mutations = operation.catch(() => {});
    return operation;
  }
  async shutdown() {
    for (const [taskId, controller] of this.active) {
      controller.abort();
      await this.tasks.cancel(taskId);
    }
    await this.queue.catch(() => {});
    await this.mutations.catch(() => {});
  }
}
