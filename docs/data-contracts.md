# Branchout data and message contracts

This document defines the target design's logical objects, cross-process fields, and persistence order. See the [product specification](product-spec.md) for rules, [UX specification](ux-spec.md) for page behavior, and [architecture overview](architecture-overview.md) for runtime responsibilities. Implementation determines database files, IPC names, and TypeScript types.

## Identity and persistence ownership

The main process owns writable state. The renderer submits commands and reads saved snapshots. Workers deliver results for validation.

| Identifier                  | Refers to                                                              |
| --------------------------- | ---------------------------------------------------------------------- |
| `projectId`                 | One local Git project binding                                          |
| `focusId`, `focusVersionId` | One focus card and one content or state version                        |
| `taskId`                    | One content submission or project analysis task                        |
| `resultId`                  | One task result awaiting persistence, used to detect repeated delivery |
| `materialId`                | One content report                                                     |
| `analysisReportId`          | One project analysis report                                            |
| `suggestionId`              | One card-change suggestion in an analysis report                       |

All timestamps include timezone information; the UI displays them in the user's timezone. Project binding is the sole source of project identity. Other objects reference `projectId` and retain a readable project name where history requires one.

## Projects and focus cards

`ProjectBinding` stores `projectId`, readable name, normalized local directory, binding time, and binding status. The main process verifies directories; one normalized directory corresponds to one project identity. Unbinding moves the record to history and removes its cards from the active set.

`FocusCard` stores `focusId`, `projectId`, `currentVersionId`, creation and update times, and optional `deletedAt`. `FocusVersion` is immutable and stores version ID, card ID, user-written `content`, version number, and save time. The UI derives a label from the first line or excerpt; connection tasks use the full text. Text remains free-form while the app maintains system metadata.

At focus-search task start, `FocusSetSnapshot` records the time, each retained card's `projectId + projectLabel + focusId + focusVersionId`, and the text version used by the task. Search reports reference this snapshot. Later edits, deletion, or unbinding leave historical card text and project names available. Retained snapshots select cards in bound projects with a readable current version and an absent `deletedAt`. The storage schema accepts an optional legacy `active` field and historical pause-related change kinds. Existing versions retain those fields; new versions store text and creation, editing, deletion, or restoration changes. Snapshot selection uses project binding and deletion state.

`setFocusCardDeleted` takes `focusId`, `expectedVersionId`, and `deleted`. The main process compares the version within the store transaction, appends a `deleted` or `restored` version preserving text, and sets or clears the tombstone. Editing and suggestion acceptance require an available card. Existing state files remain readable because `deletedAt` is optional.

## Submitted sources and reports

One app or Telegram HTTPS URL enters the shared forwarding queue with task, result, and material identities. Telegram also supplies verified chat and message identity. New tasks set `reading: true` and freeze `outputLanguage`. Historical tasks retain the prior fields and workflow.

`SourceContent` stores the requested URL, platform identity (`github`, `x`, `xiaohongshu`, or `web`), source identity, retrieval time, ordered Markdown, legacy content blocks, images, and actual completeness. Image records retain their remote URL and an optional local `branchout-image` cache URL. Source bytes remain fixed on retry.

`ReadingMaterial` contains `id`, `role` (`main` or `reference`), URL, title, optional source, indexed translation chunks, summary, state, and issue. Each chunk contains `original`, `translated`, and `complete`. The material array starts with one main material and has unique IDs and URLs. States are pending, processing, completed, partial, and failed. A completed material has a source, summary, and completed chunks.

The worker emits initial `materials`, individual `material` updates, phase changes, execution identity, and the final report. Main-process validation preserves material identity, saved source bytes, and completed chunks. A final report equals saved material state. Some materials may remain partial or failed while the report is readable and retryable.

Historical `GeneralUnderstanding`, `FocusRelation`, frozen card sets, and evaluation fields retain their saved values and rendering. Each submission creates an independent report. Task and result identities deduplicate worker delivery.

## Project analysis input and results

