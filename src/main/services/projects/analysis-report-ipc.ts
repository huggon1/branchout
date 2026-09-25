import { ipcMain } from "electron";
import { z } from "zod";
import { analysisChannels } from "../../../shared/ipc-contracts";
import type { ProjectAnalysisReportService } from "./analysis-report-service";

export function registerAnalysisReportIpc(
  service: ProjectAnalysisReportService,
  expected: string,
) {
  for (const channel of Object.values(analysisChannels)) {
    if (channel === analysisChannels.preflight || channel === analysisChannels.start)
      continue;
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const count =
        channel === analysisChannels.reports ? args.length : 1;
      if (
        !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== expected ||
        (channel === analysisChannels.reports
          ? count > 1
          : args.length !== 1)
      )
        return { ok: false, message: "无效的项目分析请求" };
      try {
        let value: unknown;
        if (channel === analysisChannels.reports) {
          const projectId =
            args.length === 0 || args[0] === undefined
              ? undefined
              : z.string().uuid().parse(args[0]);
          value = service.list(projectId);
        } else if (channel === analysisChannels.readReport) {
          const report = service.read(z.string().uuid().parse(args[0]));
          if (!report) throw new Error("项目分析报告不存在");
          value = report;
        } else value = await service.accept(args[0]);
        return { ok: true, value };
      } catch (error) {
        const message = error instanceof Error ? error.message : "项目分析请求未完成";
        return { ok: false, message: message.slice(0, 500) };
      }
    });
  }
}
