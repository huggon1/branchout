import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("cancelled");
}

export async function runGit(
  directory: string,
  args: string[],
  signal?: AbortSignal,
  maxBuffer = 2 * 1024 * 1024,
): Promise<string> {
  throwIfAborted(signal);
  const executable = process.platform === "win32" ? "git" : "/usr/bin/git";
  const { stdout } = await execFileAsync(
    executable,
    ["--no-optional-locks", "-C", directory, ...args],
    {
      timeout: 10_000,
      maxBuffer,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    },
  );
  throwIfAborted(signal);
  return stdout;
}

export function redactSensitiveText(input: string, homeDirectory?: string): string {
  let value = input
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[private key redacted]",
    )
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g, "[credential redacted]")
    .replace(
      /((?:api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token|authorization)["']?\s*[=:]\s*["'])[^"'\r\n]+(["'])/gi,
      "$1[credential redacted]$2",
    )
    .replace(
      /\b((?:api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[credential redacted]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [credential redacted]");
  value = value.replace(/\b(?:\/Users|\/home|\/root|\/Volumes|\/private)\/[^\s"'`<>]+/g, "[local path]");
  if (homeDirectory && !/^\/(?:Users|home|root|Volumes|private)\//.test(homeDirectory)) {
    const escaped = homeDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    value = value.replace(new RegExp(`${escaped}(?:[/\\\\][^\\s"'\u0060<>]*)?`, "g"), "[local path]");
  }
  value = value.replace(/\b[A-Z]:\\Users\\[^\s"'`<>]+/gi, "[local path]");
  return value;
}

export function isSensitivePath(path: string): boolean {
  return /(?:^|\/)(?:\.git|\.ssh|\.aws|\.azure|\.config|\.codex|node_modules|vendor|dist|build|coverage|target|out|fixtures|__fixtures__|\.runtime)(?:\/|$)/i.test(
    path,
  ) || /(?:secret|credential|password|token|private.?key|\.pem$|\.key$|\.p12$|\.pfx$|lock\.(?:json|yaml)$|lockfile|package-lock|pnpm-lock|yarn\.lock)/i.test(path);
}

export function hasSensitiveContent(text: string): boolean {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})|\bBearer\s+[A-Za-z0-9._~+\/-]{12,}|(?:api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token|authorization)["']?\s*[=:]\s*["'][^"'\n]+["']|\b(?:api[_-]?key|password|secret|access[_-]?token|refresh[_-]?token)\s*[=:]\s*[^\s,;]{12,}/i.test(
    text,
  );
}
