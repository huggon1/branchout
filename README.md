<p align="center"><img src="assets/postrove-icon.svg" width="112" alt="Postrove app icon"></p>

# Postrove

**Search through platform AI. Turn forwarded links into readable material.**

[简体中文](README.zh-CN.md)

Postrove is a desktop app with two connected workflows:

- **Platform AI search:** Ask a question, save each platform's original answer and source links, and turn search conditions into recurring follows.
- **Link parsing:** Add a link manually, forward it through Telegram, or select a source from search results. Read the material in your chosen language.

## Getting started

1. Install Google Chrome. Download the macOS Apple silicon DMG from [GitHub Releases](https://github.com/huggon1/postrove/releases), move Postrove into Applications, and open it. See the [0.1.0 release notes](docs/releases/0.1.0.md) for first-open approval and migration from earlier builds.
2. In Settings, connect a general API or a Codex subscription account, then choose the app language. Codex connections use a locally available Codex CLI. The configured model operates the browser and prepares reading material.
3. Sign in to the desired platforms through Settings. Search and parsing share saved Chrome sessions. Task browsing defaults to headless; Settings can show task windows.
4. Enter a question in Search or add a link in Parsed content. Telegram forwarding uses a configured bot and an authorized chat.

Content provides **Search results** and **Parsed content**. **Focus** manages recurring searches. **Tasks** shows execution state and exports native Pi logs.

## Platform AI search

| AI search entry | Information source |
| --------------- | ------------------ |
| Grok within X   | X                  |
| 点点 AI         | Xiaohongshu        |

Enter a question, select platforms, and choose a time range. For example: “How have independent developers validated product demand in the past week? Find discussions with actual failures and links to the original posts.”

Postrove adapts the question for each platform AI and starts a fresh, single-question conversation. Each report saves the original question and presents the platforms' original answers with titled source links. Saved answers remain readable when another platform or citation extraction fails. The selected time range goes into the question; source dates reflect available evidence.

Open a source or add it directly to parsing from Search results. Save the same conditions as a follow to run daily or weekly at a chosen time. Follow results appear alongside manual searches. Scheduled runs occur while the application is open; missed occurrences expire.

## Link parsing

Postrove reads the main content and one level of directly referenced materials. It saves source snapshots, short introductions, and readable bodies. Reading preserves headings, images, code, tables, and links, and translates other-language text into the language selected for that run.

| Source / content type | Parsing target                                                      | Capability details                                                                                                                  |
| --------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| General web pages     | Accessible body, images, and directly referenced materials          | Base browser reading; built-in capture saves selected content and accessible frames as Markdown and caches available images         |
| X posts               | Post body, images, quoted posts, and author-supplied material links | Base browser reading; bundled X reading skill helps expand text and identify direct materials                                       |
| Xiaohongshu notes     | Accessible note text and images                                     | Base browser reading and a bundled reading skill; the macOS package includes `xiaohongshu-mcp` to enhance image/text note retrieval |
| GitHub repositories   | The repository's default README                                     | Base browser reading; bundled GitHub reading skill scopes capture to the default README                                             |

Login state, platform verification, and accessible content determine retrieval coverage. Each material shows that coverage and retains available text after a partial failure.

## Updates and local data

Later releases appear in Settings → Application updates. Choose Download, then Install and Restart; active tasks can finish before installation. [Update behavior](docs/product-spec.md#application-updates) describes the flow.

Reports, follows, task state, and website sessions are stored locally. Execution sends relevant questions and materials to the configured model, and platform searches send their adapted questions to the selected AI entry. [Data contracts](docs/data-contracts.md) describe storage and upgrade rules.

## Run from source

Use Node.js 24 or newer:

```sh
npm ci
npm run dev
```

The [development guide](docs/development.md) covers browser preparation, the Xiaohongshu reader, isolated profiles, checks, and packaging.

## Learn more

- [0.1.0 release notes](docs/releases/0.1.0.md) and [release guide](docs/releasing.md)
- [Product specification](docs/product-spec.md)
- [Architecture](docs/architecture-overview.md), [prompt flow](docs/agent-prompt-flow.md), and [source guide](src/README.md)
- [Test guide](tests/README.md)

## License

Postrove is available under the [MIT License](LICENSE).
