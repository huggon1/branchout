import xSearch from "./skills/x-search/SKILL.md";
import xhsSearch from "./skills/xiaohongshu-search/SKILL.md";
import xReading from "./skills/x-reading/SKILL.md";
import xhsReading from "./skills/xiaohongshu-reading/SKILL.md";
import githubReading from "./skills/github-reading/SKILL.md";
import webReading from "./skills/web-reading/SKILL.md";

export interface PlatformSkillSummary {
  name: string;
  description: string;
}

function skill(
  content: string,
  parseFrontmatter: typeof import("@earendil-works/pi-coding-agent").parseFrontmatter,
) {
  const { frontmatter } = parseFrontmatter(content);
  const { name, description } = frontmatter;
  if (
    typeof name !== "string" ||
    !/^[a-z0-9-]{1,64}$/.test(name) ||
    typeof description !== "string" ||
    !description.trim()
  )
    throw new Error("Invalid bundled platform skill");
  return { name, description, content };
}

const contents = [
  xSearch,
  xhsSearch,
  xReading,
  xhsReading,
  githubReading,
  webReading,
];

let cached: Promise<ReturnType<typeof skill>[]> | undefined;
export function platformSkills() {
  return (cached ??= import("@earendil-works/pi-coding-agent").then(
    ({ parseFrontmatter }) =>
      contents.map((content) => skill(content, parseFrontmatter)),
  ));
}

export async function platformSkillCatalog(
  purpose: string,
  platform: string,
): Promise<PlatformSkillSummary[]> {
  return (await platformSkills())
    .filter((item) =>
      purpose === "search"
        ? item.name === `${platform}-search`
        : item.name.endsWith("-reading"),
    )
    .map(({ name, description }) => ({ name, description }));
}

export async function loadPlatformSkill(
  name: string,
  purpose: string,
  platform: string,
) {
  if (
    !(await platformSkillCatalog(purpose, platform)).some(
      (item) => item.name === name,
    )
  )
    throw new Error("Platform skill is outside this task's catalog");
  return (await platformSkills()).find((item) => item.name === name)!.content;
}
