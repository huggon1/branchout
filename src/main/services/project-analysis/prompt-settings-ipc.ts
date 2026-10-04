import { handle } from "../../ipc";
import { ZodError } from "zod";
import { analysisPromptChannels } from "../../../shared/ipc-contracts";
import { AnalysisPromptSettingsService } from "./prompt-settings-service";

export function registerAnalysisPromptSettingsIpc(
  service: AnalysisPromptSettingsService,
  expected: string,
): void {
  for (const channel of Object.values(analysisPromptChannels)) {
    handle(channel, async (event, ...args: unknown[]) => {
      if (
        !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== expected
      )
        return { ok: false, message: "无效的界面请求" };
      if (args.length !== (channel === analysisPromptChannels.save ? 1 : 0))
        return { ok: false, message: "无效的请求参数" };
      try {
        const value =
          channel === analysisPromptChannels.view
            ? service.view()
            : channel === analysisPromptChannels.save
              ? await service.save(
                  args[0] as Parameters<typeof service.save>[0],
                )
              : await service.reset();
        return { ok: true, value };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof ZodError
              ? "分析目标和卡片写作指导各需填写 1 到 4000 个字符"
              : "提示词配置未保存，请稍后重试",
        };
      }
    });
  }
}
