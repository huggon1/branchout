import type {
  Repo,
  Understanding,
  Exploration,
} from "../../src/core/workspace-contracts.js";
import type { SourceMaterial } from "../../src/core/contracts.js";
import { templates } from "../../src/core/templates.js";
export const repo: Repo = {
  id: "repo-one",
  fullName: "fictional/workspace",
  url: "https://github.com/fictional/workspace",
  private: false,
  branch: "main",
  createdAt: "2026-09-15T00:00:00Z",
};
export const understanding: Understanding = {
  id: "understanding-one",
  repoId: repo.id,
  version: 1,
  createdAt: "2026-09-15T00:00:00Z",
  commit: "a".repeat(40),
  branch: "main",
  product: "虚构产品：帮助个人阅读与整理信息",
  users: ["个人读者"],
  problems: ["信息过载"],
  scenarios: ["收集后阅读"],
  constraints: [],
  uncertainties: ["用户需求尚需验证"],
  evidence: [
    {
      path: "README.md",
      excerpt: "read saved links",
      url: `${repo.url}/blob/${"a".repeat(40)}/README.md`,
    },
  ],
  publicContext: {
    product: "Personal reading and information organization",
    users: ["readers"],
    problems: ["information overload"],
    scenarios: ["reading saved links"],
  },
};
export const source: SourceMaterial = {
  schemaVersion: 1,
  source: "github",
  sourceId: "sample/reader",
  canonicalUrl: "https://github.com/sample/reader",
  title: "Sample reader",
  author: "sample",
  text: "A fictional reader saves links for offline reading. It helps people manage information overload and find their saved sources.",
  completeness: "complete",
  publishedAt: "2020-01-01T00:00:00Z",
  metrics: { stars: 10 },
  images: [],
  context: { pushedAt: "2026-09-14T12:00:00Z" },
};
export function exploration(id = "exploration-one"): Exploration {
  return {
    id,
    batchId: "batch-one",
    repoId: repo.id,
    repoName: repo.fullName,
    understanding,
    template: templates[0],
    platforms: ["github"],
    period: "weekly",
    startedAt: "2026-09-15T00:00:00Z",
    state: "pending",
    events: [],
    outcomes: {},
    usage: { queries: 0, reads: 0, modelCalls: 0, candidates: 0 },
    attempts: 0,
  };
}
