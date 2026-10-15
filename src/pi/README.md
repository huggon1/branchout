# Pi SDK bridge

| File | Responsibility |
| --- | --- |
| [model-runtime.ts](model-runtime.ts) | Public SDK loading, native file paths, common options, and reasoning defaults |
| [execution.ts](execution.ts) | Shared native stream entry for coding sessions and lightweight Agents |

Pi owns provider/model definitions, native API behavior, authentication prompts, OAuth refresh, credential persistence, and reasoning mappings. Postrove owns generic presentation, connection identity, task snapshots, and application tool/prompt policy. SDK upgrades require bridge and E2E verification. Advanced API JSON and custom models.json use Pi's installed formats.

[Architecture](../../docs/architecture-overview.md#pi-model-boundary) owns runtime responsibilities. [Data contracts](../../docs/data-contracts.md#pi-model-connections) owns credential paths, saved fields, and migration. [Product behavior](../../docs/product-spec.md#languages-and-runtime-boundaries) owns the user-facing flow.
