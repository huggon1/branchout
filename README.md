<p align="center"><img src="assets/branchout-app-icon.svg" width="112" alt="Branchout app icon"></p>

# Branchout

**Connect what you collect to the projects you are building.**

[简体中文](README.zh-CN.md)

You may recognize that an article is useful before you know which project it helps. Branchout lets you write short **focus cards** for local Git projects. When you add a link or forward one through Telegram, it saves the source content, creates a reading report, and shows which focus cards relate to it and why. Project analysis can also suggest new angles to watch based on the repository and Codex work conversations you select for review.

![An article connecting to two relevant focus cards](assets/branchout-hero.png)

## 🧭 How to use it

1. Bind a local Git repository and write a focus card describing the project and a question you want to keep watching. A short card is enough: “This project lets people save content offline. I care about the feedback and retry flow when a save fails.”
2. Add a link on the Content page or forward one from Telegram. The report shows the retrieved source, an understanding of its content, and evidence for any connections to active focus cards. When no card is relevant, the report shows zero connections.

## ✨ What you can do

- **Manage projects and focus cards:** Bind local Git repositories; write, edit, pause, and reactivate focus cards while retaining their versions.
- **Read content reports:** Add links to public GitHub repositories, X posts, and Xiaohongshu notes. Review source text and images, retrieval coverage, content understanding, and evidence-backed connections.
- **Collect links from Telegram:** Send one link in an authorized chat and receive a queue confirmation. Read the full report in the desktop app. When the app opens again, it continues processing pending messages still available from Telegram.
- **Analyze a project:** Select related Codex work conversations. The agent explores the local repository with read-only tools. Review the files opened, project findings, and focus card suggestions; accept suggestions one by one.
- **Follow task progress:** See the current stage, recent actions, results, and failure reasons in the task center.

Projects, cards, reports, and tasks are stored locally. Model tasks receive the source content or selected project material needed for that run and use the model connection you configure.

## Run from source

Development requires Node.js 24 or newer:

```bash
npm ci
npm run dev
```

Prepare the X and Xiaohongshu readers with `npm run setup:x` and `npm run setup:xhs` when using those sources.

In Settings, connect a general API or a Codex subscription account. The Codex subscription connection uses an available local Codex CLI. Then bind a local Git repository, write a focus card, and add a link from the Content page. X and Xiaohongshu require their respective sign-ins in Settings; Telegram forwarding requires a configured bot and an authorized chat.

## Learn more

- [Product specification](docs/product-spec.md) and [UX specification](docs/ux-spec.md)
- [Design system](docs/design-system.md)
- [Architecture overview](docs/architecture-overview.md), [data contracts](docs/data-contracts.md), and [source guide](src/README.md)

## License

Branchout is available under the [MIT License](LICENSE).
