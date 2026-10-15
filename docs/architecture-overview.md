# Postrove architecture

[Product specification](product-spec.md) owns behavior; [data contracts](data-contracts.md) owns fields and persistence. [Prompt flow](agent-prompt-flow.md) describes model instructions and tools.

## Runtime boundaries and data ownership

Electron Main owns stores, model leases, bot integrations, scheduling, and execution queues. The React renderer sends preload commands and reads saved snapshots. Workers return captures or model output. Main validates identities, persists progress, then publishes changes.

| Store              | Saved state                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| `FocusSearchStore` | `focus-search.json`: follows and independent reports                        |
| `ForwardingStore`  | `forwarding.json`: submitted sources, material progress, and parsed results |
| `TaskStore`        | `tasks.json`: task snapshots and activity                                   |
| `RecordDeletions` | `record-deletions.json`: independent record visibility and timed undo |
| Trace root         | `browser-traces/`: task-associated Pi sessions and native HTML              |

## Search and follow orchestration

`FocusSearchService` admits manual and scheduled questions into a serial queue. It saves report and task identities, then persists each platform's answer and citation evidence through `PlatformAccess.search`. Candidate submission reserves its parsing identity before entering the forwarding queue. [Scheduling rules](product-spec.md#follows-and-scheduling) own admission behavior.

## Content submission pipeline

The forwarding service first calls `PlatformAccess.collect`. A browser worker collects the main material; Main validates and saves its captures, then separately collects direct references. The reading worker receives those saved materials, translates chunks through lightweight Agents, and generates introductions. Main validates and persists each material update.

Search and parsing have separate queues and share the Chrome access lock.

Worker environments inherit explicit proxy variables. On macOS, a GUI launch without them reads the system HTTP and HTTPS proxy settings. Localhost and loopback requests retain direct routing.

## Bot integration boundary

`integrations/bots/` owns the durable inbox, atomic account stores, authorization, receipt delivery, account lifecycle, history reconciliation, and the management IPC registry. `BotAdapter` defines verification, connection lifecycle, normalization, optional history pagination, and outbound delivery. Channel adapters own protocol payloads and transport credentials.

Telegram adapts its existing store through `telegramInboxRepository` and uses the shared inbox while retaining its polling cursor and data format. Feishu implements `BotAdapter` with the official SDK WebSocket transport and REST history and receipt APIs. Each account holds an independent inbox and history checkpoints. SDK event handlers await durable local receipt; queue submission and outbound receipt run in the background.

The forwarding boundary accepts `BotForwardingSubmission` with a channel, account identity, and message key. Existing application and Telegram task identities remain readable. Adding another channel extends the channel contract and supplies its adapter, credential validation, registry entry, and setup view. Collection and reading consume the same submission contract.

## Platform browser and focus search

| Component               | Responsibility                                                               |
| ----------------------- | ---------------------------------------------------------------------------- |
| `ChromeProfiles`        | Start Chrome and attach through loopback CDP                                 |
| `PlatformBrowser`       | Human login, saved sessions, serialized access, and constrained actions      |
| `BrowserAgent`          | Bridge worker tool requests to Main, retaining observations and captures     |
| `PlatformAccess`        | Capture provenance, canonical links, material validation, and image caching  |
| Bundled platform skills | Per-platform search and reading instructions loaded through a dedicated tool |

Browser navigation uses validated HTTPS addresses. Text submission targets recognized platform AI entries. Optional Xiaohongshu retrieval is a separate tool available to reading tasks when its runtime is installed.

## Recovery and native Pi logs

Browser workers use persisted Pi coding sessions. Reading uses lightweight Agents. Their loading and recovery paths are defined in [prompt flow](agent-prompt-flow.md). Task log export copies associated native files using the [trace contract](data-contracts.md#task-snapshots-and-activity-messages).

## Language and profile boundaries

Runtime profiles resolve stores, credentials, browser sessions, and traces under independent data directories. Main completes the [business reset](data-contracts.md#telegram-queue-and-business-reset) before opening writers or integrations. The [development guide](development.md) owns launch and profile preparation.

## Application updater

`ApplicationUpdates` owns update state and explicit download/install actions. `electron-update-driver.ts` uses electron-updater for version checks and ZIP integrity, then Electron's native updater to stage and validate macOS signatures before shutdown. Preload exposes fixed commands and a separate update event so download progress refreshes only update UI.

`ExecutionGate` counts admitted search and parsing jobs through worker and lease cleanup. Installation waiting holds admission in both queues. The updater reads active jobs from this gate, validates the package, then uses Main's service shutdown and native installation path. [Product behavior](product-spec.md#application-updates) owns user choices and failure states.