`ProjectAnalysisInput` contains `taskId`, `projectId`, normalized repository directory, user-confirmed Codex session identities, and focus card versions at launch. The repository snapshot records Git HEAD and worktree state. The agent session records files opened through its read tool. Evidence validation uses the bytes captured by successful reads. Invalid quotations or suggestion targets receive up to two correction turns before final output validation; an invalid final output fails before report persistence.

`AnalysisPromptSettings` stores optional analysis-goal and focus-card-writing guidance. `ProjectAnalysisInput` freezes filled fields and their revision at launch; retries reuse that snapshot. Instruction revision and output language follow the [execution metadata contract](#development-profiles-and-execution-identity). Prompt settings contain guidance text; model credentials stay in model storage.

A Codex candidate records session identity, time, working directory, verifiable project attribution clues, available user-message count, execution-record count, redacted excerpt, and selection state. Discovery also records index scan count and scope. The selected-session reader writes cleaned user messages and relevant final assistant replies to an owner-only XML file. Each message stores role, session identity, message location, and text. Parsed coverage and conversation read failures enter report coverage. `AnalysisEvidenceRef` names source type `repository` or `codex_session`, its file or message location, and readable excerpt.

`ProjectAnalysisReport` stores `analysisReportId`, `taskId`, project identity and name, generation time, input coverage, a complete Markdown report body in `summary`, supporting findings, evidence, and suggestions. The body holds the three report sections as prose. Numbered body references correspond to the order of supporting findings. Coverage distinguishes repository files opened through the agent tool and selected Codex sessions, including conversation read failures. File tool failures remain in the Pi trace. Saved conclusions and source locations stay fixed. Historical reports retain their previously saved commit coverage for reading older results.

The task stores project, conversation, card, and prompt inputs at launch. The worker returns one report draft after agent exploration; the main process validates and saves it. A user retry starts a fresh exploration session with those saved inputs and the current model connection. Each report stores the supplemental guidance and revision used by its run.

`FocusSuggestion` has `suggestionId`, `kind` (`create` or `update`), proposed text, rationale, and evidence references. An update also has target `focusId` and `baseFocusVersionId`. A separate acceptance record stores status and resulting `focusVersionId`, retaining the original report text. Acceptance deduplicates by `analysisReportId + suggestionId`; a changed current card version returns a review-required state.

## Development profiles and execution identity

`RuntimeProfile` records run mode (`installed`, `review`, or `test`), resolved data directory, and integration policy. Application storage, logs, authentication, and browser sessions resolve under the selected profile. Separate instances use independent profiles.

Profile preparation accepts empty data, an existing development profile, or an explicitly selected copy source. Copy preparation requires an inactive source writer, validates the copied business records before making the destination usable, and preserves the source and previous usable destination on failure. Copied active tasks retain completed stages and become retryable interrupted records. Background integrations start paused in review mode.

Copies include business records by default. Credentials and authentication require explicit selection of supported data groups. Private profiles reside in owner-only local storage; automated test artifacts use fictional data and redacted diagnostics.

Shared Chrome resolves by application data directory and retains website sessions across browser and application restarts. Search and source reading use the same session. Explicit platform sign-out clears that platform's cookies and compatibility backup. Redacted status files contain cookie names and expiry metadata. Cookie values remain within the platform profile and the authorized Xiaohongshu reader.

Profile initialization supports native Chrome profiles and mock-keychain profiles. A mock-keychain profile carries saved session metadata and an absent native-initialization marker. Initialization reads its cookies with the compatible launcher, saves an owner-only JSON recovery backup containing cookie values, imports them into native Chrome, and records the marker. The backup uses filesystem permissions for protection. A native-initialized profile uses its active Chrome session on subsequent starts.

`BuildIdentity` records source revision, dirty state, application version, platform, and build time. Packaged builds additionally record an artifact checksum. Installed data directories remain independent of checkout paths.

`PromptExecution` records task and attempt identity, prompt revision, supplemental-guidance revision, output language (`zh-CN` or `en`), model identity, and build identity. Prompt revision derives from fixed instructions, builder version, and output protocol. Main-process task input freezes output language and supplied guidance; attempts record the builder and model actually used. Historical reports retain their execution metadata and generated text. Saved input reuse follows the owning retry flow; each attempt exposes its actual prompt revision.

## Telegram queue

Telegram integration stores authorized chat identities, bot connection state, and confirmed update cursor. The bot token resides in an owner-only local JSON file. Queued Xiaohongshu recovery tokens use the `local-v1:` representation inside owner-only Telegram and forwarding state files. The first load converts legacy Safe Storage ciphertext once and retains the original encrypted bot file or a byte-for-byte state snapshot. Malformed local files or failed migration produce a specific startup error and preserve the original bytes. Chat and message identities form a stable inbound key. One persistence operation records inbound key, queued task, pending acknowledgment, and cursor progress; acknowledgment delivery is saved separately. Fetching a duplicate message reads the original task state. Unsupported formats save cursor and guidance state, then send submission guidance to that chat.

At startup, the app fetches updates Telegram still provides from the confirmed cursor and sends pending acknowledgments. Integration status tracks last successful fetch, error summary, and pending count for Settings and Tasks. A link parser validates message content; user-visible notices use redacted chat and message identifiers.

## Task snapshots and activity messages

`TaskSnapshot` is the task center's unified view. It contains `taskId`, kind `forwarding` or `project_analysis`, target identity, status `queued`, `running`, `completed`, `failed`, or `cancelled`, current stage, processed count, update time, readable error, and successful result reference. Saved stage records build the content view. New content stages are receipt, material collection, translation, summary, and report save; historical stages retain understanding and card evaluation; analysis stages are repository, Codex sessions, exploration, and report save.

`TaskActivity` contains content-task events with increasing sequence number, time, action kind, readable summary, optional target identity, processed count, and an optional bounded display body. Project-analysis events update current stage and execution metadata. A heartbeat refreshes the worker inactivity deadline; its payload contains task identity. Pi messages and tool actions remain in the session record.

The main process handles worker events in this order:

1. Save the initial task snapshot and frozen input identities, then start the worker.
2. Validate and save stage results, activity, and progress, then notify the renderer.
3. Validate and save the final report and reference, then mark the task complete and notify the renderer.
4. On interruption, save the failed stage and completed scope, retaining readable stage results for retry.

Pi session files stay under the application's local data directory. A user initiated export copies the selected task’s latest model-attempt HTML into a selected local directory and opens that file directly. Task activity stores validated summaries and bounded public-message bodies; model prompts and complete responses stay in the session files.

Model configuration is frozen at launch. The current model connection is stored in `model-connection.json` with owner-only file permissions; the first read of a legacy `model-connection.enc` saves its validated contents into the new file. Renderer, snapshots, reports, and activities read redacted state. The main process validates source content, model output, card references, and suggestion changes before persistence.

## Focus-search reports

`focus_search` tasks reference `focus_search_report` results. A search report saves its task identity, creation time, frozen focus snapshot, selected platforms, period, and ordered card/platform sections. Sections save their exact search prompt and language, original platform response, candidate links, and completion or error status. Candidates carry stable identity, platform post identity, title, description, URL, and optional displayed date. URLs refer to posts on the section's platform and originate from observed browser links.

Each successful browser capture returns a task-local `captureId`. Search workers select `replyCaptureId`; material collectors select `sourceCaptureIds` and a reference's `citedFromCaptureId`. The main process resolves that identity to the captured text and image records before validating the result. The saved source and platform reply use the captured bytes.

Xiaohongshu browser reading reconstructs the requested note address with the queued recovery token when available. Saved source records retain the canonical note URL; the owner-only queue stores the recovery token separately.

Submission records map a report and canonical post identity to a reserved forwarding task ID. The reservation is saved before forwarding submission; replay uses the reserved identity. Batch replies contain a result for each candidate. Forwarding tasks retain their ordinary independent lifecycle and content-stage persistence.
