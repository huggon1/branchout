# Worker

This document describes current Agent worker responsibilities. See [data contracts](../../docs/data-contracts.md) for task input and output and the [architecture overview](../../docs/architecture-overview.md) for runtime design.

## Tasks

- **Content:** Read a normalized link, generate general understanding, evaluate every active card in the input snapshot, and return source, understanding, coverage, and connections.
- **Project analysis:** Give Pi the repository root and a cleaned XML of selected Codex sessions; use read-only tools to explore files and produce evidence-backed findings and card suggestions.
- **Model support:** Create an independent Pi session for each task using configuration frozen by the main process; deliver structured stage and activity events.

Workers receive approved directories, source scope, card versions, and cancellation signals. Readers return locatable sources and actual coverage; reasoning modules consume normalized inputs. The main process validates results, persists state, manages tasks, and accepts suggestions.

## Module layout

- `jobs/forwarding/worker-entry.ts`: source retrieval, understanding, and per-card evaluation.
- `jobs/project-analysis/worker-entry.ts`: findings and card suggestions.
- [readers](../readers/README.md): local inputs shared by previews and analysis.
- `reasoning/`: model input and output validation for understanding, connections, and suggestions.
- `pi-runtime.ts` and `model-worker.ts`: Pi sessions, model checks, and execution boundaries.

Each reader reports actual scope and failure locations. Task stages send readable summaries to the main-process task center.
