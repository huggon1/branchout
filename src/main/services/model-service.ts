import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AuthPrompt, AuthEvent } from "@earendil-works/pi-ai";
import {
  authAnswerSchema,
  customModelsSchema,
  defaultPiOptions,
  loginModelSchema,
  nativeSaveModelSchema,
  selectModelConnectionSchema,
  type ModelExecutionConfig,
  type ModelView,
  type PiModelOption,
} from "../../shared/model-contracts";
import { classifyModelError } from "../../shared/task-failure";
import {
  createModelRuntime,
  piSdk,
  PI_VERSION,
  resolveThinking,
  type PiRuntimePaths,
} from "../../pi/model-runtime";
import {
  PiConnectionStore,
  writePrivateJson,
  type PiConnection,
  type PiConnections,
} from "../storage/pi-connection-store";
import type { ProtectedStorage } from "../storage/model-store";

type Runtime = Awaited<ReturnType<typeof createModelRuntime>>;
type Candidate = {
  catalogSource: "builtin" | "custom";
  id: string;
  providerId: string;
  runtime: Runtime;
  useEnvironment: boolean;
  serverDefaultOutputModelId?: string;
  replacesId?: string;
  settings?: Pick<PiConnection, "name" | "modelId" | "options">;
};
export interface ModelDependencies {
  root: string;
  storage: ProtectedStorage;
  openLogin(url: string): Promise<void>;
  check(config: ModelExecutionConfig, signal: AbortSignal): Promise<void>;
  changed(): void;
}

