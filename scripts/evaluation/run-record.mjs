import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";
import { z } from "zod";

export const RUN_RECORD_VERSION = 1;
export const defaultOutputRoot = join(homedir(), ".branchout", "evaluation", "runs");

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const outcome = z.enum(["passed", "failed", "pending", "skipped"]);
const scopedInput = z.object({
  fingerprint: digest,
  selected: z.number().int().nonnegative(),
}).strict();
const stage = z.object({
  name: z.string().min(1).max(64),
  outcome,
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  code: z.string().regex(/^[a-z0-9_]{1,64}$/).optional(),
}).strict();
const check = z.object({
  id: z.string().regex(/^[A-Z0-9_-]{2,80}$/),
  outcome,
  observed: z.number().int().nonnegative().optional(),
  expected: z.number().int().nonnegative().optional(),
}).strict();
const artifact = z.object({
  kind: z.enum(["screenshot", "trace_html", "report", "driver_log", "review"]),
  relativePath: z.string().min(1).max(240).refine((path) =>
    !posix.isAbsolute(path) && !win32.isAbsolute(path) &&
    !path.split(/[\\/]/).includes("..") && !path.includes("\\")),
  sha256: digest,
}).strict();
const rubric = z.object({
  concern: z.enum(["pass", "fail", "unclear"]),
  standalone: z.enum(["pass", "fail", "unclear"]),
  evidence: z.enum(["pass", "fail", "unclear"]),
  distinct: z.enum(["pass", "fail", "unclear"]),
  criticalFailure: z.boolean(),
}).strict();

export const runRecordSchema = z.object({
  schemaVersion: z.literal(RUN_RECORD_VERSION),
  runId: z.string().uuid(),
  scenarioId: z.string().regex(/^EV-\d{2}$/),
  mode: z.enum(["fixture", "local"]),
  outcome,
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
  code: z.object({ revision: z.string().regex(/^[a-f0-9]{40}$/), dirty: z.boolean() }).strict(),
  app: z.object({
    version: z.string().min(1).max(64),
    buildKind: z.enum(["packaged", "source"]),
    buildFingerprint: digest,
  }).strict(),
  harness: z.object({ fingerprint: digest }).strict(),
  inputScope: z.object({
    repository: scopedInput,
    commits: scopedInput,
    conversations: scopedInput,
    messagesSelected: z.number().int().nonnegative(),
  }).strict(),
  model: z.object({ identifier: z.string().min(1).max(120), promptRevision: digest }).strict(),
  stages: z.array(stage),
  checks: z.array(check),
  artifacts: z.array(artifact),
  review: z.object({
    status: z.enum(["pending", "complete"]),
    cards: z.array(z.object({ suggestionFingerprint: digest, rubric }).strict()),
  }).strict(),
}).strict();

export function newRunRecord(fields) {
  return runRecordSchema.parse({
    schemaVersion: RUN_RECORD_VERSION,
    runId: randomUUID(),
    outcome: "pending",
    startedAt: new Date().toISOString(),
    stages: [],
    checks: [],
    artifacts: [],
    review: { status: "pending", cards: [] },
    ...fields,
  });
}

export async function writeRunRecord(outputRoot, record) {
  const value = runRecordSchema.parse(record);
  const directory = join(outputRoot, value.runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, "run.json");
  const temporary = join(directory, `run.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
  return target;
}

export async function readRunRecord(outputRoot, runId) {
  z.string().uuid().parse(runId);
  return runRecordSchema.parse(JSON.parse(await readFile(join(outputRoot, runId, "run.json"), "utf8")));
}

export async function listRunRecords(outputRoot) {
  const directories = await readdir(outputRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const records = await Promise.all(directories.filter((entry) => entry.isDirectory()).map(async (entry) => {
    try { return await readRunRecord(outputRoot, entry.name); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }));
  return records.filter(Boolean).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
