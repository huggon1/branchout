# Branchout data and message contracts

This document defines the target design's logical objects, cross-process fields, and persistence order. See the [product specification](product-spec.md) for rules, [UX specification](ux-spec.md) for page behavior, and [architecture overview](architecture-overview.md) for runtime responsibilities. Implementation determines database files, IPC names, and TypeScript types.

## Identity and persistence ownership

The main process owns writable state. The renderer submits commands and reads saved snapshots. Workers deliver results for validation.

| Identifier | Refers to |
| --- | --- |
| `projectId` | One local Git project binding |
| `focusId`, `focusVersionId` | One focus card and one content or state version |
| `taskId` | One content submission or project analysis task |
| `resultId` | One task result awaiting persistence, used to detect repeated delivery |
| `materialId` | One content report |
| `analysisReportId` | One project analysis report |
| `suggestionId` | One card-change suggestion in an analysis report |

All timestamps include timezone information; the UI displays them in the user's timezone. Project binding is the sole source of project identity. Other objects reference `projectId` and retain a readable project name where history requires one.

## Projects and focus cards

`ProjectBinding` stores `projectId`, readable name, normalized local directory, binding time, and binding status. The main process verifies directories; one normalized directory corresponds to one project identity. Unbinding moves the record to history and removes its cards from the active set.

`FocusCard` stores `focusId`, `projectId`, current `focusVersionId`, and creation time. `FocusVersion` is immutable and stores version ID, card ID, user-written `content`, `active` state, version number, and save time. The UI derives a label from the first line or excerpt; connection tasks use the full text. Text remains free-form while the app maintains system metadata.

At content task start, `FocusSetSnapshot` records the time, each active card's `projectId + projectLabel + focusId + focusVersionId`, and the text version used by the task. Connections reference this snapshot. Later edits, pauses, or unbinding leave historical card text and project names available.

## Submitted sources and reports

One link from the app or Telegram enters the same `ForwardingRequest`. It contains `taskId`, normalized URL, and entry point `app` or `telegram`. Telegram requests also contain verified chat and message identity. Supported links cover public GitHub repositories, X posts, and Xiaohongshu notes.

`SourceContent` stores platform, original URL, title or source identity, retrieval time, ordered and locatable text blocks and image references, plus `completeness`: `complete`, `partial`, or `unknown`. Partial and unknown results explain actual coverage. Adapters may instead return `not_covered` or `read_failed` with a reason.

`GeneralUnderstanding` stores readable understanding derived from a source snapshot and that snapshot's ID. `FocusRelation` stores `projectId`, `focusId`, `focusVersionId`, rationale, and one or more evidence references to source blocks or excerpts. The relation list can be empty and grows with actual relevant cards.

`ForwardingReport` uses `materialId`, `taskId`, and `resultId` and stores the source snapshot, understanding, focus-set snapshot, relations, completion time, and display name. Each submission creates a separate report, even for the same URL. The main process deduplicates repeated worker delivery by `taskId + resultId`.

The relation stage records `evaluatedFocusVersionIds` against the full `FocusSetSnapshot`. A complete report requires equal sets and validated batches. Zero relations save an empty list with completed evaluation coverage.

## Project analysis input and results

`ProjectAnalysisInput` contains `taskId`, `projectId`, normalized repository directory, repository snapshot, Git commit range, user-confirmed Codex session identities, and focus card versions at launch. The repository snapshot records Git HEAD, uncommitted changes, input summary, and files actually read. Commit input records IDs, times, and read message or diff ranges.

`AnalysisPromptSettings` stores the editable analysis goal and focus-card-writing guidance. The main process derives a revision from the effective text and fixed prompt-protocol version. `ProjectAnalysisInput` freezes both fields and the revision at launch; retries reuse that snapshot. Prompt settings contain guidance text; model credentials stay in model storage.

A Codex candidate records session identity, time, working directory, verifiable project attribution clues, available user-message count, execution-record count, redacted excerpt, and selection state. Discovery also records index scan count and scope. The selected-session reader delivers deterministically cleaned user messages and necessary final assistant replies. Each excerpt stores role, session identity, message location, and text. Parsed coverage, model batch counts, and read failures enter report coverage. `AnalysisEvidenceRef` names source type `repository`, `commit`, or `codex_session`, its version ID, file or message location, and readable excerpt.

`ProjectAnalysisReport` stores `analysisReportId`, `taskId`, project identity and name, generation time, input coverage, readable findings, evidence, and suggestions. Coverage distinguishes repository files, commits, and Codex sessions actually read or skipped, plus failure locations. Saved conclusions and source locations stay fixed.

`AnalysisBatchCheckpoint` stores a manifest digest of model selection, source batches, and effective prompts, the planned batch count, and each validated batch result in sequence. The main process acknowledges each saved result before the worker advances. A resumed task links its Pi session records to the saved batches it reuses. Each report stores the effective prompt guidance and revision used by its run.

`FocusSuggestion` has `suggestionId`, `kind` (`create` or `update`), proposed text, rationale, and evidence references. An update also has target `focusId` and `baseFocusVersionId`. A separate acceptance record stores status and resulting `focusVersionId`, retaining the original report text. Acceptance deduplicates by `analysisReportId + suggestionId`; a changed current card version returns a review-required state.

## Telegram queue

Telegram integration stores authorized chat identities, bot connection state, and confirmed update cursor. Bot credentials reside in protected local storage. Chat and message identities form a stable inbound key. One persistence operation records inbound key, queued task, pending acknowledgment, and cursor progress; acknowledgment delivery is saved separately. Fetching a duplicate message reads the original task state. Unsupported formats save cursor and guidance state, then send submission guidance to that chat.

At startup, the app fetches updates Telegram still provides from the confirmed cursor and sends pending acknowledgments. Integration status tracks last successful fetch, error summary, and pending count for Settings and Tasks. A link parser validates message content; user-visible notices use redacted chat and message identifiers.

## Task snapshots and activity messages

`TaskSnapshot` is the task center's unified view. It contains `taskId`, kind `forwarding` or `project_analysis`, target identity, status `queued`, `running`, `completed`, `failed`, or `cancelled`, current stage, processed count, update time, readable error, and successful result reference. Saved stage records build the content view. Content stages are receipt, source retrieval, understanding, card evaluation, and report save; analysis stages are repository, commits, Codex sessions, findings and suggestions, and report save.

`TaskActivity` contains `taskId`, increasing sequence number, time, action kind, readable summary, optional target identity, and processed count. After main-process validation, recent activities and current stage are persisted for the UI; longer evidence comes from reports. Task messages contain only display summaries and counts.

The main process handles worker events in this order:

1. Save the initial task snapshot and frozen input identities, then start the worker.
2. Validate and save stage results, activity, and progress, then notify the renderer.
3. Validate and save the final report and reference, then mark the task complete and notify the renderer.
4. On interruption, save the failed stage and completed scope, retaining readable stage results for retry.

Pi session files stay under the application's local data directory. A user initiated export copies the related HTML attempts into a selected local directory and writes an index linking them. Task activity stores short validated status summaries; model prompts and complete responses stay in the session files.

Model configuration is frozen at launch. The current model connection is stored in `model-connection.json` with owner-only file permissions; the first read of a legacy `model-connection.enc` saves its validated contents into the new file. Renderer, snapshots, reports, and activities read redacted state. The main process validates source content, model output, card references, and suggestion changes before persistence.