/** Pi owns catalog composition, credentials, login, refresh, and provider requests. */
export class ModelService {
  private readonly store: PiConnectionStore;
  private data: PiConnections = {
    version: 2,
    connections: [],
    retiredIds: [],
    legacyMigrated: false,
  };
  private catalog!: Runtime;
  private candidate?: Candidate;
  private runtimes = new Map<string, Runtime>();
  private drafts = new Set<string>();
  private references = new Map<string, number>();
  private loginAbort?: AbortController;
  private loginWork?: Promise<void>;
  private answer?: {
    id: string;
    resolve(value: string): void;
    reject(error: Error): void;
  };
  private closed = false;
  private generation = 0;
  private pending: Promise<unknown> = Promise.resolve();
  private checking?: Promise<void>;
  private checkAbort?: AbortController;
  private state: Pick<
    ModelView,
    | "auth"
    | "authSource"
    | "authPrompt"
    | "authEvents"
    | "catalog"
    | "message"
    | "check"
    | "checkFailure"
    | "checkModelId"
    | "checkIsCurrent"
  > = {
    auth: "signed_out",
    authEvents: [],
    catalog: "ready",
    message: "",
    check: "idle",
  };
  constructor(private readonly dependencies: ModelDependencies) {
    this.store = new PiConnectionStore(
      join(dependencies.root, "connections.json"),
    );
  }
  private serial<T>(operation: () => Promise<T>) {
    const work = this.pending.then(operation);
    this.pending = work.catch(() => {});
    return work;
  }
  private changed() {
    this.dependencies.changed();
  }
  private paths(id: string): PiRuntimePaths {
    const dir = join(this.dependencies.root, "connections", id);
    return {
      authPath: join(dir, "auth.json"),
      modelsPath: join(dir, "models.json"),
      modelsStorePath: join(dir, "models-store.json"),
    };
  }
  private async runtime(id: string) {
    let runtime = this.runtimes.get(id);
    if (!runtime) {
      runtime = await createModelRuntime(this.paths(id));
      this.runtimes.set(id, runtime);
    }
    return runtime;
  }
  async open() {
    this.data = await this.store.load();
    const { getSupportedThinkingLevels } = await piSdk();
    this.supportedThinking = (model) => [...getSupportedThinkingLevels(model)];
    const retained = new Set(
      this.data.connections.map((connection) => connection.id),
    );
    const directories = await readdir(
      join(this.dependencies.root, "connections"),
      { withFileTypes: true },
    ).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    });
    for (const entry of directories)
      if (
        entry.isDirectory() &&
        /^[a-f\d-]{36}$/i.test(entry.name) &&
        !retained.has(entry.name)
      )
        await rm(join(this.dependencies.root, "connections", entry.name), {
          recursive: true,
          force: true,
        });
    if (this.data.retiredIds.length) {
      this.data.retiredIds = [];
      await this.store.save(this.data);
    }
    const catalogDir = join(this.dependencies.root, "catalog");
    this.catalog = await createModelRuntime({
      authPath: join(catalogDir, "auth.json"),
      modelsPath: join(catalogDir, "models.json"),
      modelsStorePath: join(catalogDir, "models-store.json"),
    });
    if (this.data.activeId) {
      if (!this.data.legacyMigrated) {
        this.data.legacyMigrated = true;
        await this.store.save(this.data);
      }
      const active = this.data.connections.find(
        (c) => c.id === this.data.activeId,
      )!;
      await this.choose(active.providerId, active.id);
    } else if (!this.data.legacyMigrated) {
      const old = await this.dependencies.storage.load();
      if (old?.method === "generic_api") {
        // Copy into native models.json/AuthStorage before changing the active pointer.
        const id = randomUUID();
        this.drafts.add(id);
        const { getBuiltinProviders, getBuiltinModels } =
          await import("@earendil-works/pi-ai/providers/all");
        const metadata = getBuiltinProviders()
          .flatMap((p) => [...getBuiltinModels(p)])
          .find((m) => m.id === old.modelId);
        await writePrivateJson(this.paths(id).modelsPath, {
          providers: {
            "postrove-api": {
              name: "Custom API",
              baseUrl: old.baseUrl,
              api: old.api,
              models: [
                {
                  id: old.modelId,
                  name: old.modelId,
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: metadata?.contextWindow ?? 32768,
                  ...(metadata?.maxTokens
                    ? { maxTokens: metadata.maxTokens }
                    : {}),
                },
              ],
            },
          },
        });
        const runtime = await this.runtime(id);
        // Pi's native API-key login persists the credential with its own store.
        await runtime.login("postrove-api", "api_key", {
          prompt: async () => old.apiKey,
          notify: () => {},
        });
        this.candidate = {
          id,
          providerId: "postrove-api",
          catalogSource: "custom",
          runtime,
          useEnvironment: false,
          ...(!metadata?.maxTokens
            ? { serverDefaultOutputModelId: old.modelId }
            : {}),
        };
        await this.save({
          method: "pi",
          connectionId: id,
          modelId: old.modelId,
          name: "Custom API",
          options: defaultPiOptions(),
        });
        this.state.message =
          "原 API 连接已迁移到 Pi，新任务沿用原地址、模型和密钥";
      }
    }
    if (this.data.legacyMigrated) {
      await this.retireLegacySource();
    }
  }
  private modelOptions(runtime: Runtime, providerId: string): PiModelOption[] {
    const configured = runtime.getProviderAuthStatus(providerId).configured;
    const available = new Set(
      runtime
        .getAvailableSnapshot()
        .filter((model) => model.provider === providerId)
        .map((model) => model.id),
    );
    // pi-ai exposes thinking capabilities as a public runtime API.
    return runtime.getModels(providerId).map((model) => ({
      id: model.id,
      name: model.name,
      compatible: !configured || available.has(model.id),
      thinkingLevels: this.supportedThinking(model),
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      api: model.api,
      input: model.input,
    }));
  }
  private supportedThinking: (
    model: Parameters<
      (typeof import("@earendil-works/pi-ai"))["getSupportedThinkingLevels"]
    >[0],
  ) => PiModelOption["thinkingLevels"] = () => ["off"];
  private syncAuth() {
    if (!this.candidate || this.loginAbort) return;
    const status = this.candidate.runtime.getProviderAuthStatus(
      this.candidate.providerId,
    );
    this.state.auth = status.configured ? "signed_in" : "signed_out";
    this.state.authSource = status.source;
  }
  view(): ModelView {
    this.syncAuth();
    const active = this.data.connections.find(
      (c) => c.id === this.data.activeId,
    );
    const candidate = this.candidate;
    const saved = this.data.connections.find((c) => c.id === candidate?.id);
    const providerMap = new Map(
      this.catalog.getProviders().map((p) => [p.id, p]),
    );
    for (const runtime of this.runtimes.values())
      for (const provider of runtime.getProviders())
        providerMap.set(provider.id, provider);
    return structuredClone({
      ...this.state,
      piVersion: PI_VERSION,
      current: active
        ? {
            method: "pi",
            connectionId: active.id,
            providerId: active.providerId,
            modelId: active.modelId,
            name: active.name,
            hasCredential: true,
            options: active.options,
          }
        : null,
      providers: [...providerMap.values()]
        .map((provider) => ({
          id: provider.id,
          builtin: !!this.catalog.getProvider(provider.id),
          name: provider.name,
          modelCount: provider.getModels().length,
          authMethods: [
            ...(provider.auth.apiKey
              ? [
                  {
                    type: provider.auth.apiKey.login
                      ? ("api_key" as const)
                      : ("environment" as const),
                    name: provider.auth.apiKey.name,
                  },
                ]
              : []),
            ...(provider.auth.oauth
              ? [
                  {
                    type: "oauth" as const,
                    name:
                      provider.auth.oauth.loginLabel ??
                      provider.auth.oauth.name,
                  },
                ]
              : []),
          ],
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      connections: this.data.connections.map(
        ({ id, providerId, name, modelId }) => ({
          id,
          providerId,
          name,
          modelId,
        }),
      ),
      ...(candidate
        ? {
            selected: {
              catalogSource: candidate.catalogSource,
              id: candidate.id,
              providerId: candidate.providerId,
              name:
                saved?.name ??
                candidate.settings?.name ??
                providerMap.get(candidate.providerId)?.name ??
                candidate.providerId,
              modelId: saved?.modelId ?? candidate.settings?.modelId,
              options:
                saved?.options ??
                candidate.settings?.options ??
                defaultPiOptions(),
            },
          }
        : {}),
      models: candidate
        ? this.modelOptions(candidate.runtime, candidate.providerId)
        : [],
    });
  }
  private async choose(providerId: string, connectionId?: string) {
    const { getSupportedThinkingLevels } = await piSdk();
    this.supportedThinking = (model) => [...getSupportedThinkingLevels(model)];
    const saved = connectionId
      ? this.data.connections.find(
          (c) => c.id === connectionId && c.providerId === providerId,
        )
      : undefined;
    if (connectionId && !saved) throw new Error("请选择已保存的连接");
    const id = saved?.id ?? randomUUID();
    const runtime = await this.runtime(id);
    if (!runtime.getProvider(providerId))
      throw new Error("当前 Pi 目录中没有该供应商");
    if (!saved) this.drafts.add(id);
    const modelsJson = await readFile(this.paths(id).modelsPath, "utf8").catch(
      (error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "{}";
        throw error;
      },
    );
    const catalogSource = JSON.parse(modelsJson).providers?.[providerId]
      ? "custom"
      : "builtin";
    this.candidate = {
      id,
      providerId,
      catalogSource,
      runtime,
      useEnvironment: saved?.useEnvironment ?? false,
      serverDefaultOutputModelId: saved?.serverDefaultOutputModelId,
    };
    this.state.authEvents = [];
    this.state.authPrompt = undefined;
    this.syncAuth();
  }
  async select(input: unknown) {
    return this.serial(async () => {
      const value = selectModelConnectionSchema.parse(input);
      await this.cancelLogin();
      await this.choose(value.providerId, value.connectionId);
      this.state.message = "已选择连接，保存后用于后续任务";
      this.changed();
    });
  }
  async configure(input: unknown) {
    return this.serial(async () => {
      const value = customModelsSchema.parse(input);
      const config = JSON.parse(value.modelsJson);
      if (
        !config ||
        typeof config !== "object" ||
        !config.providers?.[value.providerId]
      )
        throw new Error("请填写包含所选供应商的 Pi models.json");
      await this.cancelLogin();
      const id = randomUUID();
      this.drafts.add(id);
      await writePrivateJson(this.paths(id).modelsPath, config);
      const runtime = await this.runtime(id);
      if (
        runtime.getError() ||
        !runtime.getProvider(value.providerId) ||
        !runtime.getModels(value.providerId).length
      )
        throw new Error("Pi models.json 校验失败，请检查供应商和模型配置");
      const { getSupportedThinkingLevels } = await piSdk();
      this.supportedThinking = (model) => [
        ...getSupportedThinkingLevels(model),
      ];
      this.candidate = {
        id,
        providerId: value.providerId,
        catalogSource: "custom",
        runtime,
        useEnvironment: false,
      };
      this.state.authEvents = [];
      this.syncAuth();
      this.state.message = "Pi 自定义目录已载入，请完成认证并保存连接";
      this.changed();
    });
  }
  async login(input: unknown) {
    return this.serial(() => this.startLogin(input));
  }
  private async startLogin(input: unknown) {
    const value = loginModelSchema.parse(input);
    if (!this.candidate || this.closed || this.loginAbort)
      throw new Error("请先选择连接，或等待当前登录完成");
    const candidate = this.candidate;
    if (value.authType === "environment") {
      candidate.useEnvironment = true;
      await candidate.runtime.refresh({
        providers: [candidate.providerId],
        allowNetwork: false,
      });
      this.syncAuth();
      this.changed();
      return;
    }
    // Each authorization uses a new connection directory. Existing leases retain their credential.
    if (!this.drafts.has(candidate.id)) {
      const id = randomUUID();
      for (const field of ["modelsPath", "modelsStorePath"] as const)
        try {
          await writePrivateJson(
            this.paths(id)[field],
            JSON.parse(await readFile(this.paths(candidate.id)[field], "utf8")),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      this.drafts.add(id);
      this.candidate = {
        ...candidate,
        id,
        replacesId: candidate.id,
        settings: this.data.connections.find(
          (connection) => connection.id === candidate.id,
        ),
        runtime: await this.runtime(id),
        useEnvironment: false,
      };
    }
    const authType = value.authType;
    const target = this.candidate!;
    const controller = (this.loginAbort = new AbortController());
    this.state.auth = "logging_in";
    this.state.authEvents = [];
    this.state.authPrompt = undefined;
    this.state.message = "请按 Pi 提示完成认证";
    this.changed();
    const notify = (event: AuthEvent) => {
      if (controller.signal.aborted || this.candidate !== target) return;
      if (event.type === "auth_url")
        this.state.authEvents.push({
          type: "auth_url",
          url: event.url,
          instructions: event.instructions,
        });
      else if (event.type === "device_code")
        this.state.authEvents.push({
          type: "device_code",
          userCode: event.userCode,
          verificationUri: event.verificationUri,
        });
      else
        this.state.authEvents.push({
          type: event.type,
          message: event.message,
          ...(event.type === "info" ? { links: event.links } : {}),
        });
      this.state.authEvents = [
        ...this.state.authEvents
          .filter(
            (item) => item.type === "auth_url" || item.type === "device_code",
          )
          .slice(-2),
        ...this.state.authEvents
          .filter(
            (item) => item.type !== "auth_url" && item.type !== "device_code",
          )
          .slice(-10),
      ];
      this.changed();
    };
    const prompt = (question: AuthPrompt): Promise<string> =>
      new Promise((resolve, reject) => {
        if (controller.signal.aborted || question.signal?.aborted) {
          reject(new Error("cancelled"));
          return;
        }
        const id = randomUUID();
        const cleanup = () =>
          question.signal?.removeEventListener("abort", abort);
        const abort = () => {
          cleanup();
          reject(new Error("cancelled"));
          if (this.answer?.id === id) {
            this.answer = undefined;
            this.state.authPrompt = undefined;
            this.changed();
          }
        };
        question.signal?.addEventListener("abort", abort, { once: true });
        this.answer = {
          id,
          resolve: (value) => {
            cleanup();
            resolve(value);
          },
          reject: (error) => {
            cleanup();
            reject(error);
          },
        };
        const { signal: _signal, ...fields } = question;
        this.state.authPrompt = { ...fields, id };
        this.changed();
      });
    this.loginWork = (async () => {
      try {
        let deviceId: string;
        const deviceFile = join(this.dependencies.root, "device.json");
        try {
          deviceId = JSON.parse(await readFile(deviceFile, "utf8")).id;
        } catch {
          deviceId = randomUUID();
          await writePrivateJson(deviceFile, { id: deviceId });
        }
        await target.runtime.login(
          target.providerId,
          authType,
          { signal: controller.signal, prompt, notify },
          { agentName: "Postrove", getDeviceId: () => deviceId },
        );
        this.state.message = controller.signal.aborted
          ? "登录已取消，原连接继续使用"
          : "认证已完成，请选择模型并保存连接";
      } catch {
        // Provider errors may contain secrets or login callback URLs.
        this.state.message = controller.signal.aborted
          ? "登录已取消，原连接继续使用"
          : "Pi 认证未完成，请检查输入或重试。原连接继续使用";
      } finally {
        if (controller.signal.aborted)
          await target.runtime.logout(target.providerId).catch(() => {});
        this.answer?.reject(new Error("completed"));
        this.answer = undefined;
        this.state.authPrompt = undefined;
        this.state.authEvents = [];
        this.loginAbort = undefined;
        this.loginWork = undefined;
        this.syncAuth();
        this.changed();
      }
    })();
  }
  respond(input: unknown) {
    const value = authAnswerSchema.parse(input);
    if (!this.answer || value.id !== this.answer.id)
      throw new Error("认证提示已更新，请重试");
    const prompt = this.state.authPrompt;
    if (
      prompt?.type === "select" &&
      !prompt.options?.some((o) => o.id === value.value)
    )
      throw new Error("请选择 Pi 提供的选项");
    const answer = this.answer;
    this.answer = undefined;
    this.state.authPrompt = undefined;
    answer.resolve(value.value);
    this.changed();
  }
  async openAuthUrl(input: unknown) {
    if (typeof input !== "string") throw new Error("无效登录地址");
    const known = this.state.authEvents.some((e) =>
      e.type === "auth_url"
        ? e.url === input
        : e.type === "device_code"
          ? e.verificationUri === input
          : e.links?.some((link) => link.url === input),
    );
    const url = new URL(input);
    if (
      !known ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )) ||
      url.username ||
      url.password
    )
      throw new Error("无效登录地址");
    await this.dependencies.openLogin(input);
  }
  async cancelLogin() {
    this.loginAbort?.abort();
    this.answer?.reject(new Error("cancelled"));
    await this.loginWork;
  }
  async refresh() {
    return this.serial(async () => {
      if (this.closed || this.loginAbort) throw new Error("请等待认证完成");
      if (!this.candidate) {
        this.changed();
        return;
      }
      const candidate = this.candidate;
      try {
        // Finish native credential rotation before starting the cancellable catalog
        // fetch. Shutdown waits for this serialized operation to settle.
        await candidate.runtime.getAuth(candidate.providerId);
        const result = await candidate.runtime.refresh({
          providers: [candidate.providerId],
          allowNetwork: true,
          signal: AbortSignal.timeout(20_000),
        });
        if (result.aborted || result.errors.size)
          throw new Error("Pi catalog refresh incomplete");
        this.state.catalog = "ready";
        this.state.message = "Pi 目录已刷新";
      } catch {
        this.state.catalog = "failed";
        this.state.message = "Pi 目录刷新失败，已保留当前目录和连接";
      }
      this.syncAuth();
      this.changed();
    });
  }
  async save(input: unknown) {
    return this.serial(async () => {
      if (this.closed || this.loginAbort) throw new Error("请等待认证完成");
      const value = nativeSaveModelSchema.parse(input);
      const candidate = this.candidate;
      if (!candidate || candidate.id !== value.connectionId)
        throw new Error("连接选择已变化，请重试");
      const model = candidate.runtime.getModel(
        candidate.providerId,
        value.modelId,
      );
      if (!model) throw new Error("请从 Pi 目录选择模型");
      const status = candidate.runtime.getProviderAuthStatus(
        candidate.providerId,
      );
      if (!status.configured) throw new Error("请先完成 Pi 认证");
      if (
        !(await candidate.runtime.getAvailable(candidate.providerId)).some(
          (item) => item.id === model.id,
        )
      )
        throw new Error("当前 Pi 认证下没有所选模型，请刷新目录或重新认证");
      const levels = this.supportedThinking(model);
      if (!Object.keys(value.options.apiOptions).length) {
        resolveThinking(levels, value.options.browserThinking, "browser");
        resolveThinking(levels, value.options.readingThinking, "reading");
      }
      if (status.source === "environment" || status.source === "fallback")
        candidate.useEnvironment = true;
      const connection: PiConnection = {
        id: candidate.id,
        providerId: candidate.providerId,
        name:
          value.name ??
          candidate.runtime.getProvider(candidate.providerId)!.name,
        modelId: model.id,
        options: value.options,
        useEnvironment: candidate.useEnvironment,
        ...(candidate.serverDefaultOutputModelId === model.id
          ? { serverDefaultOutputModelId: model.id }
          : {}),
      };
      const replacesId = candidate.replacesId;
      const next: PiConnections = {
        ...this.data,
        activeId: connection.id,
        legacyMigrated: true,
        connections: [
          ...this.data.connections.filter(
            (c) => c.id !== connection.id && c.id !== replacesId,
          ),
          connection,
        ],
        retiredIds: [
          ...new Set([
            ...this.data.retiredIds,
            ...(replacesId ? [replacesId] : []),
          ]),
        ],
      };
      await this.store.save(next);
      this.data = next;
      this.drafts.delete(connection.id);
      candidate.replacesId = undefined;
      candidate.settings = undefined;
      this.generation++;
      this.state.checkIsCurrent = false;
      this.state.message = "已保存，新连接将用于后续任务";
      this.changed();
      // Old leases own the remaining cleanup reference until their tasks finish.
      await this.retireLegacySource();
      if (replacesId) await this.cleanupRetired(replacesId);
    });
  }
  async acquire() {
    return this.serial(async () => {
      if (this.closed) throw new Error("应用正在退出");
      const active = this.data.connections.find(
        (c) => c.id === this.data.activeId,
      );
      if (!active) throw new Error("请先保存模型连接");
      const runtime = await this.runtime(active.id);
      const model = runtime.getModel(active.providerId, active.modelId);
      if (
        !model ||
        !runtime.getProviderAuthStatus(active.providerId).configured
      )
        throw new Error("当前 Pi 连接需要重新配置或认证");
      const levels = this.supportedThinking(model);
      const advanced = Object.keys(active.options.apiOptions).length > 0;
      const config: ModelExecutionConfig = {
        method: "pi",
        connectionId: active.id,
        providerId: active.providerId,
        modelId: active.modelId,
        credential: "",
        ...this.paths(active.id),
        model: {
          ...structuredClone(model),
          ...(active.serverDefaultOutputModelId === model.id &&
          active.options.maxTokens === undefined
            ? { maxTokens: 0 }
            : {}),
        },
        useEnvironment: active.useEnvironment,
        options: structuredClone(active.options),
        thinking: {
          browser: resolveThinking(
            levels,
            advanced ? "task_default" : active.options.browserThinking,
            "browser",
          ),
          reading: resolveThinking(
            levels,
            advanced ? "task_default" : active.options.readingThinking,
            "reading",
          ),
        },
      };
      this.references.set(active.id, (this.references.get(active.id) ?? 0) + 1);
      let released = false;
      return {
        config,
        generation: this.generation,
        release: async () => {
          if (released) return;
          released = true;
          await this.serial(async () => {
            this.references.set(
              active.id,
              Math.max(0, (this.references.get(active.id) ?? 1) - 1),
            );
            await this.cleanupRetired(active.id);
          });
        },
      };
    });
  }
  async runCheck() {
    if (this.checking) throw new Error("连接检查正在运行");
    const controller = (this.checkAbort = new AbortController());
    this.state.check = "running";
    this.state.checkFailure = undefined;
    this.changed();
    this.checking = (async () => {
      let lease: Awaited<ReturnType<ModelService["acquire"]>> | undefined;
      try {
        lease = await this.acquire();
        this.state.checkModelId = lease.config.modelId;
        this.changed();
        controller.signal.throwIfAborted();
        await this.dependencies.check(lease.config, controller.signal);
        this.state.check = controller.signal.aborted ? "cancelled" : "passed";
      } catch (error) {
        this.state.check = controller.signal.aborted ? "cancelled" : "failed";
        if (!controller.signal.aborted)
          this.state.checkFailure = classifyModelError(error);
      } finally {
        this.state.checkIsCurrent = lease?.generation === this.generation;
        await lease?.release();
        this.checkAbort = undefined;
        this.checking = undefined;
        this.changed();
      }
    })();
  }
  cancelCheck() {
    this.checkAbort?.abort();
  }
  async remove(input: unknown) {
    return this.serial(async () => {
      const value = nativeSaveModelSchema
        .pick({ connectionId: true })
        .parse(input);
      if (
        !this.data.connections.some(
          (connection) => connection.id === value.connectionId,
        )
      )
        throw new Error("请选择已保存的连接");
      await this.cancelLogin();
      const next = {
        ...this.data,
        connections: this.data.connections.filter(
          (connection) => connection.id !== value.connectionId,
        ),
        activeId:
          this.data.activeId === value.connectionId
            ? undefined
            : this.data.activeId,
        retiredIds: [...new Set([...this.data.retiredIds, value.connectionId])],
      };
      await this.store.save(next);
      this.data = next;
      if (this.candidate?.id === value.connectionId) {
        this.candidate = undefined;
        this.state.auth = "signed_out";
        this.state.authSource = undefined;
      }
      this.generation++;
      this.state.checkIsCurrent = false;
      this.state.message = "连接已移除；运行中任务结束后清理本地认证";
      this.changed();
      await this.cleanupRetired(value.connectionId);
    });
  }
  private async cleanupRetired(id: string) {
    if (!this.data.retiredIds.includes(id) || this.references.get(id)) return;
    try {
      // Pi logout deletes local native credentials; provider-side revocation stays
      // in the provider's account controls.
      const runtime = this.runtimes.get(id);
      if (runtime)
        for (const credential of await runtime.listCredentials())
          await runtime.logout(credential.providerId).catch(() => {});
      await rm(join(this.dependencies.root, "connections", id), {
        recursive: true,
        force: true,
      });
      this.runtimes.delete(id);
      this.references.delete(id);
      const next = {
        ...this.data,
        retiredIds: this.data.retiredIds.filter((retired) => retired !== id),
      };
      await this.store.save(next);
      this.data = next;
    } catch {
      this.state.message = "连接已移除，本地认证清理将在重启时继续";
      this.changed();
    }
  }
  private async retireLegacySource() {
    try {
      await this.dependencies.storage.retire?.();
    } catch {
      this.state.message = "连接已保存，旧认证副本清理将在重启时继续";
      this.changed();
    }
  }
  async close() {
    this.closed = true;
    this.cancelCheck();
    await this.cancelLogin();
    await this.checking;
    await this.pending;
    for (const id of this.drafts)
      await rm(join(this.dependencies.root, "connections", id), {
        recursive: true,
        force: true,
      });
  }
}
