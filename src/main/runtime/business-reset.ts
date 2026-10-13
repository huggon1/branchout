import {
  lstat,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { telegramStateSchema } from "../integrations/telegram/contracts";
import { claimProfile } from "./profile-lock";

// Deliberate allowlist: credentials, browser profiles, preferences and unknown
// entries remain in place. New search stores belong to the current generation.
export const legacyBusinessEntries = [
  "focus-search.json",
  "projects.json",
  "tasks.json",
  "project-analysis-inputs.json",
  "forwarding.json",
  "focus-search.json.tmp",
  "projects.json.tmp",
  "tasks.json.tmp",
  "project-analysis-inputs.json.tmp",
  "forwarding.json.tmp",
  "analysis-traces",
  "browser-traces",
  "material-images",
] as const;
const markerName = "business-generation.json";
export const businessGenerationSchema = z
  .object({
    generation: z.literal("search-follow-v1"),
    state: z.enum(["resetting", "committed"]),
  })
  .strict();

async function readOptional(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
async function assertRegularTree(path: string): Promise<void> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
    throw new Error("Business reset requires regular profile entries");
  if (info.isDirectory())
    for (const entry of await readdir(path))
      await assertRegularTree(join(path, entry));
}
async function replaceJson(path: string, value: unknown) {
  const temporary = `${path}.reset-tmp`;
  await assertRegularTree(temporary);
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}

/** Run before opening stores or starting Telegram/workers, under the app's
 * single-instance ownership. A failed reset aborts startup; the next startup
 * repeats its idempotent steps before any business writer can run. */
export async function resetLegacyBusinessData(
  directory: string,
  options: { afterStep?: (step: string) => void | Promise<void> } = {},
): Promise<void> {
  await assertRegularTree(join(directory, markerName));
  const release = claimProfile(directory);
  try {
    const markerPath = join(directory, markerName);
    const savedMarker = await readOptional(markerPath);
    if (
      savedMarker &&
      businessGenerationSchema.parse(JSON.parse(savedMarker)).state ===
        "committed"
    )
      return;

    // Validate every affected entry before recording or applying a reset.
    for (const entry of [
      ...legacyBusinessEntries,
      "telegram.json",
      `${markerName}.reset-tmp`,
      "telegram.json.reset-tmp",
    ])
      await assertRegularTree(join(directory, entry));
    const telegramPath = join(directory, "telegram.json");
    const raw = await readOptional(telegramPath);
    const telegram =
      raw === undefined
        ? undefined
        : telegramStateSchema.parse(JSON.parse(raw));
    if (telegram) {
      telegram.inbound = telegram.inbound.map(
        ({ taskId: _task, acknowledgement: _ack, ...inbound }) => ({
          ...inbound,
          outcome: "retired_by_reset",
        }),
      );
      telegram.queuedForwarding = [];
      telegramStateSchema.parse(telegram);
    }

    await replaceJson(markerPath, {
      generation: "search-follow-v1",
      state: "resetting",
    });
    await options.afterStep?.("journal");
    if (telegram) await replaceJson(telegramPath, telegram);
    await options.afterStep?.("telegram");
    for (const entry of legacyBusinessEntries) {
      await rm(join(directory, entry), { force: true, recursive: true });
      await options.afterStep?.(`removed:${entry}`);
    }
    await replaceJson(markerPath, {
      generation: "search-follow-v1",
      state: "committed",
    });
  } finally {
    release();
  }
}
