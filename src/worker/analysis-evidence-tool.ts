import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ProjectAnalysisSource } from "./reasoning/project-analysis";

export const EVIDENCE_TOOL_PROTOCOL = "read-evidence-v1";
export const MAX_EVIDENCE_READS = 8;
const MAX_READ_CHARACTERS = 4_000;
const evidenceSchema = Type.Object({
  evidenceId: Type.String({ minLength: 1, maxLength: 120 }),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});

/** Reads only the redacted source snapshot selected for one model batch. */
export function createAnalysisEvidenceTool(
  sources: readonly ProjectAnalysisSource[],
  onRead?: (count: number) => void,
): ToolDefinition<typeof evidenceSchema> {
  const sourceMap = new Map(sources.map((source) => [source.evidenceId, source]));
  let reads = 0;
  return {
    name: "read_evidence",
    label: "Read selected evidence",
    description: "Read up to 4000 characters of one evidence item already selected for this analysis batch. Use its evidenceId from the input. The result includes an offset for continuing a long item.",
    promptSnippet: "Read a bounded excerpt of selected project evidence by evidenceId",
    parameters: evidenceSchema,
    async execute(_toolCallId, params) {
      reads += 1;
      onRead?.(reads);
      const result = (message: string) => ({ content: [{ type: "text" as const, text: message }], details: {} });
      if (reads > MAX_EVIDENCE_READS) return result("Evidence read limit reached for this batch.");
      const source = sourceMap.get(params.evidenceId);
      if (!source) return result("Unknown evidence ID: this item is not available in the selected batch.");
      const offset = params.offset ?? 0;
      if (offset > source.text.length) return result("Offset exceeds the selected evidence length.");
      return result(JSON.stringify({
        evidenceId: source.evidenceId,
        label: source.label,
        offset,
        totalCharacters: source.text.length,
        text: source.text.slice(offset, offset + MAX_READ_CHARACTERS),
        nextOffset: Math.min(source.text.length, offset + MAX_READ_CHARACTERS),
      }));
    },
  };
}
