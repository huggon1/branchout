import { nativeText, nativeLanguage } from "../../native-language";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { dialog, shell } from "electron";
import { z } from "zod";

const traceLineageSchema = z
  .object({
    taskIds: z.array(z.string().uuid()).min(1).max(100),
  })
  .strict();

async function readLineage(
  traceRoot: string,
  taskId: string,
): Promise<string[]> {
  try {
    const raw = await readFile(join(traceRoot, taskId, "lineage.json"), "utf8");
    const taskIds = traceLineageSchema.parse(JSON.parse(raw)).taskIds;
    if (taskIds.at(-1) !== taskId || new Set(taskIds).size !== taskIds.length)
      throw new Error("invalid trace lineage");
    return taskIds;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [taskId];
    throw new Error("项目分析记录来源无法读取，原文件已保留");
  }
}

export async function recordProjectAnalysisTraceLineage(
  traceRoot: string,
  taskId: string,
  previousTaskId?: string,
): Promise<void> {
  const id = z.string().uuid().parse(taskId);
  const previous = previousTaskId
    ? await readLineage(traceRoot, z.string().uuid().parse(previousTaskId))
    : [];
  const taskIds = traceLineageSchema.parse({
    taskIds: [...previous, id],
  }).taskIds;
  const directory = join(traceRoot, id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `lineage.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify({ taskIds }), {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, join(directory, "lineage.json"));
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

export async function exportProjectAnalysisTrace(
  traceRoot: string,
  taskId: string,
): Promise<string | undefined> {
  const taskIds = await readLineage(traceRoot, z.string().uuid().parse(taskId));
  const sources = await Promise.all(
    taskIds.map(async (id, index) => {
      try {
        const files = (await readdir(join(traceRoot, id, "html")))
          .filter((name) => /^(?:batch-\d+-)?attempt-\d+\.html$/.test(name))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        return { id, index, files };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return { id, index, files: [] };
        throw new Error("项目分析记录无法读取，原文件已保留");
      }
    }),
  );
  if (sources.every((source) => !source.files.length))
    throw new Error(
      "该任务尚无可导出的 Pi 会话记录；模型首次回复前的错误可在任务活动中查看",
    );
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
    `Branchout-analysis-${taskId.slice(0, 8)}-${Date.now()}`,
  );
  await mkdir(destination, { recursive: false, mode: 0o700 });
  const links: string[] = [];
  for (const source of sources) {
    if (!source.files.length) continue;
    const runDirectory = sources.length === 1 ? "" : `run-${source.index + 1}`;
    if (runDirectory)
      await mkdir(join(destination, runDirectory), { mode: 0o700 });
    for (const file of source.files) {
      await copyFile(
        join(traceRoot, source.id, "html", file),
        join(destination, runDirectory, file),
      );
      const relative = runDirectory ? `${runDirectory}/${file}` : file;
      const attempt = /attempt-(\d+)\.html$/.exec(file)?.[1];
      links.push(
        `<li><a href="${escapeHtml(relative)}">${nativeText(`第 ${source.index + 1} 次运行 · 第 ${attempt ?? "?"} 次模型请求`, `Run ${source.index + 1} · Model request ${attempt ?? "?"}`)}</a></li>`,
      );
    }
  }
  const index = `<!doctype html><html lang="${nativeLanguage()}"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${nativeText("Branchout 分析记录", "Branchout analysis traces")}</title><style>body{font:16px system-ui;max-width:48rem;margin:3rem auto;padding:0 1rem;line-height:1.6}a{color:#245b43}</style><h1>${nativeText("项目分析记录", "Project-analysis traces")}</h1><p>${nativeText("这些页面包含本次分析的项目资料与对话内容。", "These pages contain project materials and conversations from this analysis.")}</p><ol>${links.join("\n")}</ol></html>`;
  const indexFile = join(destination, "index.html");
  await writeFile(indexFile, index, { mode: 0o600 });
  await shell.openPath(indexFile);
  return destination;
}
