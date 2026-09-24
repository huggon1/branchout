import type { Direction } from "../../shared/project-contracts";
// Only these public, generic phrases may reach GitHub. Model-provided text cannot become a query.
export const concepts = {
  knowledge: "knowledge management",
  reading: "reading application",
  feeds: "rss reader",
  research: "research assistant",
  notes: "note taking",
  search: "search interface",
  workflow: "workflow automation",
  tasks: "task management",
  dashboard: "dashboard",
  editor: "document editor",
  navigation: "navigation interface",
  accessibility: "accessibility",
  design: "design system",
  forms: "form interface",
  collaboration: "collaboration application",
  developer: "developer tools",
  desktop: "desktop application",
  visualization: "data visualization",
  library: "digital library",
  publishing: "content publishing",
  offline: "offline application",
} as const;
export type Concept = keyof typeof concepts;
export function explorationPlan(direction: Direction) {
  return {
    platforms: ["github"] as const,
    minSearches: 2,
    maxSearches: 4,
    maxMaterials: 3,
    maxReads: 6,
    focus:
      direction === "product"
        ? "关注产品能力、使用场景与可借鉴的功能边界。"
        : "关注信息架构、阅读流程、交互与可访问性。",
  };
}
