import { dialog, ipcMain } from "electron";
import { z } from "zod";
import { explorationChannels } from "../../shared/ipc-contracts";
import {
  graphGenerationInputSchema,
  repositoryAnalysisRequestSchema,
} from "../../shared/exploration-contracts";
import type { ExplorationService } from "./exploration-service";
import type { ProjectService } from "./project-service";

export function registerExplorationIpc(
  service: ExplorationService,
  projects: ProjectService,
  expected: string,
) {
  for (const channel of Object.values(explorationChannels))
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const argc = [
        explorationChannels.view,
        explorationChannels.tasks,
        explorationChannels.bind,
      ].includes(channel as never)
        ? 0
        : channel === explorationChannels.currentGraph
          ? 2
          : 1;
      if (
        !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== expected ||
        args.length !== argc
      )
        return { ok: false, message: "无效的项目请求" };
      try {
        if (channel === explorationChannels.view)
          return { ok: true, value: service.view() };
        if (channel === explorationChannels.tasks)
          return { ok: true, value: service.taskSnapshots() };
        if (channel === explorationChannels.bind) {
          const picked = await dialog.showOpenDialog({
            title: "选择本地 Git 仓库根目录",
            properties: ["openDirectory"],
          });
          if (picked.canceled || !picked.filePaths[0])
            return { ok: true, value: undefined };
          const projectId = await projects.bind(picked.filePaths[0]);
          const project = projects
            .view()
            .projects.find((item) => item.projectId === projectId);
          if (!project) throw new Error("本地项目绑定未保存");
          await service.bind({
            projectId,
            projectLabel: project.name,
            directory: project.directory,
          });
          return { ok: true, value: projectId };
        }
        if (channel === explorationChannels.unbind) {
          const projectId = z.string().uuid().parse(args[0]);
          await projects.unbind(projectId);
          await service.unbind(projectId);
          return { ok: true, value: undefined };
        }
        if (channel === explorationChannels.currentGraph) {
          const projectId = z.string().uuid().parse(args[0]);
          const direction = z
            .enum(["uiux", "functional_modules"])
            .parse(args[1]);
          return {
            ok: true,
            value: service.currentGraph(projectId, direction),
          };
        }
        if (channel === explorationChannels.readGraph) {
          const graph = service.readGraph(z.string().uuid().parse(args[0]));
          if (!graph) throw new Error("项目图版本不存在");
          return { ok: true, value: graph };
        }
        if (channel === explorationChannels.generateGraph)
          return {
            ok: true,
            value: await service.startGraph(
              graphGenerationInputSchema.parse(args[0]),
            ),
          };
        if (channel === explorationChannels.analyzeRepository)
          return {
            ok: true,
            value: await service.startAnalysis(
              repositoryAnalysisRequestSchema.parse(args[0]),
            ),
          };
        await service.cancel(z.string().uuid().parse(args[0]));
        return { ok: true, value: undefined };
      } catch (error) {
        const message = error instanceof Error ? error.message : "操作未完成";
        return { ok: false, message: message.slice(0, 1000) };
      }
    });
}
