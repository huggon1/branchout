# Branchout product specification

Branchout helps users connect actively collected content to projects they are building. Users maintain focus cards for local projects. Each submitted link produces a content report that identifies connections to active cards. Project analysis reads the repository and related work records to produce reviewable card-change suggestions.

This document describes target product behavior. The root [README](../README.md) describes currently available capabilities.

## Product scope

Branchout provides two connected capabilities:

1. **Content connections:** Bind a local Git repository, maintain focus cards manually, submit links in the app or through Telegram, and read content understanding and focus connections.
2. **Project analysis:** Read current local repository content, Git commit history, and local Codex work conversations associated with the project. Produce an analysis report and card-change suggestions for individual acceptance.

## Projects and focus cards

A user binds a local Git repository as a project. A project has multiple focus cards; each card belongs to one project. The project binding manages its name and local directory; the user writes the card text.

A focus card is short, independently understandable free text. It includes enough project context and an angle of interest for later connection tasks to evaluate submitted content from the card alone. The editor guides writing with instructions and an example. Saving preserves the user's text; the user chooses any categories, keywords, or sections. Users create and edit cards manually.

Each card has a stable identity, an active or paused state, and versions. Active cards participate in later connections. Paused cards remain available for editing and reactivation. Content or state changes create new versions; saved reports retain the version used at generation time. The Focus Cards page supports viewing, creating, editing, pausing, and activating cards by project.

Unbinding moves a project into history and removes its cards from the active set. Completed content and analysis reports retain the project name and card versions used at generation time.

## Submission, understanding, and connections

Users submit one link through the app or Telegram. Readable sources are public GitHub repositories, X posts, and Xiaohongshu notes. Each source adapter reports retrieval scope, completeness, and failures.

Users configure Telegram and bind authorized chats in Settings. Once the bot receives and locally queues a link, it acknowledges receipt. The desktop app processes the queue while running. When reopened, it retrieves pending messages still available from Telegram, deduplicates by message identity, and resumes processing. Full reports are read in the desktop app.

Each submission creates an independent report containing a source snapshot, general understanding of retrieved content, and connections to active focus cards. The UI distinguishes source text and images, model-generated understanding, and connection judgments. For partial or unknown retrieval completeness, the report states actual coverage; understanding and connections rely on that coverage.

A connection task uses the source snapshot and versions of every active card frozen at task start, across all projects. It evaluates each card and shows every evidence-backed connection. The result may contain zero connections and grows with actual relevance. Each connection names the project, card, relationship, and supporting source content. Project analysis reads repository and work records separately.

If source retrieval, understanding, or connection evaluation fails, the UI shows completed stages and a retry action. Valid saved source and understanding results remain readable. A complete report forms after connection evaluation succeeds.

## Project analysis and suggestions

Users start project analysis from a project page. Each run reads the current local repository, locatable Git commit history, and local Codex work conversations verifiably associated with that project. Its report records actual sources, coverage, project state, and read failures for later inspection.

Analysis identifies angles worth watching and suggests creating or updating cards. Each suggested card includes the context and angle needed for independent matching. Each suggestion includes rationale and supporting repository, commit, or conversation excerpts. Suggestions remain part of the report. Accepting one creates a card or a new version of an existing card. Acceptance compares the target card's current version with its suggested base version; a change asks the user to review the suggestion again.

The analysis UI lists identified conversations, project attribution, available previews of user messages, and coverage before launch. Users adjust selected sessions and explicitly include sessions with uncertain attribution. A deterministic reader removes application-added content, extracts user messages and final assistant replies needed for context, and retains message locations. Analysis processes selected sources in batches, drawing angles from user goals, recurring concerns, tradeoffs, and unresolved issues. The report records sources actually used, batch counts, and read failures.

## Content, reports, and tasks

The Content page gathers reports and supports searching by title, source, time, and related project. Reading centers on source text and images, then shows general understanding and connected cards. A connection links to its project and card. Historical reports retain their original rationale and card versions.

Analysis reports belong to projects and are listed on project pages. They retain conclusions, input coverage, evidence, and suggestion acceptance status. Later project or card changes leave historical judgments intact.

The task center combines content and analysis tasks, showing queued, running, completed, failed, and canceled states. Running tasks show the current stage, recent readable activity, processed scope, and next step. Users can return from other pages and open results on completion. Reopening the window restores saved task state.

## Settings and runtime boundaries

Settings contain one current model connection, Telegram access, and source reader configuration. A general API connection stores an API key, service URL, API type, and model ID in an owner-only local file; the API type is OpenAI Responses or OpenAI Chat Completions. A Codex subscription connection uses ChatGPT account login and selects an available model for that account and client. New configuration applies to later tasks; running tasks retain their start-time configuration.

Project analysis settings provide editable analysis-goal and focus-card-writing guidance with shipped defaults. Each analysis run records the effective guidance and its revision at launch. Evidence citation, JSON output, and source-as-data rules remain application controlled.

Controlled local readers access project files, Git history, and Codex conversations. Model tasks receive only the content selected for that analysis. Telegram accepts messages from bound chats; its bot credential uses protected local storage. Reports, task activity, and UI state use redacted content and error summaries. Source content and work conversations are analysis data; application code controls execution instructions.
