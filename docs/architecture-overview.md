# Branchout architecture overview

This document describes the target architecture. The [product specification](product-spec.md) defines behavior, [data contracts](data-contracts.md) define cross-module fields and task messages, and the [source guide](../src/README.md) describes intended module boundaries.

## Runtime boundaries and data ownership

Branchout uses Electron, React, and TypeScript. The renderer presents state and submits actions. The desktop main process owns writable project bindings, focus cards, content reports, analysis reports, tasks, and configuration. A separate Agent worker reads approved inputs and runs Pi model sessions. Source adapters retrieve and normalize GitHub, X, and Xiaohongshu content.

The main process validates renderer commands and worker results, persists them, then notifies the renderer. A surviving main process continues tasks when the window closes. After process restart, saved snapshots restore task state and Telegram pending messages are received. Interrupted Agent tasks become retryable according to saved stages; saved reports and stage results remain readable.

One project-binding service provides project identity, directory, and name. Cards, tasks, and reports reference that identity. Each storage module reads and writes its own objects against the same project record.

## Content submission pipeline

In-app submissions and Telegram messages enter one content queue. Telegram integration fetches bot updates in the main process, validates chat identity, parses one link, and deduplicates by update identity. It persists the inbound message, task, pending acknowledgment, and cursor together. After sending acknowledgment, it saves delivery status and resumes pending sends after restart. Startup resumes from the persisted update cursor for messages Telegram still provides.

At task start, the main process freezes current versions of every active, available focus card and records their count and version IDs. The worker retrieves the source snapshot through a platform adapter, generates general understanding, then evaluates each frozen card. Cards may be processed in batches; validated batch results are merged, and missing cards enter retry batches. Completion requires an evaluation for every card. Connections cite the source and frozen card.

Source, general understanding, and connections are separately saved stages. The main process deduplicates by stable task and stage identity, validates source locations and card references, then forms the final report. Saved stages remain readable after a failure; retries reuse valid stage results. The complete report is saved after every stage succeeds.

## Project analysis pipeline

Analysis records the repository directory, Git HEAD, and worktree status. A Codex session reader discovers candidates from local indexes and metadata and attributes them using working directory and Git repository identity. Users confirm selected sessions before submission. A deterministic parser extracts user messages and relevant final assistant replies into an owner-only XML file with message locations. The same parsing rules produce previews and full input. Reports record the files the agent opened and selected conversation scope.

The worker gives Pi the repository root, conversation XML path, and current focus cards. Pi explores files with read-only tools and produces findings, evidence, and card-change suggestions. Suggestions identify a target card and base version or a new card. The main process validates and saves a frozen report. For acceptance, it creates a first card version or compares an existing card with the suggestion's base version before saving a new version and acceptance record.

Pi runs one persisted session per model attempt. Its active tools are read, grep, find, ls, and local document-link inspection. Successful read bytes remain available for exact evidence validation. The agent can read long conversation XML files in sections and explore files under the repository root. The main process validates and saves the completed report. A failed model request can start another session; user retry starts a fresh task with saved project inputs and the current model connection. Session history remains available for HTML export from the task center.

The report saves successfully opened repository files and selected conversation coverage, including conversation read failures. The Pi trace retains file tool failures. The task records a failed stage and error category when analysis stops.

## Task center and Agent activity

The main process saves content stage results and analysis task states separately, then builds a unified task-center view. The worker emits structured stage and short activity events with action, target type, processed count, and displayable summary. The main process validates and persists recent events before broadcasting. Page changes and window reopening restore stage and activity from saved records.

Activities provide readable execution history; report evidence supports conclusions. Content activities flow through main-process validation, TaskService, and persisted TaskActivity. Project analysis sends stage changes and internal heartbeat events; full Pi messages and tool actions remain in its local session trace. The renderer reads optional display bodies through product-ui and sanitized Markdown. Worker activity text is checked for length, origin, and sensitive fields. Model credentials, raw work conversations, and complete tool output stay inside controlled execution boundaries. On completion, failure, or cancellation, the main process writes final state and result reference before notifying the renderer.

## Models, Telegram, and local access

The main process manages model connections and freezes task configuration at launch. Workers receive only the connection and input needed for their tasks. Model connection settings, general API keys, and the Telegram bot token use owner-only local JSON files. Queued Xiaohongshu recovery tokens reside in owner-only integration state files. The first load converts legacy Safe Storage values once and retains their encrypted originals or state snapshots. Codex subscription accounts use the Codex login mechanism and its isolated file credential store; accounts previously held in the keyring require one new login. The main process exposes redacted Telegram status to the renderer.

Dedicated readers inspect repository identity and parse selected Codex sessions. Pi's file tools explore the repository during analysis and retain the read locations in its session history. External content and local conversations are analysis data; application code controls tool permissions and task steps.

## Development runtime and prompt boundaries

The startup layer resolves one runtime profile before creating services. It supplies that profile to persistence, authentication, browser sessions, logging, workers, and instance locking. Separate profiles can run concurrently; a second writer to the same profile reports its existing owner. Review-mode integration policy controls background ingestion and scheduling. The [development guide](development.md) describes current development commands.

Application bootstrap owns lifecycle and startup ordering. Service assembly owns dependency wiring. Jobs own task sequencing and output validation. Model and platform adapters own external access. Automated verification replaces those external boundaries while retaining downstream application behavior.

Each job owns its fixed English instructions, prompt builder, and output protocol. Shared prompt helpers own language selection and common data-boundary rules. Builders accept typed task inputs, supplemental guidance, and frozen language settings; they return model request content and revision metadata. Task sequencing and persistence remain with the job and main-process services.

Renderer language resources own interface translations. Logical error categories cross process boundaries and resolve to interface text in the current language. Task language controls generated reader-facing output. The [language rules](product-spec.md#languages) define historical behavior, and [execution metadata](data-contracts.md#development-profiles-and-execution-identity) defines traceability.

## Target code structure

Stable domain boundaries organize the source:

- `src/shared/`: cross-process contracts for projects, cards, content and analysis reports, tasks, models, and integration messages.
- `src/main/`: project and card services, unified scheduling, content queue, analysis reports and suggestion acceptance, Telegram, atomic persistence, and controlled IPC.
- `src/readers/`: repository identity and Codex session readers shared by previews and analysis.
- `src/worker/`: content and analysis tasks, understanding, per-card evaluation, and suggestion generation.
- `src/platforms/`: GitHub, X, and Xiaohongshu source adapters.
- `src/renderer/`: content reading, cards, analysis, task center, settings, and shared state components.

The [data contracts](data-contracts.md) define cross-module fields.

## Renderer composition

The shell owns navigation and one module heading. Projects owns binding and preflight; Tasks composes the shared AnalysisReportView and owns suggestion review. Content uses a persistent index and reader with source-snapshot dialogs. Focus Cards uses project-grouped rows and version-aware editing, deletion, and restore commands. Primitives and semantic stylesheet tokens provide shared presentation. The [design contract](../design.md) defines geometry, hierarchy, responsive states, and acceptance requirements.
