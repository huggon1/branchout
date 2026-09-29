/** Only public assistant text enters the activity log. HTML is handled by the renderer. */
export function displayActivityText(text: string): string {
  const cleaned = text
    .replace(
      /\b(?:sk-[\w-]{8,}|gh[pousr]_[\w]{8,}|Bearer\s+[\w.+/=-]+)/gi,
      "[credential redacted]",
    )
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*["']?\s*[:=]\s*)["']?[^\s,"'}]+/gi,
      "$1[redacted]",
    );
  return cleaned.length > 16000
    ? `${cleaned.slice(0, 15950)}\n\n[显示内容已截断；完整记录可导出]`
    : cleaned;
}
