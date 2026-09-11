import { spawn } from "node:child_process";
import { join } from "node:path";
import { fetchTrending } from "../adapters/github.mjs";
import {
  normalizeXSearch,
  normalizeXhsSearch,
  xhsImages,
} from "../adapters/social.mjs";
import { generateText } from "../adapters/model.mjs";
import { configureNetwork } from "../adapters/network.mjs";
import type { SourceMaterial } from "./contracts.js";
configureNetwork();
const port = (process as any).parentPort;
const controller = new AbortController();
async function request(url: string, init: any = {}, seconds = 30) {
  const r = await fetch(url, {
    ...init,
    signal: AbortSignal.any([
      controller.signal,
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
  if (!r.ok) throw Error(`请求失败（${r.status}）`);
  return r;
}
async function xhs(data: any, path: string, body?: any) {
  const r = await request(
    `${data.xhs.url}/api/v1/${path}`,
    {
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
  if (!result.success)
    throw Error("小红书暂时无法完成请求，请检查登录或稍后重试");
  return result;
}
async function githubRepo(url: string): Promise<SourceMaterial> {
  const u = new URL(url);
  if (u.hostname !== "github.com") throw Error("只支持 GitHub 仓库链接");
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || !parts.slice(0, 2).every((s) => /^[\w.-]+$/.test(s)))
    throw Error("无效仓库链接");
  const repo = parts.slice(0, 2).join("/");
  const result: SourceMaterial = {
    schemaVersion: 1,
    source: "github",
    sourceId: repo.toLowerCase(),
    canonicalUrl: `https://github.com/${repo}`,
    title: repo,
    author: parts[0],
    text: "",
    completeness: "partial",
    publishedAt: null,
    metrics: {},
    images: [],
  };
  try {
    const r = await request(`https://api.github.com/repos/${repo}/readme`, {
      headers: { Accept: "application/vnd.github.raw+json" },
    });
    const body = await r.text();
    if (body.length > 500000) throw Error("README 过长");
    result.text = body;
    result.completeness = "complete";
    return result;
  } catch {
    const r = await request(
      `https://raw.githubusercontent.com/${repo}/HEAD/README.md`,
    );
    const body = await r.text();
    if (body.length > 500000) throw Error("README 过长");
    result.text = body;
    result.completeness = "complete";
    return result;
  }
}
async function xhsDetail(data: any, id: string, token: string) {
  const d = await xhs(data, "feeds/detail", {
    feed_id: id,
    xsec_token: token,
    load_all_comments: false,
    comment_config: {
      click_more_replies: false,
      max_comment_items: 1,
      max_replies_threshold: 1,
      scroll_speed: "fast",
    },
  });
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
    text: note.desc,
    completeness: "complete",
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
        u.hostname === "www.xhslink.com" ||
        u.hostname === "xiaohongshu.com" ||
        u.hostname.endsWith(".xiaohongshu.com")
      )
    )
      throw Error("只支持 GitHub 和小红书链接");
    if (u.hostname.endsWith("xiaohongshu.com")) break;
    const r = await fetch(u, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
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
async function collect(data: any) {
  const c = data.config;
  let rows: any[];
  if (c.platform === "github") {
    const r = await fetchTrending({
      period: c.period,
      limit: c.limit,
      thresholds: c.thresholds,
    });
    rows = r.materials;
    for (const row of rows) {
      try {
        const detail = await githubRepo(row.canonicalUrl);
        row.text = detail.text;
        row.completeness = detail.completeness;
      } catch {
        /* Search description remains explicitly partial. */
      }
    }
    return rows;
  }
  if (c.platform === "xiaohongshu") {
    const result = await xhs(data, "feeds/search", {
      keyword: c.keyword,
      filters: {
        publish_time: c.period === "daily" ? "一天内" : "一周内",
        sort_by: "最多点赞",
      },
    });
    rows = normalizeXhsSearch(result);
    rows = filter(rows, c);
    for (const row of rows) {
      const raw = result.data.feeds.find((f: any) => f.id === row.sourceId);
      try {
        Object.assign(
          row,
          await xhsDetail(data, row.sourceId, raw?.xsecToken || ""),
        );
      } catch {
        /* Keep partial search record. */
      }
    }
    return rows;
  }
  const days = c.period === "daily" ? 1 : c.period === "weekly" ? 7 : 30;
  const since = new Date(Date.now() - days * 86400000)
    .toISOString()
    .slice(0, 10);
  const query = `${c.keyword} since:${since}`;
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
        String(c.limit),
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
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    if (child.pid) port.postMessage({ type: "child", pid: child.pid });
    let raw = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("X 搜索超时"));
    }, 45000);
    controller.signal.addEventListener("abort", () => child.kill(), {
      once: true,
    });
    child.stdout.on("data", (b) => {
      raw += b;
      if (raw.length > 5000000) child.kill();
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(Error("X 采集组件无法启动"));
    });
    child.on("exit", (code) => {
      port.postMessage({ type: "childExit", pid: child.pid });
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(raw);
        if (code !== 0 || !Array.isArray(parsed)) throw Error();
        resolve(normalizeXSearch(parsed));
      } catch {
        reject(Error("X 搜索失败，请检查登录或稍后重试"));
      }
    });
  });
  return filter(rows, c);
}
function filter(rows: any[], c: any) {
  return rows
    .filter((r) =>
      Object.entries(c.thresholds).every(
        ([k, v]) =>
          Number.isFinite(r.metrics[k]) && r.metrics[k] >= (v as number),
      ),
    )
    .slice(0, c.limit);
}
port.on("message", async ({ data }: any) => {
  if (data.type === "cancel") {
    controller.abort();
    return;
  }
  try {
    let result;
    if (data.type === "model")
      result = await generateText({
        ...data,
        signal: controller.signal,
        onProgress: () => port.postMessage({ type: "progress" }),
      });
    else if (data.type === "collect") result = await collect(data);
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
