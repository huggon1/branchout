import { ZodError } from "zod";

const fallback = "Output shape or exact source quotation failed";
const fields = new Set([
  "summary",
  "findings",
  "suggestions",
  "title",
  "evidence",
  "source",
  "path",
  "messageId",
  "quote",
  "kind",
  "focusId",
  "content",
  "reason",
]);
export function outputValidationDiagnostic(error: unknown): string {
  if (error instanceof SyntaxError)
    return "Invalid JSON syntax: summary is a string in the same root object as findings and suggestions; a comma follows its closing quote, not a closing brace";
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    if (
      issue?.code === "too_big" &&
      issue.path.length &&
      issue.path.every((segment) =>
        typeof segment === "number"
          ? Number.isSafeInteger(segment) && segment >= 0 && segment <= 10000
          : typeof segment === "string" && fields.has(segment),
      )
    )
      return `Output limit exceeded at ${issue.path.join(".")}; maximum ${issue.maximum}`;
    return fallback;
  }
  if (
    error instanceof Error &&
    /^(Invalid report evidence at finding \d+|Invalid suggestion evidence at card \d+|Invalid report reference \d+; findings count \d+|Unknown suggestion target|Report facts require repository evidence|Suggestion requires user intent evidence)$/.test(
      error.message,
    )
  )
    return error.message;
  return fallback;
}
