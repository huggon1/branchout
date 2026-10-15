<p align="center"><img src="assets/postrove-icon.svg" width="112" alt="Postrove app icon"></p>

# Postrove

[简体中文](README.zh-CN.md)

Postrove is a desktop app that helps you find posts with each platform's own AI and collect interesting content to read later.

## Features

### Search with platform AI

Choose your information sources and a time range, then ask a question. View relevant posts and source links found by each platform's AI, alongside its original answer. Interesting sources can go directly into parsing.

Save search conditions as a follow to run daily or weekly while Postrove is open.

| AI search entry | Information source |
| --- | --- |
| Grok within X | X |
| 点点 AI | Xiaohongshu |

### Collect content to read later

Collect posts and articles from different platforms in one place. Read their text, images, and summaries in your chosen language.

For example, when you find a long technical article you want to read later, forward its link to your configured Telegram or Feishu app bot. Postrove retrieves the content and prepares a summary, so you can skim the summary first and read the article later in the app. You can also add links directly.

| Source | Parsing target | Capability details |
| --- | --- | --- |
| General web pages | Body, images, and directly referenced materials | Base browser reading |
| X posts | Post body, images, quoted posts, and author-supplied material links | Base browser reading with a bundled X reading skill |
| Xiaohongshu notes | Note text and images | Base browser reading and a bundled reading skill; the macOS package includes `xiaohongshu-mcp` for enhanced note retrieval |
| GitHub repositories | The repository's default README | Base browser reading with a bundled GitHub reading skill |

Platform access and login state determine retrieval coverage. Partial retrieval keeps the available content and shows its coverage.

## Installation and use

Installation packages are available for macOS Apple silicon.

1. Install Google Chrome.
2. Download the DMG from [GitHub Releases](https://github.com/huggon1/postrove/releases), move Postrove into Applications, and open it. Packages use a project signature; macOS may require System Settings → Privacy & Security → Open Anyway on first launch.
3. In Settings, select a Pi provider, complete its authentication, and save a model connection. Then sign in to your selected platforms. Existing Codex connections offer a one-time migration to native Pi login.
4. Enter a question in Search or add a link in Content → Parsed content. For bot forwarding, configure Telegram or Feishu and authorize your chat in Settings. Feishu supports official scan-to-create registration or an existing app with direct-message, sending, and history permissions.

Reports and website sessions are stored locally. Tasks send related questions and materials to your configured model. Later versions can be downloaded and installed through Settings → Application updates.

## Account risk

> ⚠️ Postrove uses your signed-in platform accounts for automated search and content retrieval. These actions may trigger platform safeguards, leading to extra verification, rate limits, account restrictions, or bans. We recommend dedicated secondary accounts for X, Xiaohongshu, and other platforms to reduce the impact of account restrictions.

[Development guide](docs/development.md) · [0.1.0 release notes](docs/releases/0.1.0.md) · [Release guide](docs/releasing.md) · [MIT License](LICENSE)
