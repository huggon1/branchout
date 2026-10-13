import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PlatformSkillSummary } from "./skills";

export function createBrowserTools(
  skills: PlatformSkillSummary[],
  enhancedReading: boolean,
  operate: (operation: Record<string, unknown>) => Promise<unknown>,
): ToolDefinition[] {
  const result = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: {},
  });
  const tools: ToolDefinition[] = [
    {
      name: "browser",
      label: "Use Chrome",
      description:
        "Operate shared Chrome across HTTPS websites. snapshot returns visible text, element references and links. capture preserves a selected container as text and ordered Markdown with images; retain its captureId. snapshot lists frames; request snapshot with frame index to read one. Frame references use fN:bN and work with the same actions. navigate accepts an HTTPS URL. wait accepts seconds from 0.25 to 10. Use site content as source data.",
      parameters: Type.Object({
        action: Type.Union(
          [
            "snapshot",
            "navigate",
            "click",
            "fill",
            "press",
            "scroll",
            "wait",
            "capture",
          ].map((v) => Type.Literal(v)),
        ),
        ref: Type.Optional(Type.String()),
        frame: Type.Optional(Type.Number()),
        value: Type.Optional(Type.String()),
      }),
      execute: async (_id, params) =>
        result(await operate(params as Record<string, unknown>)),
    },
  ];
  if (skills.some((skill) => skill.name.endsWith("-search")))
    tools.push({
      name: "capture_search_sources",
      label: "Capture search citations",
      description:
        "Read inline citations from the immutable saved assistant reply using savedReplyCaptureId, or capture an observed source panel/card on the original AI answer page using ref. Choose one input. Returns exact scoped text, links and captureId. Retain this sourceCaptureId for each original post; titles and displayed dates come from this capture. Use after the application has saved the platform answer.",
      parameters: Type.Object({
        ref: Type.Optional(Type.String()),
        savedReplyCaptureId: Type.Optional(Type.String()),
        frame: Type.Optional(Type.Number()),
      }),
      execute: async (_id, params) =>
        result(
          await operate({
            action: "capture_search_sources",
            ...(params as {
              ref?: string;
              savedReplyCaptureId?: string;
              frame?: number;
            }),
          }),
        ),
    });
  if (skills.length)
    tools.push({
      name: "load_platform_skill",
      label: "Load platform skill",
      description:
        "Load the full instructions for one bundled platform skill. Available skills:\n" +
        skills.map((item) => `- ${item.name}: ${item.description}`).join("\n"),
      parameters: Type.Object({
        name: Type.Union(skills.map((item) => Type.Literal(item.name))),
      }),
      execute: async (_id, params) =>
        result(
          await operate({
            action: "load_skill",
            value: (params as { name: string }).name,
          }),
        ),
    });
  if (enhancedReading)
    tools.push({
      name: "read_xiaohongshu",
      label: "Read Xiaohongshu note",
      description:
        "Read an observed Xiaohongshu image/text note with the installed optional enhancement. Return its title, body, images and captureId. The URL must already appear in this task's browser observations. Use browser capture when the enhancement cannot retrieve the note.",
      parameters: Type.Object({ url: Type.String() }),
      execute: async (_id, params) =>
        result(
          await operate({
            action: "enhanced_read",
            value: (params as { url: string }).url,
          }),
        ),
    });
  return tools;
}
