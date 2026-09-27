# Source guide

This guide describes the current source layout. The [product specification](../docs/product-spec.md) defines target behavior, the [architecture overview](../docs/architecture-overview.md) defines runtime design, and [data contracts](../docs/data-contracts.md) define cross-module fields.

| Area | Responsibility |
| --- | --- |
| [shared](shared/README.md) | Cross-process contracts for projects, cards, reports, tasks, and integration messages |
| [main](main/README.md) | Electron lifecycle, data ownership, scheduling, Telegram, and IPC |
| [worker](worker/README.md) | Content connections, project analysis, and Pi sessions |
| [readers](readers/README.md) | Local repository, Git history, and Codex session input shared by main-process previews and worker analysis |
| [platforms](platforms/README.md) | GitHub, X, and Xiaohongshu source retrieval and normalization |
| [renderer](renderer/README.md) | Content, cards, analysis, task center, and settings UI |

One main-process service owns project binding. Cards and reports reference project identity. `shared` defines cross-process commands and results, which main-process entry points validate again. The main process persists task stages and activities; the renderer reads the same snapshots.

Each local README describes module responsibilities and file layout. Model connections, source adapters, and reading capabilities belong to their respective modules.
