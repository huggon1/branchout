import { marked } from "marked";
import { randomUUID } from "node:crypto";
import type { ModelExecutionConfig } from "../../../shared/model-contracts";
import type { ReadingMaterial } from "../../../shared/reading-contracts";
import { readingMaterialsSchema } from "../../../shared/reading-contracts";
import { resolveModel, runWithPi } from "../../pi-runtime";
import { promptExecution } from "../../prompt-execution";
import { localizedText } from "../../../shared/language";
import { translationSystem, summarySystem } from "./reading-prompts";
import { preserveReadingSyntax } from "./reading-fidelity";
import {
  ExecutionFailure,
  failureMessages,
} from "../../../shared/task-failure";
import type {
  ForwardingJobCommand,
  ForwardingJobEventContract,
  ForwardingReadingFailure,
} from "./contracts";

export interface ReadingDependencies {
  collect(url: string, signal: AbortSignal): Promise<ReadingMaterial[]>;
  translate(
    material: ReadingMaterial,
    text: string,
    index: number,
  ): Promise<{ text: string; truncated: boolean; issue?: string }>;
  summarize(material: ReadingMaterial): Promise<string>;
}

// Markdown blocks stay intact. An oversized block is sent intact; the provider
// reports its actual capacity and the job retains the preceding saved chunks.
function splitBody(body: string, budget: number) {
  const parts = marked.lexer(body).map((token) => token.raw);
  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    if (current && current.length + part.length > budget) {
      chunks.push(current);
      current = "";
    }
    current += part;
    if (current.length >= budget) {
      chunks.push(current);
      current = "";
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function runReadingJob(
  command: ForwardingJobCommand & { config: ModelExecutionConfig },
  emit: (event: ForwardingJobEventContract) => void,
  signal: AbortSignal,
  overrides: Partial<ReadingDependencies> = {},
) {
  const language = command.outputLanguage ?? "zh-CN";
  const execution = promptExecution(
    translationSystem(language) + summarySystem(language),
    language,
    command.config.modelId,
    { taskId: command.taskId, attemptId: randomUUID() },
  );
  emit({ type: "execution", taskId: command.taskId, execution });
  const model = resolveModel(command.config);
  const failures = new Map<string, ForwardingReadingFailure>();
  const callModel = (
    material: ReadingMaterial,
    stage: "translation" | "summary",
    operationId: string,
    prompt: string,
    system: string,
    onPartial?: (text: string) => void,
  ) =>
    runWithPi(
      command.config,
      operationId,
      signal,
      prompt,
      system,
      undefined,
      undefined,
      [],
      undefined,
      14,
      onPartial,
      {
        onAttempt: (attempt) =>
          emit({
            type: "model_attempt",
            taskId: command.taskId,
            materialId: material.id,
            stage,
            operationId,
            ...attempt,
          }),
      },
    );
  // Budget includes instructions and comparable translation output. Three
  // characters per token is conservative for mixed English/Chinese material.
  const budget = Math.max(
    800,
    Math.floor(
      Math.min(
        (model.contextWindow || 32768) / 4,
        (model.maxTokens || 8192) / 2,
      ),
    ),
  );
  const deps: ReadingDependencies = {
    collect: async () => {
      throw new Error("Source collection is unavailable");
    },
    translate: async (material, text, index) => {
      let partial = "";
      try {
        const translated = await callModel(
          material,
          "translation",
          `${command.taskId}:${material.id}:${index}`,
          text,
          translationSystem(language),
          (text) => {
            partial = text;
          },
        );
        let checked = preserveReadingSyntax(text, translated);
        if (!checked.valid) {
          const repaired = await callModel(
            material,
            "translation",
            `${command.taskId}:${material.id}:${index}:repair`,
            JSON.stringify({
              original: text,
              translation: checked.text,
              missingUrls: checked.missingUrls,
              inventedUrls: checked.inventedUrls,
              missingCode: checked.missingCode,
              missingIdentifiers: checked.missingIdentifiers,
            }),
            translationSystem(language) +
              " Repair this translation. Keep every original link and image destination in its source position. Preserve command blocks and inline identifiers exactly. Return the complete corrected translation only.",
            (value) => {
              partial = value;
            },
          );
          checked = preserveReadingSyntax(text, repaired);
        }
        return checked.valid
          ? { text: checked.text, truncated: false }
          : {
              text: checked.text,
              truncated: true,
              issue:
                language === "en"
                  ? "Link or code preservation is incomplete; saved text and the original source are available for review."
                  : "链接或代码的保留校验尚未通过；可查看已保存内容和原文。",
            };
      } catch (error) {
        if (partial) return { text: partial, truncated: true };
        throw error;
      }
    },
    summarize: async (material) => {
      let level = 0;
      let pieces = material.chunks.map((c) => c.translated).filter(Boolean);
      if (!pieces.length) throw new Error("No translated portion to summarize");
      while (pieces.join("\n\n").length > budget * 2) {
        const next: string[] = [];
        for (const [index, text] of splitBody(
          pieces.join("\n\n"),
          budget * 2,
        ).entries()) {
          next.push(
            await callModel(
              material,
              "summary",
              `${command.taskId}:${material.id}:summary:${level}:${index}`,
              JSON.stringify({
                title: material.title,
                coverage: material.state,
                text,
              }),
              summarySystem(language),
            ),
          );
        }
        if (next.join("\n\n").length >= pieces.join("\n\n").length)
          throw new ExecutionFailure("model_invalid_output");
        pieces = next;
        level++;
      }
      return callModel(
        material,
        "summary",
        `${command.taskId}:${material.id}:summary`,
        JSON.stringify({
          title: material.title,
          coverage: material.state,
          text: pieces.join("\n\n"),
        }),
        summarySystem(language),
      );
    },
    ...overrides,
  };
  const save = (material: ReadingMaterial) =>
    emit({
      type: "material",
      taskId: command.taskId,
      resultId: command.resultId,
      material: structuredClone(material),
    });
  try {
    let materials = command.resume?.materials;
    if (!materials || (materials.length === 1 && !materials[0].source)) {
      emit({ type: "phase", taskId: command.taskId, phase: "读取来源" });
      materials = readingMaterialsSchema.parse(
        await deps.collect(command.sourceUrl, signal),
      );
      emit({
        type: "materials",
        taskId: command.taskId,
        resultId: command.resultId,
        materials,
      });
    }
    for (const material of materials) {
      if (signal.aborted) throw new Error("cancelled");
      if (material.state === "completed") continue;
      if (!material.source) {
        failures.set(material.id, {
          materialId: material.id,
          stage: "source",
          message: (
            material.issue ??
            localizedText(
              language,
              "来源读取未完成",
              "Source collection is incomplete",
            )
          ).slice(0, 500),
        });
        continue;
      }
      let stage: "translation" | "summary" = "translation";
      try {
        material.state = "processing";
        material.issue = undefined;
        save(material);
        if (!material.chunks.length) {
          const body =
            material.source.markdown ??
            material.source.contentBlocks
              .map((b) =>
                b.type === "image"
                  ? `![${material.source!.images.find((i) => i.imageId === b.imageId)?.alt ?? ""}](${material.source!.images.find((i) => i.imageId === b.imageId)?.url ?? ""})`
                  : b.type === "heading"
                    ? `${"#".repeat(b.level)} ${b.text}`
                    : b.type === "code"
                      ? `\`\`\`\n${b.text}\n\`\`\``
                      : b.text,
              )
              .join("\n\n");
          material.chunks = splitBody(body, budget).map((original, index) => ({
            index,
            original,
            translated: "",
            complete: false,
          }));
          save(material);
        }
        emit({ type: "phase", taskId: command.taskId, phase: "翻译材料" });
        for (const chunk of material.chunks) {
          if (chunk.complete) continue;
          if (signal.aborted) throw new Error("cancelled");
          const result = await deps.translate(
            material,
            chunk.original,
            chunk.index,
          );
          if (!result.text.trim()) throw new ExecutionFailure("model_empty");
          chunk.translated = result.text;
          chunk.complete = !result.truncated;
          save(material);
          if (result.truncated) {
            material.issue =
              result.issue ??
              localizedText(
                language,
                `输出达到模型上限；已保存第 ${chunk.index + 1} 段返回内容，共 ${material.chunks.length} 段`,
                `Model output reached its limit; returned text for chunk ${chunk.index + 1} of ${material.chunks.length} is saved`,
              );
            failures.set(material.id, {
              materialId: material.id,
              stage: "translation",
              message: material.issue.slice(0, 500),
            });
            break;
          }
        }
        material.state = material.chunks.every((c) => c.complete)
          ? "completed"
          : "partial";
        emit({ type: "phase", taskId: command.taskId, phase: "生成摘要" });
        stage = "summary";
        material.summary = await deps.summarize(material);
        if (!material.summary.trim()) throw new ExecutionFailure("model_empty");
        save(material);
      } catch (error) {
        if (signal.aborted) throw new Error("cancelled");
        material.state = material.chunks.some((c) => c.translated)
          ? "partial"
          : "failed";
        const completed = material.chunks.filter((c) => c.complete).length;
        const failure = error instanceof ExecutionFailure ? error : undefined;
        const reason = failure
          ? localizedText(
              language,
              failureMessages[failure.code],
              (
                {
                  model_auth: "Model authentication failed.",
                  model_rate_limit:
                    "Model requests were rate limited or the account quota is exhausted.",
                  model_network: "The model service connection failed.",
                  model_unavailable:
                    "The model service is temporarily unavailable.",
                  model_context: "The input exceeds the model context limit.",
                  model_output_limit: "Model output reached its limit.",
                  model_empty: "The model returned an empty result.",
                  model_invalid_output: "The model returned an invalid result.",
                } as Partial<Record<typeof failure.code, string>>
              )[failure.code] ?? "The model request failed.",
            )
          : localizedText(
              language,
              "材料处理未完成。",
              "Material processing is incomplete.",
            );
        const issue = localizedText(
          language,
          `${stage === "translation" ? "翻译" : "摘要"}未完成：${reason} 已保存 ${completed}/${material.chunks.length} 段译文和原文。`,
          `${stage === "translation" ? "Translation" : "Introduction"} failed: ${reason} ${completed}/${material.chunks.length} translated chunks and the original source are saved.`,
        );
        material.issue = material.issue
          ? `${material.issue} ${issue}`.slice(0, 1500)
          : issue;
        if (!failures.has(material.id))
          failures.set(material.id, {
            materialId: material.id,
            stage,
            message: material.issue.slice(0, 500),
            ...(failure
              ? { code: failure.code, diagnostic: failure.diagnostic }
              : {}),
          });
        save(material);
      }
    }
    const source = materials[0].source;
    if (!source) throw new Error("Main source unavailable");
    emit({
      type: "result",
      taskId: command.taskId,
      resultId: command.resultId,
      draft: {
        source,
        materials,
        execution,
        outputLanguage: language,
      },
      ...(failures.size
        ? {
            failure:
              failures.get(materials[0].id) ?? failures.values().next().value,
          }
        : {}),
    });
  } catch {
    if (!signal.aborted)
      emit({
        type: "failed",
        taskId: command.taskId,
        stage: "source",
        message: localizedText(
          language,
          "材料读取未完成；可查看已保存内容和原文",
          "Material reading is incomplete; saved content and the original source remain available",
        ),
      });
  } finally {
    command.config.credential = "";
  }
}
