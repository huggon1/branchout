![Branchout — Grow your ideas. Build with confidence.](assets/hero.png)

# Branchout

**Grow your ideas. Build with confidence.**

English · [简体中文](README.zh-CN.md) · [Get started](#-get-started) · [Inside the app](#-inside-the-app)

Building a project isn't always about knowing how to code. Sometimes you're unsure what's worth pursuing. Sometimes you already have an idea, but the references, context, and insights that could help you develop it are scattered everywhere.

**Branchout is a project companion for independent developers.** Grounded in your project, it helps you discover, collect, and understand useful information—turning scattered findings into perspectives and evidence you can build on. Whether you're exploring a new direction or developing an existing idea, the goal is the same: a clearer picture and more confidence to move forward.

## 🌱 What makes Branchout different

### Grounded in your project

Your code and commit history provide a meaningful starting point. Branchout uses them to understand what your project does and how it's evolving, so exploration starts with context rather than a blank prompt.

### Exploration, ready to use

Research methods, exploration angles, and platform connections are already assembled. Choose from the available directions and start exploring—without designing a research workflow or writing prompts yourself.

### Perspective for what you're building

Discover new possibilities and deepen ideas you already have. Bring useful information into focus, keep the context behind it, and develop a more informed view of where your project could go.

## 🚀 Get started

Currently supported: **macOS on Apple Silicon**. The interface is currently in Chinese. Development requires **Node.js 22.19.0 or later** and Git.

```sh
git clone https://github.com/huggon1/branchout.git
cd branchout
npm ci
npm start
```

The first start downloads the required platform runtimes if they're missing.

1. Open **Settings (设置)** and choose a Codex or OpenAI-compatible model connection. Model access requires your own account or API credentials and may incur provider charges.
2. In **Project understanding (项目理解)**, select a local Git project and run its initial analysis.
3. In **Material exploration (素材探索)**, choose the project, an exploration angle, platforms, and a time range. Review the resulting material and its relevance to your project.

Connect Xiaohongshu or X when you want to use those sources. Telegram and Feishu bots are optional ways to forward links; you can also paste links directly into the app.

## 🔎 Inside the app

All screenshots below are captured from the actual application using fictional projects and content in an isolated demo workspace. They contain no personal projects, accounts, or live research results.

### Understand the project you already have

Read a project overview, meaningful recent changes, and the code evidence behind them. Analysis is tied to a specific commit; you decide when to update it.

![Project overview and development timeline for the fictional Sproutboard project](assets/screenshots/project.png)

### Explore with a starting point

Built-in angles currently cover comparable products, user needs, product experience, acquisition and pricing, and relevant tools or capabilities. Explore GitHub, Xiaohongshu, and X; inspect sources and why they matter instead of receiving an unexplained list of links.

![Project, exploration angles, platforms, and time-range selection](assets/screenshots/exploration.png)

<details>
<summary>See the material library</summary>

Filter discoveries by project, angle, platform, or exploration run. Sources and their relationships to different projects remain distinct.

![Four fictional discoveries with summaries and relevance to the demo project](assets/screenshots/materials.png)

</details>

### Keep the ideas you find along the way

Paste GitHub or Xiaohongshu links, or forward them through a connected Telegram or Feishu bot. Branchout parses the content into a local reading workspace with collections, original text, and separately labeled AI summaries.

![Collected fictional references alongside the original article and its summary](assets/screenshots/collection.png)

Collection is also useful on its own. Saved links are not currently fed automatically into project exploration or Feed generation.

### Turn selected discoveries into a Feed

Choose material from exploration, arrange it into sections, and generate a readable Feed. Historical Feeds retain the source snapshots used to create them; missing evidence and failed items remain visible rather than being filled with invented content.

## 🛠 Build and contribute

```sh
npm run check          # Tests, types, build, and document links
npm run test:desktop   # Isolated desktop interaction tests
npm run prepare:runtime
npm run package:app
```

The packaged application is written to `build/Branchout-darwin-arm64/Branchout.app`. Signing, notarization, and clean-machine distribution validation are not yet complete.

To reproduce the fictional screenshots, run `npm run screenshots`. It creates and removes a temporary workspace without using your normal application data. See [AGENTS.md](AGENTS.md) for repository rules.

## A few things to know

- Application data is stored locally in `~/Library/Application Support/Branchout`. This is a separate application identity; data from other installations is left untouched and is not automatically migrated.
- Local storage does **not** mean all processing is offline. Project analysis and generation send relevant context to your configured model provider; external discovery queries the selected platforms.
- Exploration uses a fixed project understanding. It does not silently re-analyze your repository. Source access depends on platform availability, login, and network conditions.
- AI output is not source evidence. Read the linked material before relying on a conclusion.

## License

A project license has not yet been selected. Third-party components, fonts, and bundled runtimes retain their respective licenses.
