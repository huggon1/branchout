import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dialog, shell } from "electron";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export async function exportProjectAnalysisTrace(traceRoot: string, taskId: string): Promise<string | undefined> {
  const source = join(traceRoot, taskId, "html");
  let files: string[];
  try {
    files = (await readdir(source)).filter((name) => /^batch-\d+-attempt-\d+\.html$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    files = [];
  }
  if (!files.length) throw new Error("该任务尚无可导出的 Pi 会话记录；模型首次回复前的错误可在任务活动中查看");
  const selected = await dialog.showOpenDialog({
    title: "导出项目分析记录",
    message: "记录包含本次分析读取的项目资料与对话内容，请选择可信的本地目录。",
    properties: ["openDirectory", "createDirectory"],
  });
  if (selected.canceled || !selected.filePaths[0]) return undefined;
  const destination = join(selected.filePaths[0], `Branchout-analysis-${taskId.slice(0, 8)}-${Date.now()}`);
  await mkdir(destination, { recursive: false, mode: 0o700 });
  for (const file of files) await copyFile(join(source, file), join(destination, file));
  const links = files.map((file) => `<li><a href="${escapeHtml(file)}">${escapeHtml(file.replace(/\.html$/, ""))}</a></li>`).join("\n");
  const index = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Branchout 分析记录</title><style>body{font:16px system-ui;max-width:48rem;margin:3rem auto;padding:0 1rem;line-height:1.6}a{color:#245b43}</style><h1>项目分析记录</h1><p>这些页面包含本次分析的项目资料与对话内容。</p><ol>${links}</ol></html>`;
  const indexFile = join(destination, "index.html");
  await writeFile(indexFile, index, { mode: 0o600 });
  await shell.openPath(indexFile);
  return destination;
}
