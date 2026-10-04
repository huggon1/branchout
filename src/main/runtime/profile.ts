import { claimProfile } from "./profile-lock";
import { z } from "zod";
import { taskStateSchema } from "../../shared/task-contracts";
import { analysisPromptSettingsSchema } from "../../shared/analysis-prompt-contracts";
import { languageSchema } from "../../shared/language";
import { projectAnalysisRunInputSchema } from "../services/project-analysis/pipeline-service";
import {
  cp,
  lstat,
  readdir,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { projectStateSchema } from "../../shared/project-contracts";
import { forwardingStateSchema } from "../services/forwarding/store";

const businessFiles = [
  "projects.json",
  "tasks.json",
  "project-analysis-inputs.json",
  "analysis-prompt.json",
  "forwarding.json",
  "preferences.json",
];
async function regularTree(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink())
    throw new Error("Profile entries must be regular local files");
  if (info.isDirectory())
    for (const name of await readdir(path)) await regularTree(join(path, name));
}
const authFiles = [
  "model-connection.json",
  "model-auth",
  "Partitions",
  "xiaohongshu",
  "telegram.json",
  "telegram-bot-token.json",
];
export async function assertInactive(directory: string) {
  try {
    const owner = JSON.parse(
      await readFile(join(directory, ".branchout-owner.json"), "utf8"),
    );
    if (!Number.isInteger(owner.pid) || owner.pid < 1)
      throw new Error("Invalid profile owner");
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      owner.pid = undefined;
    }
    if (owner.pid)
      throw new Error("Profile is in use; quit its application first");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // Electron also locks profiles created before the owner marker was introduced.
  try {
    await lstat(join(directory, "SingletonLock"));
    throw new Error("Profile is in use; quit its application first");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
export async function prepareProfile(
  destination: string,
  source?: string,
  includeAuth = false,
) {
  destination = resolve(destination);
  if (!source) {
    await mkdir(destination, { recursive: true, mode: 0o700 });
    return;
  }
  source = resolve(source);
  const sourceInfo = await lstat(source);
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink())
    throw new Error("Select a regular source profile directory");
  const release = claimProfile(source);
  try {
    await assertInactive(source);
    try {
      await lstat(destination);
      throw new Error("Destination already exists; select a new directory");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const stage = `${destination}.preparing-${randomUUID()}`;
    await mkdir(dirname(destination), { recursive: true });
    await mkdir(stage, { mode: 0o700 });
    try {
      for (const file of [
        ...businessFiles,
        ...(includeAuth ? authFiles : []),
      ]) {
        try {
          const path = join(source, file);
          await regularTree(path);
          await cp(path, join(stage, file), {
            recursive: true,
            dereference: false,
            errorOnExist: true,
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      for (const file of businessFiles) {
        try {
          const path = join(stage, file);
          const data = JSON.parse(await readFile(path, "utf8"));
          if (file === "preferences.json")
            z.object({ language: languageSchema }).strict().parse(data);
          if (file === "analysis-prompt.json")
            analysisPromptSettingsSchema.parse(data);
          if (file === "project-analysis-inputs.json")
            z.object({
              inputs: z.record(
                z.string().uuid(),
                projectAnalysisRunInputSchema,
              ),
            })
              .strict()
              .parse(data);
          if (file === "tasks.json") {
            taskStateSchema.parse(data);
            for (const task of data.tasks) {
              if (["queued", "running"].includes(task.state)) {
                task.state = "failed";
                task.phase = "interrupted";
                task.finishedAt = new Date().toISOString();
                task.failure = {
                  code: "interrupted",
                  message: "应用关闭时任务尚未完成",
                };
              }
            }
            taskStateSchema.parse(data);
          }
          if (file === "projects.json") projectStateSchema.parse(data);
          if (file === "forwarding.json") {
            forwardingStateSchema.parse(data);
            for (const task of data.tasks) {
              delete task.xhsAccessTokenCiphertext;
              if (["queued", "running"].includes(task.state)) {
                task.failureStage = task.source
                  ? task.generalUnderstanding
                    ? "relations"
                    : "understanding"
                  : "source";
                task.state = "failed";
                task.phase = "上次解析中断";
                task.message = "上次解析中断";
                task.finishedAt = new Date().toISOString();
              }
            }
          }
          if (file === "forwarding.json") forwardingStateSchema.parse(data);
          await writeFile(path, JSON.stringify(data), { mode: 0o600 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      await assertInactive(source);
      await rename(stage, destination);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  } finally {
    release();
  }
}
