<p align="center"><img src="assets/branchout-icon.svg" width="112" alt="Branchout app icon"></p>

# Branchout

**Collect links, read them in your language, and find discussions worth following.**

[简体中文](README.zh-CN.md)

When you find a post or article to read later, send its link to Branchout. It creates a reading report in your chosen language, with the main content, direct linked materials, and a short introduction for each. **Focus cards** for local Git projects guide discussion searches. Project analysis suggests new angles to watch based on the repository and Codex work conversations you select for review.

![An article connecting to two relevant focus cards](assets/branchout-hero.png)

## 🧭 How to use it

1. Connect a model and choose your app language in Settings. Add one link on the Content page or forward one through your configured Telegram bot.
2. Read each material's introduction and body in your chosen language, and continue unfinished material after a failure.
3. For discussion search, bind a local Git repository and write a focus card describing a situation, difficulty, and desired outcome. For example: “When saving a draft offline fails, I want to see the cause and retry while keeping my input.”

## ✨ What you can do

- **Manage projects and focus cards:** Bind local Git repositories; write, edit, delete, and restore focus cards while retaining their versions.
- **Read content reports:** Submit an HTTPS article, post, or repository link. Read the main material and directly linked materials in your chosen language, with images, code, tables, and Mermaid diagrams. Same-language content is presented faithfully; other-language content is translated. Each material shows its actual coverage. Historical reports retain their saved focus-card connections.
- **Search with focus cards:** Search X through Grok or Xiaohongshu through 点点 AI. Keep the platform reply and add selected posts to reading.
- **Collect links from Telegram:** Send one link in an authorized chat and receive a queue confirmation. Read the full report in the desktop app. When the app opens again, it continues processing pending messages still available from Telegram.
- **Analyze a project:** Select related Codex work conversations. The agent explores the local repository with read-only tools. Review README promises against implementation, tests, documentation, and focus card suggestions; accept suggestions one by one.
- **Follow task progress:** See the current stage, recent actions, results, and failure reasons in the task center.

Projects, cards, reports, and tasks are stored locally. Model tasks receive the source content or selected project material needed for that run and use the model connection you configure.

## Source access

Forwarding and focus search use the same Chrome runtime and saved website sessions. The browser reads accessible HTTPS pages across sites. Platform guides and an optional Xiaohongshu reader add site-specific help. Login, verification, and page structure determine actual retrieval coverage.

| Source                             | Reading scope                                             | Focus search     |
| ---------------------------------- | --------------------------------------------------------- | ---------------- |
| Web articles                       | Readable body and direct linked materials                 | —                |
| GitHub                             | Default repository README                                 | —                |
| X                                  | Post body, images, quoted posts and explicit author links | Grok, English    |
| Xiaohongshu                        | Readable note body and images                             | 点点 AI, Chinese |
| Audio, video and interactive pages | Available transcript or readable page text and images     | —                |

Reading follows one level of explicit material links. Each material retains its own further links. Search handles one card at a time for a recent day, week, or month. The [prompt flow](docs/agent-prompt-flow.md) explains shared tools and task-specific instructions.

## Run from source

Development requires Node.js 24 or newer:

```bash
npm ci
npm run dev
```

See the [development guide](docs/development.md) for browser and reader setup.

In Settings, connect a general API or a Codex subscription account. The Codex subscription connection uses an available local Codex CLI. Add a link from the Content page to start reading. Bind a local Git repository and write a focus card to use project analysis and discussion search. X and Xiaohongshu require their respective sign-ins in Settings; Telegram forwarding requires a configured bot and an authorized chat.

## Learn more

- [Development guide](docs/development.md)
- [Product specification](docs/product-spec.md) and [UX specification](docs/ux-spec.md)
- [Design contract](design.md)
- [Architecture overview](docs/architecture-overview.md), [data contracts](docs/data-contracts.md), and [source guide](src/README.md)

## License

Branchout is available under the [MIT License](LICENSE).
