# Branchout architecture overview

This document describes the target architecture. The [product specification](product-spec.md) defines behavior, [data contracts](data-contracts.md) define cross-module fields and task messages, and the [source guide](../src/README.md) describes intended module boundaries.

## Runtime boundaries and data ownership

Branchout uses Electron, React, and TypeScript. The renderer presents state and submits actions. The desktop main process owns writable project bindings, focus cards, content reports, analysis reports, tasks, and configuration. A separate Agent worker reads approved inputs and runs Pi model sessions. Source adapters retrieve and normalize GitHub, X, and Xiaohongshu content.

The main process validates renderer commands and worker results, persists them, then notifies the renderer. A surviving main process continues tasks when the window closes. After process restart, saved snapshots restore task state and Telegram pending messages are received. Interrupted Agent tasks become retryable according to saved stages; saved reports and stage results remain readable.

One project-binding service provides project identity, directory, and name. Cards, tasks, and reports reference that identity. Each storage module reads and writes its own objects against the same project record.

## Content submission pipeline

In-app submissions and Telegram messages enter one content queue. Telegram integration fetches bot updates in the main process, validates chat identity, parses one link, and deduplicates by update identity. It persists the inbound message, task, pending acknowledgment, and cursor together. After sending acknowledgment, it saves delivery status and resumes pending sends after restart. Startup resumes from the persisted update cursor for messages Telegram still provides.

At task start, the main process freezes current versions of every active focus card and records their count and version IDs. The worker retrieves the source snapshot through a platform adapter, generates general understanding, then evaluates each frozen card. Cards may be processed in batches; validated batch results are merged, and missing cards enter retry batches. Completion requires an evaluation for every card. Connections cite the source and frozen card.

Source, general understanding, and connections are separately saved stages. The main process deduplicates by stable task and stage identity, validates source locations and card references, then forms the final report. Saved stages remain readable after a failure; retries reuse valid stage results. The complete report is saved after every stage succeeds.

## Project analysis pipeline

Analysis first records a local repository input snapshot: directory, Git HEAD, worktree status, files actually read, and commit range. A Codex session reader discovers candidates from local indexes and metadata and attributes them using working directory and Git repository identity. Users confirm selected sessions before submission. A deterministic parser removes application-added content and returns user messages and necessary final assistant replies with message locations. The same rules produce previews and full input. It filters model thinking, tool calls and output, system configuration, and credentials. The model reads bounded batches; reports record used and skipped scope.

The worker uses repository snapshots, commits, and selected Codex conversations to produce findings, evidence, and card-change suggestions. Suggestions identify a target card and base version or a new card. The main process validates and saves a frozen report. For acceptance, it creates a first card version or compares an existing card with the suggestion's base version before saving a new version and acceptance record.

Actual input coverage is saved with the report. Source failures record completed sources and failure locations so the UI can present readable partial results or retry actions.

## Task center and Agent activity

The main process saves content stage results and analysis task states separately, then builds a unified task-center view. The worker emits structured stage and short activity events with action, target type, processed count, and displayable summary. The main process validates and persists recent events before broadcasting. Page changes and window reopening restore stage and activity from saved records.

Activities provide readable execution history; report evidence supports conclusions. Worker activity text is checked for length, origin, and sensitive fields. Model credentials, raw work conversations, and complete tool output stay inside controlled execution boundaries. On completion, failure, or cancellation, the main process writes final state and result reference before notifying the renderer.

## Models, Telegram, and local access

The main process manages model connections and freezes task configuration at launch. Workers receive only the connection and input needed for their tasks. Model connection settings and general API keys use an owner-only local JSON file. The first load migrates a legacy Safe Storage file into that format. Codex subscription accounts use the Codex login mechanism and its isolated file credential store; accounts previously held in the keyring require one new login. The main process manages Telegram bot credentials and authorized chat identities, exposing redacted status to the renderer.

Dedicated readers obtain repository files, Git history, and Codex sessions. Each receives an approved project directory, source range, and cancellation signal from the main process, then emits bounded content and source locations. External content and local conversations are analysis data; application code controls tool permissions and task steps.

## Target code structure

Stable domain boundaries organize the source:

- `src/shared/`: cross-process contracts for projects, cards, content and analysis reports, tasks, models, and integration messages.
- `src/main/`: project and card services, unified scheduling, content queue, analysis reports and suggestion acceptance, Telegram, atomic persistence, and controlled IPC.
- `src/readers/`: repository snapshots, Git history, and Codex session readers shared by previews and analysis.
- `src/worker/`: content and analysis tasks, understanding, per-card evaluation, and suggestion generation.
- `src/platforms/`: GitHub, X, and Xiaohongshu source adapters.
- `src/renderer/`: content reading, cards, analysis, task center, settings, and shared state components.

The [data contracts](data-contracts.md) define cross-module fields.
