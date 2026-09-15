import { fetchReadme } from "../adapters/readme.mjs";
import { SourceMaterial as SourceMaterialSchema } from "./contracts.js";
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  fetchTrending,
  fetchRepositorySearch,
  githubRequestError,
  SourceError,
} from "../adapters/github.mjs";
import {
  normalizeXSearch,
  normalizeXhsSearch,
  xhsImages,
} from "../adapters/social.mjs";
import { configureNetwork } from "../adapters/network.mjs";
import {
  hydrateCandidates,
  retrievalLimit,
  selectRetrieved,
  sourceWindow,
} from "../adapters/retrieval.mjs";
import type { SourceMaterial } from "./contracts.js";
configureNetwork();
const port = (process as any).parentPort;
const controller = new AbortController();
async function request(url: string, init: any = {}, seconds = 30) {
  const r = await fetch(url, {
    ...init,
    signal: AbortSignal.any([
      controller.signal,
      ...(init.signal ? [init.signal] : []),
      AbortSignal.timeout(seconds * 1000),
    ]),
  }).catch((e) => {
    if (controller.signal.aborted) throw Error("已取消");
    throw Error(
      e?.name === "TimeoutError"
        ? "网络请求超时，请稍后重试"
        : "网络连接失败，请检查系统代理或稍后重试",
    );
  });
  if (!r.ok) {
    if (new URL(url).hostname === "api.github.com") throw githubRequestError(r);
    if (r.status === 401 || r.status === 403)
      throw new SourceError("login_required", "平台登录失效，请重新连接");
    if (r.status === 429)
      throw new SourceError("rate_limited", "平台请求频率受限，请稍后重试");
    throw Error(`请求失败（${r.status}）`);
  }
  return r;
}
async function xhs(data: any, path: string, body?: any, signal?: AbortSignal) {
  const r = await request(
    `${data.xhs.url}/api/v1/${path}`,
    {
      signal,
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${data.xhs.token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    45,
  );
  const result = (await r.json()) as any;
  if (!result.success) {
    const message = String(result.message || result.error || "");
    if (/login|登录|cookie|unauthorized/i.test(message))
      throw new SourceError("login_required", "小红书登录失效，请重新连接");
    if (/rate.?limit|频繁|429/i.test(message))
      throw new SourceError("rate_limited", "小红书请求频率受限，请稍后重试");
    throw Error("小红书暂时无法完成请求，请检查登录或稍后重试");
  }
  return result;
}
const readmeApiState = { limited: false };
async function githubRepo(
  url: string,
  signal?: AbortSignal,
): Promise<SourceMaterial> {
  return SourceMaterialSchema.parse(
    await fetchReadme(url, {
      apiState: readmeApiState,
      signal: AbortSignal.any([
        controller.signal,
        ...(signal ? [signal] : []),
        AbortSignal.timeout(60000),
      ]),
    }),
  );
}
async function xhsDetail(
  data: any,
  id: string,
  token: string,
  signal?: AbortSignal,
) {
  const d = await xhs(
    data,
    "feeds/detail",
    {
      feed_id: id,
      xsec_token: token,
      load_all_comments: false,
      comment_config: {
        click_more_replies: false,
        max_comment_items: 1,
        max_replies_threshold: 1,
        scroll_speed: "fast",
      },
    },
    signal,
  );
  const note = d.data?.data?.note;
  if (!note || typeof note.desc !== "string")
    throw Error("笔记正文暂时无法解析");
  const base = normalizeXhsSearch({
    success: true,
    data: {
      feeds: [
        {
          id,
          noteCard: { ...note, displayTitle: note.title },
          modelType: "note",
        },
      ],
    },
  })[0];
  return {
    ...base,
    text: note.desc.slice(0, 500000),
    completeness: note.desc.length > 500000 ? "partial" : "complete",
    publishedAt: Number.isFinite(note.time)
      ? new Date(note.time).toISOString()
      : null,
    images: xhsImages(note.imageList),
  };
}
async function parse(data: any) {
  let u = new URL(data.url);
  if (u.protocol !== "https:") throw Error("只支持 HTTPS 链接");
  if (u.hostname === "github.com") return githubRepo(data.url);
  for (let i = 0; i < 5; i++) {
    if (
      !(
        u.hostname === "xhslink.com" ||
        u.hostname === "xhslink.cn" ||
        u.hostname === "www.xhslink.cn" ||
        u.hostname === "www.xhslink.com" ||
        u.hostname === "xiaohongshu.com" ||
        u.hostname.endsWith(".xiaohongshu.com")
      )
    )
      throw Error("只支持 GitHub 和小红书链接");
    if (u.hostname.endsWith("xiaohongshu.com")) break;
    const r = await fetch(u, {
      redirect: "manual",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    });
    if (r.status < 300 || r.status >= 400) break;
    const loc = r.headers.get("location");
    if (!loc) break;
    u = new URL(loc, u);
    if (u.protocol !== "https:") throw Error("链接跳转不受支持");
  }
  if (
    !(
      u.hostname === "xiaohongshu.com" ||
      u.hostname.endsWith(".xiaohongshu.com")
    )
  )
    throw Error("短链接未能解析到小红书");
  const id = u.pathname.match(/\/(?:explore|discovery\/item)\/([\w-]+)/)?.[1];
  if (!id) throw Error("无法识别笔记链接");
  return xhsDetail(data, id, u.searchParams.get("xsec_token") || "");
}
function progress(
  phase: "searching" | "reading",
  message: string,
  retrieved?: number,
) {
  port.postMessage({ type: "progress", phase, message, retrieved });
}
async function collect(data: any) {
  const c = data.config;
  const limit = retrievalLimit(data);
  let rows: any[];
  progress("searching", "正在检索平台候选内容");
  if (c.platform === "github") {
    const r =
      c.searchMode === "search"
        ? await fetchRepositorySearch({
            keyword: c.keyword,
            period: c.period,
            limit,
            signal: controller.signal,
            onProgress: (page: number) =>
              progress("searching", `正在搜索 GitHub 仓库，第 ${page} 页`),
          })
        : await fetchTrending({
            period: c.period,
            limit,
            thresholds: c.thresholds,
            candidateMode: Boolean(data.candidateMode),
            signal: controller.signal,
          });
    rows = selectRetrieved(r.materials, data);
    if ("incomplete" in r && r.incomplete)
      progress("searching", "GitHub 返回了部分搜索结果", rows.length);
    await hydrateCandidates(
      rows,
      (row: any, signal: AbortSignal) =>
        githubRepo(row.canonicalUrl, signal).then((detail) => ({
          text: detail.text,
          completeness: detail.completeness,
          context: { ...row.context, ...detail.context },
          images: detail.images,
        })),
      {
        signal: controller.signal,
        onWarning: (code: string) =>
          progress(
            "reading",
            code === "login_required"
              ? "正文读取时登录失效，已保留搜索候选"
              : code === "rate_limited"
                ? "正文读取频率受限，已保留搜索候选"
                : "部分正文未获取完整，已保留搜索候选",
            rows.length,
          ),
        onProgress: (index: number) =>
          progress(
            "reading",
            `正在读取仓库正文 ${index + 1}/${rows.length}`,
            rows.length,
          ),
      },
    );
    return rows;
  }
  if (c.platform === "xiaohongshu") {
    if (!["daily", "weekly"].includes(c.period))
      throw Error("小红书目前只支持一天内或一周内");
    const result = await xhs(data, "feeds/search", {
      keyword: c.keyword,
      filters: {
        publish_time: c.period === "daily" ? "一天内" : "一周内",
        sort_by: "最多点赞",
      },
    });
    rows = selectRetrieved(normalizeXhsSearch(result), data);
    await hydrateCandidates(
      rows,
      (row: any, signal: AbortSignal) => {
        const raw = result.data.feeds.find((f: any) => f.id === row.sourceId);
        return xhsDetail(data, row.sourceId, raw?.xsecToken || "", signal);
      },
      {
        signal: controller.signal,
        onWarning: (code: string) =>
          progress(
            "reading",
            code === "login_required"
              ? "正文读取时登录失效，已保留搜索候选"
              : code === "rate_limited"
                ? "正文读取频率受限，已保留搜索候选"
                : "部分正文未获取完整，已保留搜索候选",
            rows.length,
          ),
        onProgress: (index: number) =>
          progress(
            "reading",
            `正在读取小红书正文 ${index + 1}/${rows.length}`,
            rows.length,
          ),
      },
    );
    return data.candidateMode ? rows : selectRetrieved(rows, data);
  }
  if (c.platform !== "x") throw Error("不支持的收集平台");
  const { since } = sourceWindow(c.period);
  const keyword = String(c.keyword || "")
    .replace(/(?:^|\s)(?:since|until):\S+/gi, " ")
    .trim();
  if (!keyword || keyword.length > 200) throw Error("X 搜索词无效");
  const query = `${keyword} since:${since}`;
  rows = await new Promise<any[]>((resolve, reject) => {
    if (!data.x?.authToken || !data.x?.ct0) {
      reject(Error("请先连接 X"));
      return;
    }
    const child = spawn(
      process.execPath,
      [
        join(data.runtime, "bird-search/bird-search.mjs"),
        query,
        "--count",
        String(limit),
        "--json",
      ],
      {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          ELECTRON_RUN_AS_NODE: "1",
          NODE_USE_ENV_PROXY: "1",
          HTTPS_PROXY: process.env.HTTPS_PROXY,
          HTTP_PROXY: process.env.HTTP_PROXY,
          AUTH_TOKEN: data.x.authToken,
          CT0: data.x.ct0,
          BIRD_DISABLE_BROWSER_COOKIES: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (child.pid) port.postMessage({ type: "child", pid: child.pid });
    let raw = "";
    let errorOutput = "";
    let failure: string | undefined;
    child.stderr.on("data", (b) => {
      errorOutput = (errorOutput + b).slice(-8000);
    });
    const timer = setTimeout(() => {
      failure = "X 搜索超时";
      child.kill();
      reject(Error(failure));
    }, 45000);
    const cancel = () => {
      child.kill();
      reject(Error("已取消"));
    };
    controller.signal.addEventListener("abort", cancel, { once: true });
    child.stdout.on("data", (b) => {
      raw += b;
      if (raw.length > 5000000) {
        failure = "X 搜索响应过大";
        child.kill();
      }
    });
    child.on("error", () => {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", cancel);
      reject(Error("X 采集组件无法启动"));
    });
    child.on("close", (code) => {
      port.postMessage({ type: "childExit", pid: child.pid });
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", cancel);
      if (controller.signal.aborted) {
        reject(Error("已取消"));
        return;
      }
      if (failure) {
        reject(Error(failure));
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (code !== 0 || !Array.isArray(parsed)) throw Error();
        resolve(normalizeXSearch(parsed));
      } catch {
        if (/429|rate.?limit|too many requests/i.test(errorOutput))
          reject(new SourceError("rate_limited", "X 请求频率受限，请稍后重试"));
        else if (
          /401|403|unauthorized|authenticate|not logged|expired/i.test(
            errorOutput,
          )
        )
          reject(new SourceError("login_required", "X 登录失效，请重新连接"));
        else reject(Error("X 搜索失败，请检查登录或稍后重试"));
      }
    });
  });
  progress("searching", "X 候选检索完成", rows.length);
  return selectRetrieved(rows, data);
}
port.on("message", async ({ data }: any) => {
  if (data.type === "cancel") {
    controller.abort();
    return;
  }
  try {
    let result;
    if (data.type === "model") {
      const { generateText } = await import("../adapters/model.mjs");
      result = await generateText({
        ...data,
        signal: controller.signal,
        onProgress: () => port.postMessage({ type: "progress" }),
      });
    } else if (data.type === "collect") result = await collect(data);
    else if (data.type === "parse") result = await parse(data);
    else throw Error("不支持的操作");
    port.postMessage({ type: "result", result });
  } catch (e: any) {
    port.postMessage({
      type: "error",
      error:
        e.code === "login_required"
          ? e.message
          : controller.signal.aborted
            ? "已取消"
            : e instanceof Error && e.message.length < 120
              ? e.message
              : "执行失败，请重试",
    });
  }
});
