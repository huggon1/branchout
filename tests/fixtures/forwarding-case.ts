import { randomUUID } from "node:crypto";
import { sourceSchema } from "../../src/shared/material-contracts";
import type { SourceContent } from "../../src/shared/material-contracts";
import type { ForwardingFocusCard } from "../../src/worker/jobs/forwarding/contracts";

// Exact README excerpts captured from public withastro/astro commit 3f3d580b83b0cb9f14d451b86dab547ccffe4eab.
export const source: SourceContent = sourceSchema.parse({
  sourceUrl: "https://github.com/withastro/astro",
  platform: "github",
  title: "Astro",
  sourceIdentity: "withastro/astro",
  fetchedAt: new Date().toISOString(),
  contentBlocks: [
    { type: "heading", level: 1, text: "Astro" },
    {
      type: "text",
      text: "Astro is a website build tool for the modern web —\npowerful developer experience meets lightweight output.",
    },
    { type: "code", text: "npm create astro@latest" },
    { type: "text", text: "Visit the official documentation." },
  ],
  images: [],
  completeness: "partial",
  completenessNote:
    "This test snapshot retains selected paragraphs from the public README; remaining sections are outside the fixture.",
});

export const focus = (content: string): ForwardingFocusCard => ({
  projectId: randomUUID(),
  projectLabel: "Branchout",
  focusId: randomUUID(),
  focusVersionId: randomUUID(),
  content,
});
