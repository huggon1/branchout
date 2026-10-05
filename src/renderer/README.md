# Renderer

This document describes the current renderer structure. See the [UX specification](../../docs/ux-spec.md) for target page behavior and [design contract](../../design.md) for shared rules.

## Responsibilities

`renderer` presents Content, Projects, Focus Cards, Tasks, and Settings. Content handles links, lists, and report reading. Focus Cards manages free-text cards by project. Projects handles bindings and analysis preparation. Tasks owns analysis reports, suggestion review, current stage, and collapsed chronological activity.

The renderer reads saved snapshots through the controlled preload interface and submits editing, content, analysis, and acceptance commands. Page changes retain project selection, filters, and reading position; task state restores from unified snapshots.

## Module layout

- `App.tsx`: navigation, task indicator, and page transitions.
- `components/ContentPage.tsx`: submission, list, source reading, understanding, and connections.
- `components/FocusCardsPage.tsx`: project grouping, free-text editor, state, and version reading.
- `components/ProjectsPage.tsx`: vertical project index, binding, overview, and analysis preparation dialog.
- `components/TasksPage.tsx`: list, report ownership, stage, Agent activity, failures, and retry.
- `components/AnalysisReportView.tsx`: shared report prose, coverage, evidence, suggestion comparison, and acceptance.
- `components/Primitives.tsx`: brand, icons, buttons, dialogs, empty states, and sanitized Markdown.
- `styles.css`: shared semantic tokens, visual roles, page geometry, and responsive rules.
- `components/SettingsPage.tsx`: model, Telegram chats, and source configuration.
- `product-ui.ts` and `bridge.ts`: page-facing queries, commands, and state subscriptions.

Page components compose business states; shared components handle reusable presentation and interaction.

`design/Components.tsx` and `design/tokens-and-controls.css` provide the shared disclosure, button, and color system used by application pages.

FocusSearchDialog prepares card, platform, and period selections. FocusSearchReportView renders saved platform replies and post actions inside Tasks. Signed-in platform settings use shared browser-session actions; GitHub remains in Public Sources.
