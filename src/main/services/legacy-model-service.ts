import {
  legacySaveModelSchema as saveModelSchema,
  type ModelExecutionConfig,
  type LegacyModelView as ModelView,
} from "../../shared/model-contracts";
import type {
  ProtectedStorage,
  StoredConnection,
} from "../storage/model-store";
import type { CleanupJournal } from "../storage/auth-cleanup";
import {
  accountSchema,
  catalogSchema,
  tokenSchema,
  type CodexRpc,
} from "./codex-client";
interface AuthContext {
  id: string;
  client: CodexRpc;
  refs: number;
  loggedIn: boolean;
  loginId?: string;
  unsubscribe: () => void;
}
export interface ModelDependencies {
  storage: ProtectedStorage;
  journal: CleanupJournal;
  client(id: string): CodexRpc;
  removeHome(id: string): Promise<void>;
  catalog(): Promise<string[]>;
  openLogin(url: string): Promise<void>;
  check(config: ModelExecutionConfig, signal: AbortSignal): Promise<void>;
  changed(): void;
}
export class LegacyModelService {
  private current: StoredConnection | null = null;
  private auth?: AuthContext;
  private contexts = new Map<string, AuthContext>();
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;
  private generation = 0;
  private cleanupFailed = false;
  private state: Omit<ModelView, "current"> = {
    auth: "signed_out",
    catalog: "empty",
    models: [],
    message: "",
    check: "idle",
  };
  constructor(private dependencies: ModelDependencies) {}
  private serial<T>(fn: () => Promise<T>) {
    const result = this.pending.then(fn);
    this.pending = result.catch(() => {});
    return result;
  }
  private changed() {
    this.dependencies.changed();
  }
  view(): ModelView {
    const c = this.current;
    return structuredClone({
      ...this.state,
      current: c
        ? {
            method: c.method,
            modelId: c.modelId,
            hasCredential:
              c.method === "generic_api"
                ? !!c.apiKey
                : this.state.auth === "signed_in",
            ...(c.method === "generic_api"
              ? { baseUrl: c.baseUrl, api: c.api }
              : {}),
          }
        : null,
    });
  }
  private context(id: string): AuthContext {
    const existing = this.contexts.get(id);
    if (existing) return existing;
    const client = this.dependencies.client(id);
    const context: AuthContext = {
      id,
      client,
      refs: 0,
      loggedIn: false,
      unsubscribe: () => {},
    };
    this.contexts.set(id, context);
    return context;
  }
  async open() {
    this.current = await this.dependencies.storage.load();
    for (const id of await this.dependencies.journal.list())
      if (
        this.current?.method !== "codex_subscription" ||
        this.current.authId !== id
      )
        await this.cleanup(this.context(id));
    if (this.current?.method === "codex_subscription") {
      this.auth = this.context(this.current.authId);
      try {
        const result = accountSchema.parse(
          await this.auth.client.request("account/read", {
            refreshToken: false,
          }),
        );
        this.auth.loggedIn = !!result.account;
        this.state.auth = result.account ? "signed_in" : "signed_out";
        this.state.accountLabel = result.account?.email ?? undefined;
        this.state.message = result.account
          ? "请刷新模型目录后检查连接"
          : "请登录 ChatGPT；此前使用钥匙串的账号需重新登录一次";
      } catch {
        this.state.auth = "unavailable";
        this.state.message = "Codex 客户端不可用，请检查安装后重启应用";
      }
    }
  }
  private async refreshContext(context: AuthContext) {
    try {
      const account = accountSchema.parse(
        await context.client.request("account/read", { refreshToken: false }),
      );
      if (!account.account) {
        context.loggedIn = false;
        this.state.auth = "signed_out";
        throw new Error("需要登录");
      }
      context.loggedIn = true;
      this.state.auth = "signed_in";
      this.state.accountLabel = account.account.email ?? undefined;
      const compatible = new Set(await this.dependencies.catalog());
      const models: ModelView["models"] = [];
      let cursor: string | null = null;
      const seen = new Set<string>();
      do {
        const result = catalogSchema.parse(
          await context.client.request("model/list", {
            limit: 100,
            includeHidden: false,
            cursor,
          }),
        );
        for (const model of result.data)
          if (!model.hidden && !models.some((item) => item.id === model.model))
            models.push({
              id: model.model,
              name: model.displayName,
              compatible: compatible.has(model.model),
            });
        cursor = result.nextCursor;
        if (cursor && seen.has(cursor)) throw new Error("目录分页异常");
        if (cursor) seen.add(cursor);
        if (seen.size > 20) throw new Error("目录过大");
      } while (cursor);
      this.state.models = models;
      this.state.catalog = "ready";
      this.state.message = models.some((model) => model.compatible)
        ? "模型目录已刷新；连接仍需检查"
        : "账号目录中没有当前 Pi 可执行的模型";
    } catch {
      this.state.catalog = "failed";
      this.state.message = "模型目录刷新失败，已保留当前选择";
      throw new Error("模型目录刷新失败");
    } finally {
      this.changed();
    }
  }
  async refresh() {
    return this.serial(async () => {
      if (!this.auth) throw new Error("请先登录");
      await this.refreshContext(this.auth);
    });
  }
  async save(input: unknown) {
    return this.serial(async () => {
      if (this.closed) throw new Error("应用正在退出");
      const parsed = saveModelSchema.safeParse(input);
      if (!parsed.success) throw new Error("请检查模型连接字段");
      const value = parsed.data;
      let next: StoredConnection;
      if (value.method === "generic_api") {
        const previous =
          this.current?.method === "generic_api" ? this.current : null;
        const apiKey =
          value.apiKey ??
          (previous?.baseUrl === value.baseUrl ? previous.apiKey : undefined);
        if (!apiKey)
          throw new Error("请填写 API Key；更改服务地址后需重新填写");
        next = { ...value, apiKey };
      } else {
        if (
          !this.auth?.loggedIn ||
          this.state.catalog !== "ready" ||
          !this.state.models.some(
            (model) => model.id === value.modelId && model.compatible,
          )
        )
          throw new Error("请刷新目录并选择 Pi 可执行的模型");
        next = { ...value, authId: this.auth.id };
      }
      // Journal old auth before replacing the pointer; restart can finish interrupted cleanup.
      if (this.current?.method === "codex_subscription")
        await this.dependencies.journal.add(this.current.authId);
      await this.dependencies.storage.save(next);
      this.current = next;
      this.generation++;
      this.state.check = "idle";
      this.state.checkModelId = undefined;
      this.state.checkIsCurrent = false;
      if (next.method === "generic_api") {
        const old = this.auth;
        this.auth = undefined;
        this.state.auth = "signed_out";
        this.state.models = [];
        this.state.catalog = "empty";
        this.state.accountLabel = undefined;
        if (old) await this.cleanup(old);
      }
      for (const context of [...this.contexts.values()])
        await this.cleanup(context);
      this.state.message = this.cleanupFailed
        ? "已保存；旧登录清理未完成，将在重启时重试"
        : "已保存，新连接将用于后续任务";
      this.changed();
    });
  }
  async acquire(): Promise<{
    config: ModelExecutionConfig;
    generation: number;
    refreshCredential(): Promise<string>;
    release(): Promise<void>;
  }> {
    return this.serial(async () => {
      const value = this.current;
      if (!value || this.closed) throw new Error("请先保存模型连接");
      let context: AuthContext | undefined;
      let credential: string;
      if (value.method === "generic_api") credential = value.apiKey;
      else {
        context = this.context(value.authId);
        if (this.state.catalog !== "ready") await this.refreshContext(context);
        if (
          !this.state.models.some(
            (model) => model.id === value.modelId && model.compatible,
          )
        )
          throw new Error("当前模型不可用，请在设置中选择其他模型");
        const token = tokenSchema.parse(
          await context.client.request("getAuthStatus", {
            includeToken: true,
            refreshToken: true,
          }),
        );
        credential = token.authToken;
        context.refs++;
      }
      const config: ModelExecutionConfig = {
        method: value.method,
        modelId: value.modelId,
        credential,
        ...(value.method === "generic_api"
          ? { baseUrl: value.baseUrl, api: value.api }
          : {}),
      };
      let released = false;
      return {
        config,
        generation: this.generation,
        refreshCredential: async () => {
          if (released) throw new Error("模型租约已结束");
          if (!context) return config.credential;
          const token = tokenSchema.parse(
            await context.client.request("getAuthStatus", {
              includeToken: true,
              refreshToken: true,
            }),
          );
          return token.authToken;
        },
        release: async () => {
          if (released) return;
          released = true;
          config.credential = "";
          if (context) {
            context.refs--;
            await this.cleanup(context);
          }
        },
      };
    });
  }
  async prepareRetirement() {
    if (this.current?.method === "codex_subscription")
      await this.dependencies.journal.add(this.current.authId);
  }
  async retire() {
    this.current = null;
    this.auth = undefined;
    for (const context of this.contexts.values()) await this.cleanup(context);
  }
  private async cleanup(context: AuthContext) {
    if (
      context.refs ||
      (this.current?.method === "codex_subscription" &&
        this.current.authId === context.id)
    )
      return;
    try {
      if (context.loginId) {
        await context.client.request("account/login/cancel", {
          loginId: context.loginId,
        });
        context.loginId = undefined;
      }
      await context.client.request("account/logout");
      context.unsubscribe();
      await context.client.close();
      this.contexts.delete(context.id);
      await this.dependencies.removeHome(context.id);
      await this.dependencies.journal.remove(context.id);
    } catch {
      this.cleanupFailed = true;
      this.state.message = "旧登录清理未完成，将在退出或重启时重试";
      this.changed();
    }
  }
  async close() {
    this.closed = true;
    await this.pending;
    for (const context of this.contexts.values()) {
      if (context.loginId)
        await context.client
          .request("account/login/cancel", { loginId: context.loginId })
          .catch(() => {});
      await this.cleanup(context);
      context.unsubscribe();
      await context.client.close();
    }
  }
}
