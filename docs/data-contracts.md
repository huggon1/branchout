# Postrove data and message contracts

This document defines logical objects, cross-process fields, and persistence order for the search-first product. The [product specification](product-spec.md) owns business behavior; [architecture](architecture-overview.md) owns runtime responsibilities. TypeScript schemas define the exact implemented field shapes.

## Identity and persistence ownership

The [architecture](architecture-overview.md#runtime-boundaries-and-data-ownership) defines writable-state ownership.

| Identity                 | Object                                                   |
| ------------------------ | -------------------------------------------------------- |
| `followId`               | Saved search conditions and recurring schedule           |
| `reportId`               | One independent search report                            |
| `taskId`                 | One search or parsing execution                          |
| `sectionId`              | One selected platform's part of a search                 |
| `candidateId`, `postKey` | A candidate occurrence and its canonical source identity |
| `resultId`, `materialId` | Parsing delivery identity and saved reading report       |

Timestamps use ISO strings with timezone information. The interface displays local time. Saved follow snapshots keep reports readable after configuration edits or deletion.

## Search conditions, follows, and reports

`StartFocusSearch` accepts `question`, unique selected `platforms`, and `period`. The current platforms are `x` and `xiaohongshu`; periods are `day`, `week`, `month`, and `all`. The service trims outer question whitespace. Platform prompt language is independent of the output language.

`Follow` saves `followId`, name, question, platforms, period, schedule, paused state, revision, creation/update times, and `nextRunAt`. A schedule has `cadence` daily or weekly, `time` in local HH:mm, and a weekday for weekly execution. Weekday uses zero for Sunday through six for Saturday. `lastSkippedAt` records the latest skipped occurrence when available. `lastOccurrenceAt` retains the latest consumed occurrence so a clock rollback and restart preserve schedule admission identity.

`FocusSearchReport` saves `reportId`, `taskId`, question, output language, creation time, origin manual or follow, period, platforms, sections, and candidate submissions. Follow runs add `followId`, `followName`, `followRevision`, and `scheduledFor`. New runs freeze these inputs when admitted to the queue.

Report status is queued, running, completed, partial, failed, or stopped. `finishedAt` records its terminal time. `taskOutcome` persists completion, failure, or cancellation so startup can reconcile an interrupted task event after report commit. Each section saves prompt language, exact task and submitted platform prompts, captured reply bytes, candidates, state, warnings, and failure reason.

Section `citationExtraction` records pending, running, completed, empty, or failed, with an optional error. The main process commits the captured answer before acknowledging source extraction. Interrupted reports retain those committed replies.

Report loading keeps current schema fields and strips retired synthesis data. Existing platform replies, candidates, and submission associations remain available.

## Candidate sources and parsing submission

Candidates contain identity, canonical `postKey`, URL, title, description, and optional displayed publication date. The saved answer and associated source captures establish citation evidence; titles and dates come from those captures. Main validates each candidate's platform and post identity. New Xiaohongshu candidates require an observed source-card address with access parameters, or a readable note whose own content container and document navigation share its note identity. Bare inline links remain answer evidence while source verification runs. Admitted addresses preserve their access parameters for parsing submission.

A submission association maps report plus canonical post identity to reserved parsing `taskId` and `resultId`. The service persists that reservation before submitting to forwarding. Repeated addition reuses the saved identity. The parsing task follows its own lifecycle and material persistence.

## Schedule admission and recovery

Follow changes and ticks use serialized mutations. A due occurrence advances `nextRunAt` before admission. `lastOccurrenceAt` protects occurrence identity across clock rollback. [Product scheduling](product-spec.md#follows-and-scheduling) owns skip and queue rules. Startup derives terminal report status from saved platform and citation states, preserves stopped reports, and retains saved answers after interruption.

## Submitted sources and reports

One application or Telegram HTTPS URL enters the forwarding queue with task, result, and material identities. Parsing tasks freeze their output language.

`SourceContent` saves requested URL, platform, source identity, retrieval time, ordered Markdown, images, and actual completeness. Images keep an HTTPS address and an optional local cached address. Capture validation compares canonical X and Xiaohongshu post identities and observed URLs for other pages; saved source bytes establish translation provenance.

`ReadingMaterial` contains an ID, main or reference role, URL, title, optional source, translation chunks, summary, state, and issue. A chunk saves original text, translated text, and completion. Materials begin with one main item and unique IDs and URLs. Completed material has a source, summary, and completed chunks; partial and failed items preserve available content. Source rejection saves the observed platform reason as the material issue; Xiaohongshu `300031` retains “当前笔记暂时无法浏览”.

Workers emit initial materials, individual material updates, phases, execution identity, stage failures, and final results. Main-process validation preserves identity, saved source bytes, and finished chunks. The final report matches saved material state. Stopping retains the saved portion of each material.

## Task snapshots and activity messages

`TaskSnapshot` is the task center's view of task identity, kind, state, phase, progress, update time, readable error, and result reference. Search reports use result kind `focus_search_report`. Parsing records contribute their queue and processing states through the unified view.

The main process saves the initial task and report before execution, then validates and saves progress before notifying the renderer. Final report persistence precedes terminal task status. Search report partial state expresses useful saved material when task execution has ended.

`TaskActivity` contains ordered stage summaries and bounded public messages. Complete model messages and tool actions belong to the Pi session.

A task can own several Pi sessions for browser work and reading attempts. Trace association uses the parent task identity and individual execution/session identity. Native HTML export copies the associated Pi files to the selected local destination. Persisted JSONL remains in the local profile; export reports an unavailable state when native HTML is absent. Trace contents remain local until the user chooses to export them.

## Development profiles and execution identity

`RuntimeProfile` records installed, review, or test mode, resolved data directory, and integration policy. Storage, credentials, browser sessions, and traces resolve under the selected profile. Independent instances use independent profiles. Review mode pauses background integrations during preparation.

Installed profiles retain their storage location, encryption identity, browser sessions, and cached image addresses. Fresh installations use `Postrove/profiles/default` under the operating system's application-data directory.

`PromptExecution` associates task and attempt identity, revision, output language, model, and build with reading. Current reading `promptRevision` hashes its translation and introduction system strings; its scope is that base post-collection instruction pair. Browser tool definitions and loaded skill bodies are recorded in native session messages. Search saves `outputLanguage` in its report and uses native sessions for execution context.

Model execution acquires a connection lease. Credentials remain in controlled local storage; reports and interface state read redacted connection information. Shared Chrome retains website sessions. Platform sign-out clears that platform's session state.

## Telegram queue and business reset

Telegram state saves authorized chats, pending authorization candidates, confirmed `updateOffset`, inbound receipts, queued forwarding, and connection status. Accepted receipt, queue identity, pending acknowledgment, and cursor advance persist together. Successful forwarding submission and acknowledgment delivery then save their progress. Chat and message identity form the deduplication key.

A fresh business generation clears old test projects, cards, task records, reports, and allowlisted business traces and caches. It preserves model and bot credentials, platform profiles, authorized chats, and receipt progress. Each cleared receipt keeps its inbound key and update identity with outcome `retired_by_reset`; old task references and acknowledgments are removed. Old queued forwarding is cleared before integration startup.

`business-generation.json` records generation `search-follow-v1` and state resetting or committed. A resetting marker causes idempotent cleanup to resume before writers start. A committed marker preserves later-generation records. The reset validates affected regular files and Telegram schema before destructive steps. The explicit allowlist protects credential and browser storage boundaries.

## Update receipt and queue recovery

`application-update.json` stores the current and target versions immediately before installation. Startup consumes a matching target receipt and exposes the previous version for the completion notice. A failed installation clears the receipt. Upgrades keep the selected runtime profile and its committed business generation.

A queued search with pending, empty platform sections resumes from its saved conditions at startup. Queued task snapshots keep that state. Searches that already ran follow the saved-result recovery path. Parsing retains its queued records through shutdown. The [updater behavior](product-spec.md#application-updates) owns installation admission and user actions.
