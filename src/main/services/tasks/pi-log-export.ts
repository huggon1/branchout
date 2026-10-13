import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dialog, shell } from "electron";
import { z } from "zod";

/** Copy each native Pi page intact. Source JSONL stays inside the application profile. */
export async function exportTaskPiLogs(
  traceRoots: string[],
  taskId: string,
): Promise<string | undefined> {
  const id = z.string().uuid().parse(taskId);
  const pages: { source: string; name: string; executionId: string }[] = [];
  for (const [rootIndex, root] of traceRoots.entries()) {
    const taskRoot = join(root, id);
    const readDirectory = async (directory: string) => {
      try {
        return await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    };
    const collect = async (directory: string, executionId: string) => {
      for (const entry of await readDirectory(directory)) {
        if (
          !entry.isFile() ||
          !/^(?:session|attempt-\d+)\.html$/.test(entry.name)
        )
          continue;
        pages.push({
          source: join(directory, entry.name),
          name: `${rootIndex}-${executionId}-${entry.name}`,
          executionId,
        });
      }
    };
    await collect(join(taskRoot, "html"), "legacy");
    for (const execution of await readDirectory(join(taskRoot, "executions"))) {
      if (
        execution.isDirectory() &&
        z.string().uuid().safeParse(execution.name).success
      )
        await collect(
          join(taskRoot, "executions", execution.name, "html"),
          execution.name,
        );
    }
  }
  if (!pages.length) throw new Error("该任务尚无可导出的 Pi 会话记录");
  const selected = await dialog.showOpenDialog({
    title: "导出 Pi 会话记录",
    message:
      "记录包含任务输入、平台回答和浏览器工具记录。请选择可信的本地目录。",
    properties: ["openDirectory", "createDirectory"],
  });
  if (selected.canceled || !selected.filePaths[0]) return undefined;
  const destination = join(
    selected.filePaths[0],
    `Branchout-task-${id.slice(0, 8)}-${Date.now()}`,
  );
  await mkdir(destination, { recursive: false, mode: 0o700 });
  for (const page of pages)
    await copyFile(page.source, join(destination, page.name));
  await writeFile(
    join(destination, "manifest.json"),
    JSON.stringify(
      {
        taskId: id,
        exportedAt: new Date().toISOString(),
        sessions: pages.map(({ name, executionId }) => ({
          file: name,
          executionId,
        })),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  const error = await shell.openPath(destination);
  if (error) throw new Error("Pi 记录已导出，请从所选目录打开");
  return destination;
}
