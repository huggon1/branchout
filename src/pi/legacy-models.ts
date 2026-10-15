import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
const MIN_TOKEN_LIFETIME_MS = 5 * 60_000;

export interface CodexAccessToken {
  accessToken: string;
  expiresAt: number;
}

/** Main process owns refresh. No OAuth refresh token crosses the worker boundary. */
export type CodexTokenProvider = (options: {
  forceRefresh: boolean;
  signal?: AbortSignal;
}) => Promise<CodexAccessToken>;

export class CodexCredentialBridge implements CredentialStore {
  private current?: CodexAccessToken;

  constructor(private readonly getToken: CodexTokenProvider) {}

  private async credential(
    forceRefresh: boolean,
    signal?: AbortSignal,
  ): Promise<Credential> {
    let token =
      !forceRefresh &&
      this.current &&
      this.current.expiresAt > Date.now() + MIN_TOKEN_LIFETIME_MS
        ? this.current
        : await this.getToken({ forceRefresh, signal });
    if (token.expiresAt <= Date.now() + MIN_TOKEN_LIFETIME_MS && !forceRefresh)
      token = await this.getToken({ forceRefresh: true, signal });
    if (
      !token.accessToken ||
      token.expiresAt <= Date.now() + MIN_TOKEN_LIFETIME_MS
    )
      throw new Error("Codex access token is unavailable or expires too soon");
    this.current = token;
    return {
      type: "oauth",
      access: token.accessToken,
      // Pi's provider only reads `access` until the five-minute refresh threshold.
      // Refresh always goes through Postrove's Codex client in modify().
      refresh: "postrove-managed",
      expires: token.expiresAt,
    };
  }

  async read(
    providerId: string,
    options?: { signal?: AbortSignal },
  ): Promise<Credential | undefined> {
    return providerId === "openai-codex"
      ? this.credential(false, options?.signal)
      : undefined;
  }

  async list(): Promise<readonly { providerId: string; type: "oauth" }[]> {
    return [{ providerId: "openai-codex", type: "oauth" }];
  }

  async modify(
    providerId: string,
    _fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: { signal?: AbortSignal },
  ): Promise<Credential | undefined> {
    if (providerId !== "openai-codex") return undefined;
    // Pi asks to rotate OAuth tokens when near expiry. The Codex client owns
    // rotation; invoking Pi's fn would use a refresh token we never possess.
    return this.credential(true, options?.signal);
  }

  async delete(): Promise<void> {
    // Login/logout remain owned by the main-process Codex client.
  }
}

export function initialCodexToken(accessToken: string): CodexAccessToken {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"),
    );
    if (typeof payload.exp === "number")
      return { accessToken, expiresAt: payload.exp * 1000 };
  } catch {
    // A malformed token is handled by the regular credential boundary below.
  }
  return { accessToken, expiresAt: 0 };
}
