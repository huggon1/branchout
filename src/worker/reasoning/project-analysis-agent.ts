import type { Language } from "../../shared/language";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  isExecutionCommandOnly,
  type ReadCodexSessionsResult,
} from "../../readers/codex-sessions";
import type { AnalysisPromptSettings } from "../../shared/analysis-prompt-contracts";
import type {
  AnalysisEvidenceRef,
  ProjectAnalysisFinding,
  ProjectAnalysisFocusCard,
  ProjectAnalysisSuggestion,
} from "../jobs/project-analysis/types";

const evidenceSchema = z
  .object({
    source: z.enum(["repository", "codex_session"]),
    path: z.string().optional(),
    messageId: z.string().optional(),
    quote: z.string().trim().min(1).max(600),
  })
  .strict();
const outputSchema = z
  .object({
    summary: z.string().trim().min(1).max(24000),
    findings: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(120),
            summary: z.string().trim().min(1).max(1400),
            evidence: z.array(evidenceSchema).min(1).max(12),
          })
          .strict(),
      )
      .max(24),
    suggestions: z
      .array(
        z
          .object({
            kind: z.enum(["create", "update"]),
            focusId: z.string().optional(),
            content: z.string().trim().min(1).max(2000),
            reason: z.string().trim().min(1).max(1200),
            evidence: z.array(evidenceSchema).min(1).max(12),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();

export type ValidatedProjectAnalysisOutput = {
  summary: string;
  findings: ProjectAnalysisFinding[];
  suggestions: ProjectAnalysisSuggestion[];
  evidence: AnalysisEvidenceRef[];
};

export {
  projectAnalysisAgentSystemPrompt,
  projectAnalysisAgentTask,
} from "../jobs/project-analysis/prompts";

export function conversationXml(sessions: ReadCodexSessionsResult): string {
  const escape = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const body = sessions.sessions
    .map((session) => {
      const messages = session.messages
        .map(
          (message) =>
            `    <message id="${escape(`${session.sessionId}:${message.lineNumber}`)}" role="${message.role}" commandOnly="${message.commandOnly}"${message.timestamp ? ` timestamp="${escape(message.timestamp)}"` : ""}>${escape(message.text)}</message>`,
        )
        .join("\n");
      return `  <session id="${escape(session.sessionId)}">\n${messages}\n  </session>`;
    })
    .join("\n");
  return `<conversations>\n${body}\n</conversations>\n`;
}

export function validateProjectAnalysisAgentOutput(
  response: string,
  repositoryRoot: string,
  readFiles: ReadonlyMap<string, Buffer>,
  sessions: ReadCodexSessionsResult,
  focusCards: ProjectAnalysisFocusCard[],
  language: Language = "zh-CN",
): ValidatedProjectAnalysisOutput {
  const json = response
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const output = outputSchema.parse(JSON.parse(json));
  for (const reference of output.summary.matchAll(/\[(\d+)\](?!\()/g)) {
    const index = Number(reference[1]);
    if (index < 1 || index > output.findings.length)
      throw new Error(
        `Invalid report reference ${index}; findings count ${output.findings.length}`,
      );
  }
  const messages = new Map<
    string,
    {
      sessionId: string;
    } & ReadCodexSessionsResult["sessions"][number]["messages"][number]
  >(
    sessions.sessions.flatMap((session) =>
      session.messages.map(
        (message) =>
          [
            `${session.sessionId}:${message.lineNumber}`,
            { sessionId: session.sessionId, ...message },
          ] as const,
      ),
    ),
  );
  const cards = new Map(focusCards.map((card) => [card.focusId, card]));
  const evidence = new Map<string, AnalysisEvidenceRef>();
  const resolveEvidence = (
    items: z.infer<typeof evidenceSchema>[],
  ): AnalysisEvidenceRef[] =>
    items.flatMap((item): AnalysisEvidenceRef[] => {
      if (item.source === "codex_session") {
        const message = item.messageId
          ? messages.get(item.messageId)
          : undefined;
        const quote = item.quote
          .replace(/&quot;/g, '"')
          .replace(/&gt;/g, ">")
          .replace(/&lt;/g, "<")
          .replace(/&amp;/g, "&");
        if (!message || !message.text.includes(quote)) return [];
        const evidenceId = `codex_session:${createHash("sha256").update(`${item.messageId}:${quote}`).digest("hex").slice(0, 24)}`;
        return [
          {
            evidenceId,
            source: "codex_session" as const,
            sourceId: message.sessionId,
            location: {
              sessionId: message.sessionId,
              messageId: `line:${message.lineNumber}`,
              messageLineNumber: message.lineNumber,
              role: message.role,
            },
            quote,
          },
        ];
      }
      if (!item.path) return [];
      const absolute = resolve(repositoryRoot, item.path);
      const path = relative(repositoryRoot, absolute).split(sep).join("/");
      if (
        (isAbsolute(item.path) && absolute !== item.path) ||
        path.startsWith("../") ||
        path === ".."
      )
        return [];
      const content = readFiles.get(absolute);
      if (!content || !content.toString("utf8").includes(item.quote)) return [];
      const text = content.toString("utf8");
      const startLine = text
        .slice(0, text.indexOf(item.quote))
        .split("\n").length;
      const evidenceId = `repository:${createHash("sha256").update(`${path}:${startLine}:${item.quote}`).digest("hex").slice(0, 24)}`;
      return [
        {
          evidenceId,
          source: "repository" as const,
          sourceId: createHash("sha256").update(content).digest("hex"),
          location: {
            path,
            startLine,
            endLine: startLine + item.quote.split("\n").length - 1,
          },
          quote: item.quote,
          contentDigest: createHash("sha256").update(content).digest("hex"),
        },
      ];
    });
  const findings: ProjectAnalysisFinding[] = output.findings.flatMap(
    (item, index) => {
      const refs = resolveEvidence(item.evidence);
      if (refs.length !== item.evidence.length || !refs.length)
        throw new Error(`Invalid report evidence at finding ${index + 1}`);
      if (refs.some((ref) => ref.source !== "repository"))
        throw new Error("Report facts require repository evidence");
      refs.forEach((ref) => evidence.set(ref.evidenceId, ref));
      return [
        {
          findingId: `finding-${index + 1}`,
          title: item.title,
          summary: item.summary,
          evidenceIds: [...new Set(refs.map((ref) => ref.evidenceId))],
        },
      ];
    },
  );
  const suggestions: ProjectAnalysisSuggestion[] = output.suggestions.flatMap(
    (item, index) => {
      const refs = resolveEvidence(item.evidence);
      if (
        refs.length !== item.evidence.length ||
        !refs.length ||
        isExecutionCommandOnly(item.content)
      )
        throw new Error(`Invalid suggestion evidence at card ${index + 1}`);
      if (
        refs.some((ref) => ref.source === "codex_session") &&
        !refs.some((ref) => {
          if (ref.source !== "codex_session" || !("sessionId" in ref.location))
            return false;
          const message = messages.get(
            `${ref.location.sessionId}:${ref.location.messageLineNumber}`,
          );
          return message?.role === "user" && !message.commandOnly;
        })
      )
        throw new Error("Suggestion requires user intent evidence");
      const card =
        item.kind === "update" && item.focusId
          ? cards.get(item.focusId)
          : undefined;
      if (item.kind === "update" && !card)
        throw new Error("Unknown suggestion target");
      refs.forEach((ref) => evidence.set(ref.evidenceId, ref));
      return [
        {
          suggestionId: `suggestion-${index + 1}`,
          kind: item.kind,
          ...(card
            ? { focusId: card.focusId, baseFocusVersionId: card.focusVersionId }
            : {}),
          content: item.content,
          reason: item.reason,
          evidenceIds: [...new Set(refs.map((ref) => ref.evidenceId))],
        },
      ];
    },
  );
  return {
    summary: evidence.size
      ? output.summary
      : language === "en"
        ? "This exploration produced no verifiable findings."
        : "本次探索没有形成可核验发现。",
    findings,
    suggestions,
    evidence: [...evidence.values()],
  };
}
