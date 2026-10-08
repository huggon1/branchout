# Branchout architecture overview

This document describes the target architecture. The [product specification](product-spec.md) defines behavior, [data contracts](data-contracts.md) define cross-module fields and task messages, and the [source guide](../src/README.md) describes intended module boundaries.

## Runtime boundaries and data ownership

Branchout uses Electron, React, and TypeScript. The renderer presents state and submits actions. The desktop main process owns writable project bindings, focus cards, content reports, analysis reports, tasks, and configuration. A separate Agent worker reads approved inputs and runs Pi model sessions. Source adapters retrieve and normalize GitHub, X, and Xiaohongshu content.

The main process validates renderer commands and worker results, persists them, then notifies the renderer. A surviving main process continues tasks when the window closes. After process restart, saved snapshots restore task state and Telegram pending messages are received. Interrupted Agent tasks become retryable according to saved stages; saved reports and stage results remain readable.

One project-binding service provides project identity, directory, and name. Cards, tasks, and reports reference that identity. Each storage module reads and writes its own objects against the same project record.

## Content submission pipeline

In-app submissions and Telegram messages enter one content queue. Telegram integration fetches bot updates in the main process, validates chat identity, parses one link, and deduplicates by update identity. It persists the inbound message, task, pending acknowledgment, and cursor together. After sending acknowledgment, it saves delivery status and resumes pending sends after restart. Startup resumes from the persisted update cursor for messages Telegram still provides.

At task start, the main process freezes the output language and model connection. PlatformAccess invokes BrowserAgent with the reading-collection task instruction. The same runtime and browser tools serve focus search. The collection result names successful capture IDs; the main process resolves them to exact text, ordered Markdown, links, and images. Reference validation requires a direct URL in a main or author-reply capture. The collector resolves short links and deduplicates final destinations.

The main process saves the main material and discovered reference list, then saves each reference as its separate browser task returns. The forwarding worker translates each unfinished chunk, writes material updates through validated events, and generates a short introduction. Per-material failures preserve other results. Saved completed chunks and source bytes remain fixed during retry. Historical forwarding records retain the prior source, understanding, and relation workflow.

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

Application bootstrap owns lifecycle and startup ordering. It opens the main window after service initialization and IPC registration; activation during startup uses the same readiness boundary. Service assembly owns dependency wiring. Jobs own task sequencing and output validation. Model and platform adapters own external access. Automated verification replaces those external boundaries while retaining downstream application behavior.

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

The shell owns navigation; the selected entry identifies the current module. Projects owns binding and preflight; Tasks composes the shared AnalysisReportView and owns suggestion review. Content switches between its report index and a material directory with translated and original bodies. Historical reports retain source-snapshot dialogs. Focus Cards uses project-grouped rows and version-aware editing, deletion, and restore commands. Primitives and semantic stylesheet tokens provide shared presentation. The [design contract](../design.md) defines geometry, hierarchy, responsive states, and acceptance requirements.

## Platform browser and focus search

Shared Chrome uses `<application-data>/platform-browser/shared`. All task types receive the same site sessions and browser tools. Existing platform profiles migrate their cookies once; their original files remain available. Separate Branchout runtime profiles retain separate browser data.

| Layer             | Responsibility                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| ChromeProfiles    | Start installed Chrome, attach through loopback CDP, and track process ownership                                                           |
| PlatformBrowser   | Maintain the shared session, human login pages, serialized task pages, HTTPS navigation, snapshots, frame access, and ordered body capture |
| BrowserAgent      | Run the shared Pi browser session and retain observed inputs, navigation destinations, links, and captures                                 |
| PlatformAccess    | Validate source provenance, save original materials and cached images, and validate search candidates                                      |
| Platform guidance | Supply optional site instructions, AI entry points, and enhanced reading through shared tools                                              |

Each task injects one requirement message after the common browser system instructions. Platform instructions load through the guide action when the Agent requests them. The enhanced-read action is available to every browser task and reports availability at use. The [Agent prompt flow](agent-prompt-flow.md) maps these inputs to their owning modules.

Task navigation accepts credential-free HTTPS URLs across sites. Search text submission uses recognized platform AI pages. Human sign-in stays in manual login pages. The shared browser stores website credentials; task captures and reports contain retrieved source content. Status files store cookie names, domains, and expiry metadata. Xiaohongshu cookie synchronization supplies its optional reader. Signing out clears only the selected platform's session cookies.

Focus-search orchestration saves frozen cards and per-card/platform results in its own store. TaskService owns unified status and activity. Extraction verifies candidate URLs against observed browser links. A persisted candidate-to-forwarding-task association supports repeated submission and restart recovery.
