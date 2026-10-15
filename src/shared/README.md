# Shared contracts

[Data contracts](../../docs/data-contracts.md) owns field meaning and persistence. Schema files define implemented command and result shapes.

| File | Scope |
| --- | --- |
| `focus-search-contracts.ts` | Questions, follows, reports, candidates, and submissions |
| `source-contracts.ts` | Source identities, snapshots, and content blocks |
| `reading-contracts.ts` | Materials, chunks, introductions, and coverage |
| `forwarding-view-contracts.ts` | Parsing views |
| `task-contracts.ts` | Task status, activity, and result references |
| `model-contracts.ts` | Model connections and execution configuration |
| `bot-contracts.ts`, `feishu-contracts.ts`, `telegram-contracts.ts`, `platform-contracts.ts` | Integration views |
| `ipc-contracts.ts` | Renderer bridge |
