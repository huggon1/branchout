# Renderer

This document describes the current renderer structure. See the [UX specification](../../docs/ux-spec.md) for target page behavior and [design system](../../docs/design-system.md) for shared rules.

## Responsibilities

`renderer` presents Content, Projects, Focus Cards, Tasks, and Settings. Content handles links, lists, and report reading. Focus Cards manages free-text cards by project. Projects handles bindings, analysis input, reports, and suggestion review. Tasks shows current Agent stage and recent activity.

The renderer reads saved snapshots through the controlled preload interface and submits editing, content, analysis, and acceptance commands. Page changes retain project selection, filters, and reading position; task state restores from unified snapshots.

## Module layout

- `App.tsx`: navigation, task indicator, and page transitions.
- `components/ContentPage.tsx`: submission, list, source reading, understanding, and connections.
- `components/FocusCardsPage.tsx`: project grouping, free-text editor, state, and version reading.
- `components/ProjectsPage.tsx`: binding, analysis scope, reports, and acceptance.
- `components/TasksPage.tsx`: list, stage, Agent activity, failures, and retry.
- `components/SettingsPage.tsx`: model, Telegram chats, and source configuration.
- `product-ui.ts` and `bridge.ts`: page-facing queries, commands, and state subscriptions.

Page components compose business states; shared components handle reusable presentation and interaction.
