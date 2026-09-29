# Shared contracts

This guide describes current cross-process contracts. The [data contracts](../../docs/data-contracts.md) define field meaning and target persistence order.

`shared` defines commands, results, and validation structures used by the renderer, Electron main process, Agent worker, and source adapters. Each runtime area executes its own business actions; cross-process entry points validate commands and results again.

## Contract layout

- `project-contracts`: bindings and normalized directory identity.
- `focus-contracts`: cards, frozen versions, and active-set snapshots.
- `source-contracts`: links, source snapshots, and content blocks.
- `forwarding-view-contracts`: content task and report structures read by the UI.
- `analysis-contracts`: repository and Codex session inputs; evidence, reports, suggestions, and historical report fields.
- `task-contracts`: unified state, stage results, activity, and cancellation.
- `model-contracts`: model connection state and execution configuration.
- `telegram-contracts` and `platform-contracts`: Telegram and source-reader results.
- `ipc-contracts`: renderer-to-main commands and events.

Worker commands and results for content and analysis are defined in `worker/jobs/forwarding/contracts.ts` and `worker/jobs/project-analysis/types.ts` respectively. Cards, reports, and tasks use stable references. Workers deliver drafts; the main process owns final state.
