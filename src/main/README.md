# Main process

This document describes current Electron main-process responsibilities. See the [architecture overview](../../docs/architecture-overview.md) for runtime design and [data contracts](../../docs/data-contracts.md) for cross-module objects.

## Responsibilities

`main` owns project bindings, card versions, content and analysis reports, unified task snapshots, and model and Telegram configuration. It validates renderer commands and worker results, persisting state before notifying the renderer or acknowledging Telegram.

One service owns project identity. Card editing, status changes, and suggestion acceptance maintain versions. Content tasks freeze all active cards at launch. Telegram deduplicates by inbound message identity and resumes available pending messages at startup. Content and analysis tasks persist their execution state separately; Tasks reads a unified view.

## Module layout

- `main.ts`, `window.ts`, `preload.ts`: app lifecycle, window, and controlled renderer bridge.
- `services/projects` and `services/focus-cards`: project binding, card versions, and active-set snapshots.
- `services/forwarding`: shared in-app and Telegram queue, stage persistence, and report publication.
- `services/project-analysis`: preview, task input, report persistence, suggestion acceptance, and version conflicts. Previews use [local readers](../readers/README.md).
- `services/tasks`: analysis state, content activity, and a unified content and analysis view.
- `integrations/telegram`: bot connection, authorized chats, update cursor, and receipt acknowledgment.
- `services/model-service.ts`, `services/codex-client.ts`, `storage/model-store.ts`: model connection, Codex login, execution configuration, and credential lifecycle.
- `services/runtime-layout.ts`: app resource paths in development and packaged builds for workers.
- `storage/`: atomic persistence for projects, card versions, reports, tasks, and integration cursors.

The main process passes approved task input and model configuration to workers. The renderer reads controlled results and redacted state.

PlatformBrowser owns persistent Chrome profiles and constrained page actions. BrowserAgent bridges task-scoped worker tools to those pages. PlatformAccess validates captured replies, post citations, and source snapshots, with Xiaohongshu note enhancement. FocusSearchService saves search reports and candidate submissions alongside unified tasks.
