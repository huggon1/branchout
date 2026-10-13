<p align="center"><img src="assets/branchout-icon.svg" width="112" alt="Branchout app icon"></p>

# Branchout

**Find social-media content through platform AI and turn forwarded links into readable material.**

[简体中文](README.zh-CN.md)

Branchout is a desktop app for acquiring and reading social-media content. It provides two functions:

- **Platform AI search:** Describe a question in natural language, select information sources, and save each platform's original answer and source links. Save search conditions as a recurring follow.
- **Link parsing:** Submit a link manually or forward it through Telegram to read source material in your chosen language. Links selected from search results can enter the same parsing workflow.

## Platform AI search

| AI search entry | Information source |
| --- | --- |
| Grok within X | X |
| 点点 AI | Xiaohongshu |

Questions can include context and conditions. For example: “How have independent developers validated product demand in the past week? Find discussions with actual failures and links to the original posts.”

Branchout adapts the question to each entry's language and starts a single-question search with the selected platform AI. Each run separately saves the original question, platform answers, and titled source links. The time range is sent with the question; source dates reflect the information actually retrieved. Successful results remain available, and failed platforms show their reason.

Read reports in Search Results, open original links, or select sources to parse. Save search conditions as a follow to run daily or weekly at a chosen time. These results also appear in Search Results. Scheduled follows run while the app is running; occurrences missed while it is closed are skipped.

## Link parsing

Add an HTTPS link in Parsed Results or send it through a configured Telegram bot from an authorized chat. Branchout reads the main content and its directly referenced materials, then saves source snapshots, short summaries, and bodies in your chosen language.

| Source / content type | Parsing target | Capability details |
| --- | --- | --- |
| General web pages | Accessible body, images, and directly referenced materials | Base browser reading; built-in page capture saves selected content as Markdown and caches available images |
| X posts | Post body, images, quoted posts, and material links supplied by the author | Base browser reading; a bundled X reading skill helps expand text, inspect images, and identify author-supplied materials |
| Xiaohongshu notes | Accessible note text and images | Base browser reading with a bundled note-reading skill; the optional external `xiaohongshu-mcp` component adds retrieval of titles, bodies, and images from image/text notes |
| GitHub repositories | The repository's default README | Base browser reading; a bundled GitHub reading skill scopes retrieval to the default README |
| Interactive pages | Accessible text, images, and embedded page content | Base browser reading; built-in browser tools support page interaction and capture from accessible frames |

Parsing follows one level of material links explicitly supplied by the main content. Reading material preserves headings, paragraphs, images, code, tables, and links. Text in another language is translated into the language selected for that run. Each material reports its actual retrieval coverage, and saved content remains readable after a partial failure.

Both functions share Chrome and saved website sessions. Actual coverage depends on sign-in state, platform verification, and accessible page content. Reports show conditions such as required sign-in, human verification, or restricted access. See the [development guide](docs/development.md) for enhancement setup.

## Getting started

1. Connect a general API or a Codex subscription account in Settings and choose the app language. The configured model handles browser operations, translation, and reading introductions; platform AI search uses the entries listed above.
2. Sign in to the platforms you need through Settings.
3. Start with either function: enter a question in Search or add a link in Parsed Results. For Telegram forwarding, configure a bot and authorize a chat first.
4. Read content in Search Results and Parsed Results. Manage recurring searches in Follows. Check execution status and failure reasons in Tasks, where you can also export native Pi session logs.

## Local data

Reports, follows, task state, and website sessions are stored locally. Questions and materials needed for execution are sent to your configured model connection. Platform AI search also sends the adapted question to the selected entry. See [data contracts](docs/data-contracts.md) for storage and upgrade rules.

## Run from source

Use Node.js 24 or newer:

```bash
npm ci
npm run dev
```

The [development guide](docs/development.md) covers browser setup, isolated development data, checks, and packaging. Codex subscription connections use an available local Codex CLI.

## Learn more

- [Product specification](docs/product-spec.md)
- [Architecture](docs/architecture-overview.md), [data contracts](docs/data-contracts.md), and [source guide](src/README.md)
- [Test guide](tests/README.md)

## License

Branchout is available under the [MIT License](LICENSE).
