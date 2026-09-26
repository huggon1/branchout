import { ipcMain } from "electron";
import { z } from "zod";
import {
  analysisChannels,
  type ProjectAnalysisPreflight,
} from "../../../shared/ipc-contracts";

export interface ProjectAnalysisIpcService {
  preflight(projectId: string): Promise<ProjectAnalysisPreflight>;
  start(input: unknown): Promise<string>;
  retry(taskId: string): Promise<string>;
  cancel(taskId: string): Promise<void>;
}

export function registerProjectAnalysisPipelineIpc(
  service: ProjectAnalysisIpcService,
  expected: string,
) {
  for (const channel of Object.values(analysisChannels))
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (
        !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== expected ||
        args.length !== 1
      )
        return { ok: false, message: "无效的项目分析请求" };
      try {
        let value: unknown;
        if (channel === analysisChannels.preflight)
          value = await service.preflight(z.string().uuid().parse(args[0]));
        else if (channel === analysisChannels.start)
          value = await service.start(args[0]);
        else if (channel === analysisChannels.retry)
          value = await service.retry(z.string().uuid().parse(args[0]));
        else await service.cancel(z.string().uuid().parse(args[0]));
        return { ok: true, value };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "项目分析操作未完成";
        return { ok: false, message: message.slice(0, 500) };
      }
    });
}
