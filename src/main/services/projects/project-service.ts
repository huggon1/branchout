import { randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { basename } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { ProjectBinding, ProjectState } from "../../../shared/project-contracts";
import { ProjectStore } from "../../storage/project-store";

const execFile = promisify(execFileCallback);
const now = () => new Date().toISOString();

async function validateGitProject(directory: string) {
  const candidate = z.string().min(1).max(4096).parse(directory);
  const canonical = await realpath(candidate);
  if (!(await lstat(canonical)).isDirectory())
    throw new Error("请选择 Git 仓库根目录");

  const result = await execFile(
    process.platform === "win32" ? "git" : "/usr/bin/git",
    ["--no-optional-locks", "-C", canonical, "rev-parse", "--show-toplevel"],
    {
      timeout: 5000,
      maxBuffer: 8192,
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
      },
    },
  );
  const root = await realpath(result.stdout.trim());
  if (root !== canonical) throw new Error("请选择 Git 仓库根目录");
  return { directory: canonical, name: basename(canonical).slice(0, 300) };
}

export class ProjectService {
  constructor(
    private readonly store: ProjectStore,
    private readonly changed: () => void = () => {},
  ) {}

  view(): ProjectState {
    return this.store.snapshot();
  }

  async bind(directory: string): Promise<string> {
    const validated = await validateGitProject(directory);
    const timestamp = now();
    let projectId = "";
    let changed = false;
    await this.store.update((state) => {
      const existing = state.projects.find(
        (project) => project.directory === validated.directory,
      );
      if (existing) {
        projectId = existing.projectId;
        if (
          existing.status !== "bound" ||
          existing.name !== validated.name
        ) {
          existing.name = validated.name;
          existing.status = "bound";
          existing.boundAt = timestamp;
          delete existing.unboundAt;
          changed = true;
        }
        return;
      }
      const project: ProjectBinding = {
        projectId: randomUUID(),
        ...validated,
        status: "bound",
        boundAt: timestamp,
      };
      state.projects.push(project);
      projectId = project.projectId;
      changed = true;
    });
    if (changed) this.changed();
    return projectId;
  }

  async unbind(projectId: string): Promise<void> {
    const id = z.string().uuid().parse(projectId);
    let changed = false;
    await this.store.update((state) => {
      const project = state.projects.find((item) => item.projectId === id);
      if (!project || project.status === "history") return;
      project.status = "history";
      project.unboundAt = now();
      changed = true;
    });
    if (changed) this.changed();
  }
}
