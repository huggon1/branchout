import type { ReadingMaterial } from "../shared/reading-contracts";
import type { TaskSnapshot } from "../shared/task-contracts";
import type { ModelReply } from "../shared/model-contracts";
import { bridge } from "./bridge";
import { t, tf } from "./i18n";

export interface UiForwardingReport {
  materials?: ReadingMaterial[];
  outputLanguage?: "zh-CN" | "en";
  materialId: string;
  taskId: string;
  title: string;
  platform: "github" | "x" | "xiaohongshu" | "web";
  sourceUrl: string;
  sourceIdentity: string;
  fetchedAt: string;
  completedAt?: string;
  summary: string;
  reportState: "complete" | "partial" | "processing";
  stageLabel: string;
  taskMessage?: string;
}
export interface UiTaskActivity {
  body?: string;
  sequence: number;
  occurredAt: string;
  summary: string;
  completed?: number;
  total?: number;
}
export interface UiTask {
  taskId: string;
  kind: TaskSnapshot["kind"];
  label: string;
  targetLabel: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  phase: string;
  processed?: number;
  total?: number;
  updatedAt: string;
  activities: UiTaskActivity[];
  resultId?: string;
  resultType?: "content" | "search";
  partialResultId?: string;
  error?: string;
  resultDeleted?: boolean;
}
export interface UiContentWorkspace {
  reports: UiForwardingReport[];
  tasks: UiTask[];
  partialReports?: UiForwardingReport[];
}
export interface UiSettings {
  telegram: {
    configured: boolean;
    connected: boolean;
    status: string;
    chats: Array<{ chatId: string; label: string; allowed: boolean }>;
    pendingChats: Array<{ chatId: string; label: string; lastSeenAt: string }>;
    pendingCount: number;
    lastPollAt?: string;
    error?: string;
  };
  sources: Array<{
    id: "github" | "x" | "xiaohongshu";
    label: string;
    status: "ready" | "needs_login" | "unavailable";
    enabled: boolean;
    detail: string;
  }>;
}

export interface ProductUiBridge {
  uiContent(): Promise<ModelReply<UiContentWorkspace>>;
  uiAddLink(url: string): Promise<ModelReply<string>>;
  uiCancelTask(taskId: string): Promise<ModelReply<void>>;
  uiSettings(): Promise<ModelReply<UiSettings>>;
  uiSaveTelegramToken(token: string): Promise<ModelReply<void>>;
  uiClearTelegramBotToken(): Promise<ModelReply<void>>;
  uiVerifyTelegramBot(): Promise<ModelReply<void>>;
  uiAuthorizeTelegramChat(chatId: string): Promise<ModelReply<void>>;
  uiRevokeTelegramChat(chatId: string): Promise<ModelReply<void>>;
  uiOpenSource(materialId: string): Promise<ModelReply<void>>;
  uiChanged(listener: () => void): () => void;
}
const failed = <T>(message: string): ModelReply<T> => ({ ok: false, message });

