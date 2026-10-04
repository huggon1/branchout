import { nativeText } from "../../native-language";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { dialog, shell } from "electron";
import { z } from "zod";

export async function exportProjectAnalysisTrace(
  traceRoot: string,
  taskId: string,
): Promise<string | undefined> {
  const id = z.string().uuid().parse(taskId);
  let latest: string | undefined;
  try {
    latest = (await readdir(join(traceRoot, id, "html")))
      .filter((name) => /^attempt-\d+\.html$/.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .at(-1);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("项目分析记录无法读取，原文件已保留");
  }
  if (!latest) throw new Error("该任务尚无可导出的 Pi 会话记录");
  const selected = await dialog.showOpenDialog({
    title: nativeText("导出项目分析记录", "Export project-analysis traces"),
    message: nativeText(
      "记录包含本次分析读取的项目资料与对话内容，请选择可信的本地目录。",
      "Traces include project materials and conversations read during analysis. Select a trusted local directory.",
    ),
    properties: ["openDirectory", "createDirectory"],
  });
  if (selected.canceled || !selected.filePaths[0]) return undefined;
  const destination = join(
    selected.filePaths[0],
    `Branchout-analysis-${id.slice(0, 8)}-${Date.now()}`,
  );
  await mkdir(destination, { recursive: false, mode: 0o700 });
  const file = join(destination, "analysis.html");
  await copyFile(join(traceRoot, id, "html", latest), file);
  const error = await shell.openPath(file);
  if (error) throw new Error("记录已导出，请从所选目录打开 analysis.html");
  return destination;
}
