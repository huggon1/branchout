# Source guide

See [architecture](../docs/architecture-overview.md) for runtime boundaries and [product specification](../docs/product-spec.md) for behavior.

| Area | Responsibility |
| --- | --- |
| [pi](pi/README.md) | Native Pi SDK, authentication, and execution adapters |
| [shared](shared/README.md) | Cross-process schemas |
| [main](main/README.md) | Stores, scheduling, queues, browser, Telegram, and IPC |
| [worker](worker/README.md) | Model execution and traces |
| [platforms](platforms/README.md) | Task prompts, bundled skills, tools, and source adapters |
| [renderer](renderer/README.md) | Application pages and reusable controls |