export function productUiBridge(): ProductUiBridge {
  const replyOperation = async <T>(
    operation: (() => Promise<ModelReply<T>>) | undefined,
    name: string,
  ) => (operation ? operation() : failed<T>(tf("{0} 服务尚未连接。", name)));
  return {
    uiContent: async () => {
      const [taskReply, forwardingReply] = await Promise.all([
        bridge.unifiedTaskSnapshots(),
        bridge.forwardingTasks(),
      ]);
      if (!taskReply.ok) return taskReply;
      if (!forwardingReply.ok) return forwardingReply;
      const summaries = forwardingReply.value;
      const summaryById = new Map(summaries.map((s) => [s.taskId, s]));
      const reports: UiForwardingReport[] = [];
      const partialReports: UiForwardingReport[] = [];
      for (const summary of summaries) {
        const reply = await bridge.forwardingTask(summary.taskId);
        if (!reply.ok) continue;
        const detail = reply.value;
        const materials =
          detail.task.report?.materials ?? detail.partial.materials;
        const source = detail.task.report?.source ?? detail.partial.source;
        const host = new URL(summary.target.sourceUrl).hostname;
        const report: UiForwardingReport = {
          materials,
          outputLanguage: detail.task.outputLanguage,
          materialId: summary.materialId,
          taskId: summary.taskId,
          title:
            source?.title || materials?.[0]?.title || summary.target.sourceUrl,
          platform:
            source?.platform ??
            (host === "x.com"
              ? "x"
              : host.endsWith("xiaohongshu.com")
                ? "xiaohongshu"
                : host === "github.com"
                  ? "github"
                  : "web"),
          sourceUrl: summary.target.sourceUrl,
          sourceIdentity: source?.sourceIdentity ?? host,
          fetchedAt: summary.createdAt,
          completedAt: summary.finishedAt,
          summary: materials?.[0]?.summary ?? "",
          reportState:
            summary.state === "completed"
              ? "complete"
              : ["running", "queued"].includes(summary.state)
                ? "processing"
                : "partial",
          stageLabel: summary.phase,
          taskMessage: summary.message,
        };
        if (detail.task.report) reports.push(report);
        else partialReports.push(report);
      }
      const byTask = new Map(
        [...reports, ...partialReports].map((r) => [r.taskId, r]),
      );
      const tasks = await Promise.all(
        taskReply.value.map(async (task): Promise<UiTask> => {
          const summary = summaryById.get(task.taskId);
          const report = byTask.get(task.taskId);
          const activityReply = await bridge.taskActivities(task.taskId);
          return {
            taskId: task.taskId,
            kind: task.kind,
            label:
              task.label || (report ? tf("解析 {0}", report.title) : t("搜索")),
            resultDeleted: task.resultDeleted,
            targetLabel:
              task.label ||
              (report
                ? `${report.platform.toUpperCase()} · ${report.sourceIdentity}`
                : t("搜索")),
            status: task.state === "awaiting_user" ? "running" : task.state,
            phase:
              summary?.phase ??
              (task.state === "completed"
                ? t("已完成")
                : task.state === "failed"
                  ? t("搜索失败")
                  : task.state === "cancelled"
                    ? t("已取消")
                    : task.phase),
            processed: task.progress.completed,
            total: task.progress.total,
            updatedAt: task.updatedAt,
            activities: activityReply.ok
              ? activityReply.value.map((a) => ({
                  sequence: a.sequence,
                  occurredAt: a.happenedAt,
                  summary: a.summary,
                  body: a.body,
                  completed: a.progress?.completed,
                  total: a.progress?.total,
                }))
              : [],
            resultId: task.result?.id,
            resultType: task.result
              ? task.kind === "forwarding"
                ? "content"
                : "search"
              : undefined,
            partialResultId:
              summary?.hasSource || summary?.hasMaterials
                ? summary.materialId
                : undefined,
            error: summary?.message ?? task.failure?.message,
          };
        }),
      );
      return { ok: true, value: { tasks, reports, partialReports } };
    },
    uiAddLink: (url) => bridge.addLink(url),
    uiCancelTask: async (taskId) => {
      const reply = await bridge.unifiedTaskSnapshots();
      if (!reply.ok) return reply;
      const task = reply.value.find((t) => t.taskId === taskId);
      if (!task) return failed("Task unavailable");
      return task.kind === "focus_search"
        ? bridge.cancelFocusSearch(taskId)
        : bridge.cancelForwarding(taskId);
    },
    uiSettings: async () => {
      if (!bridge.telegramStatus)
        return failed(t("Telegram 设置服务尚未连接。"));
      const [telegramReply, xReply, xhsReply] = await Promise.all([
        bridge.telegramStatus(),
        bridge.xStatus(),
        bridge.xhsStatus(),
      ]);
      if (!telegramReply.ok) return telegramReply;
      if (!xReply.ok) return xReply;
      if (!xhsReply.ok) return xhsReply;
      const telegram = telegramReply.value;
      const chatTitle = new Map(
        telegram.pendingChats.map((chat) => [chat.chatId, chat.title]),
      );
      return {
        ok: true,
        value: {
          telegram: {
            configured: telegram.configured,
            connected: telegram.status === "polling",
            status:
              telegram.status === "polling"
                ? t("正在接收消息")
                : telegram.status === "failed"
                  ? t("连接失败")
                  : telegram.configured
                    ? t("等待接收消息")
                    : t("未连接"),
            chats: telegram.authorizedChatIds.map((chatId) => ({
              chatId,
              label: chatTitle.get(chatId) ?? chatId,
              allowed: true,
            })),
            pendingChats: telegram.pendingChats
              .filter(
                (chat) => !telegram.authorizedChatIds.includes(chat.chatId),
              )
              .map((chat) => ({
                chatId: chat.chatId,
                label: chat.title || chat.username || chat.chatId,
                lastSeenAt: chat.lastSeenAt,
              })),
            pendingCount: telegram.queued + telegram.pendingAcknowledgements,
            lastPollAt: telegram.lastPollAt,
            error: telegram.lastError,
          },
          sources: [
            {
              id: "github",
              label: "GitHub",
              status: "ready",
              enabled: true,
              detail: t("公开仓库 README · 直接读取"),
            },
            {
              id: "x",
              label: "X",
              status: xReply.value.signedIn ? "ready" : "needs_login",
              enabled: true,
              detail: xReply.value.signedIn
                ? t("帖子读取使用当前已连接账号。")
                : t("登录 X 后读取当前账号可访问的帖子。"),
            },
            {
              id: "xiaohongshu",
              label: t("小红书"),
              status: !xhsReply.value.installed
                ? "unavailable"
                : xhsReply.value.signedIn
                  ? "ready"
                  : "needs_login",
              enabled: true,
              detail: !xhsReply.value.installed
                ? t("本地读取组件尚未安装。")
                : xhsReply.value.signedIn
                  ? t("图文笔记读取账号已连接。")
                  : t("登录后读取受支持的图文笔记。"),
            },
          ],
        },
      };
    },
    uiSaveTelegramToken: (token) =>
      replyOperation(
        bridge.saveTelegramBotToken
          ? () => bridge.saveTelegramBotToken!(token)
          : undefined,
        t("保存 Telegram 凭据"),
      ),
    uiClearTelegramBotToken: () =>
      replyOperation(
        bridge.clearTelegramBotToken
          ? () => bridge.clearTelegramBotToken!()
          : undefined,
        t("清除 Telegram 凭据"),
      ),
    uiVerifyTelegramBot: async () => {
      const reply = await replyOperation(
        bridge.verifyTelegramBot
          ? () => bridge.verifyTelegramBot!()
          : undefined,
        t("验证 Telegram Bot"),
      );
      return reply.ok ? { ok: true, value: undefined } : reply;
    },
    uiAuthorizeTelegramChat: (chatId) =>
      replyOperation(
        bridge.authorizeTelegramChat
          ? () => bridge.authorizeTelegramChat!(chatId)
          : undefined,
        t("授权 Telegram 聊天"),
      ),
    uiRevokeTelegramChat: (chatId) =>
      replyOperation(
        bridge.revokeTelegramChat
          ? () => bridge.revokeTelegramChat!(chatId)
          : undefined,
        t("撤销 Telegram 聊天"),
      ),
    uiOpenSource: (materialId) => bridge.openSource(materialId),
    uiChanged: (listener) => bridge.onChanged(listener),
  };
}
