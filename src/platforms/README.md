# Platforms

[Prompt flow](../../docs/agent-prompt-flow.md) owns loading; [architecture](../../docs/architecture-overview.md#platform-browser-and-focus-search) owns browser access.

| Path | Responsibility |
| --- | --- |
| `browser/prompts.ts` | Generic system and task templates |
| `browser/skills/` | Separate search and reading SKILL.md files |
| `browser/skills.ts` | Bundled skill metadata, task catalog, and explicit loading |
| `browser/tools.ts` | Browser, skill-loader, and optional note-reader tools |
| `types.ts` | Source adapter results |
| [adapters](adapters/README.md) | Optional retrieval enhancement |
