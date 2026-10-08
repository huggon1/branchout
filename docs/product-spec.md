# Branchout product specification

Branchout helps users read collected content in their chosen language and find discussions through project focus cards. Each submitted link produces a reading report for its main content and direct referenced materials. Project analysis reads the repository and related work records to produce reviewable card-change suggestions.

This document describes target product behavior. The root [README](../README.md) describes currently available capabilities.

## Product scope

Branchout provides content reading, focus-card search, and project analysis. Users forward one link for asynchronous reading, search discussions with free-text focus cards, and review repository-based card suggestions.

## Projects and focus cards

A user binds a local Git repository as a project. A project has multiple focus cards; each card belongs to one project. The project binding manages its name and local directory; the user writes the card text.

A focus card is independently understandable free text describing a situation, difficulty, and desired outcome. Its project binding carries project identity. The editor offers an example of a concrete concern. Saving preserves the user's text; the user chooses any categories, keywords, or sections. Users create and edit cards manually.

Each card has a stable identity, an active or paused state, and versions. Active cards participate in later focus searches. Paused cards remain available for editing and reactivation. Content or state changes create new versions; saved reports retain the version used at generation time. The Focus Cards page supports viewing, creating, editing, pausing, activating, deleting, and restoring cards by project. Deletion records a tombstone and a new version, excludes the card from later active snapshots, and preserves referenced versions. Undo and the Deleted section restore cards using a current-version check. Suggestions targeting a deleted card report that the target is unavailable.

Unbinding moves a project into history and removes its cards from the active set. Completed content and analysis reports retain the project name and card versions used at generation time.

## Submission, understanding, and connections

Users submit one HTTPS link through the app or Telegram. The Agent reads the main material and explicitly supplied direct material URLs, including quoted posts and links in author replies. Referenced materials retain their own links as links. Collection depth is one. Shared Chrome provides saved website sessions and access to public pages. Platform guides and optional readers add site-specific help.

Each material contains its original snapshot, faithful translated Markdown, a short reading introduction, source URL, coverage, and processing state. GitHub repository scope is the default README. Audio and video use an existing readable transcript when available. Interactive pages contribute readable text and images, including accessible frames. The interface records the coverage actually retrieved.

Each material is presented in the application language frozen at task launch. Source text already in that language is presented faithfully; text in another language is translated. Presentation preserves information, paragraph order, headings, lists, tables, code, commands, identifiers, links, and image positions. Images use local cached copies when available and retain their source address.

Each introduction describes only its material, usually in two or three sentences. It names the subject, main content or result, and a distinctive detail. It attributes the author's opinions. A partial material's introduction describes its available portion. Short posts can use one sentence.

Long materials enter sequential translation chunks sized from available model capacity. Translation requests use the model's output capacity. An output-limit stop saves returned text and records the unfinished chunk. Retry reuses finished chunks and reads or translates remaining material. Individual material failures retain other saved results. Reopening restores sources, translations, summaries, and coverage.

New forwarding reports contain materials. Historical reports retain saved understanding and focus-card relations. Telegram acknowledges a link after locally queuing it, and the desktop app processes the queue while running. Reopening retrieves pending Telegram messages and deduplicates by message identity.

## Project analysis and suggestions

Users start project analysis from a project page. Each run receives the repository directory and selected Codex conversations associated with that project. Pi explores repository files with read-only tools and reads a locally generated conversation XML file. The report records files opened, selected conversation coverage, conversation read failures, and project state. The local Pi trace retains file tool failures. A draft with invalid output or citations receives up to two correction turns in the same session; an invalid final draft fails the task.

Analysis starts from README promises and follows repository implementation, tests, and documentation. Its Markdown report contains README promises and implementation, test coverage by behavior, and documentation and agent-guidance consistency. Findings support the report with exact repository excerpts. Local link inspection checks files and standard heading anchors; external links retain an unchecked scope. Test configuration and recorded results appear as distinct facts.

Analysis identifies angles worth watching and suggests creating or updating cards. Each suggested card describes a recognizable situation, a specific difficulty, and a desired outcome in natural free text. Repository purpose establishes candidate concerns; selected conversations refine user interests. Reasons identify whether a proposal comes from repository analysis or explicit user intent. The report holds rationale and supporting repository or conversation excerpts. Suggestions remain part of the report. Accepting one creates a card or a new version of an existing card. Acceptance compares the target card's current version with its suggested base version; a change asks the user to review the suggestion again.

The analysis UI lists identified conversations, project attribution, and previews of user messages before launch. It preselects the ten most recently active confirmed conversations with readable user messages. Users can adjust the set up to thirty conversations and explicitly include sessions with uncertain attribution. A deterministic reader extracts user messages and relevant final assistant replies into XML with message locations. The agent reads that file in sections, explores the repository, and draws angles from user goals, recurring concerns, tradeoffs, and unresolved issues.

Each analysis starts a persisted Pi Agent session with read-only file exploration tools. Pi controls its own file reading within that session. A transient model request failure can start another session, with up to three attempts per task. The task records its current stage and terminal result. Internal heartbeat events keep long-running exploration active; the Pi session retains model messages and tool actions. A user-initiated retry starts a new exploration session with the saved project, conversation, card, and prompt inputs and the current model connection. The task shows the failed stage and a specific error category when execution stops. Supported models use their reasoning capability during exploration.

The task center offers an export action for its local Pi session history. Export opens the latest model-attempt HTML record for the selected task directly. The export contains project material and selected work conversations and opens from a directory chosen by the user.

## Content, reports, and tasks

The Content page gathers reports and supports searching by title, source, time, and related project. New reading reports lead with a material directory, summary, and one body in the target language. A line near the top names the report's saved target language. The source link opens the original page. Historical connections link to their saved project and card. Historical reports retain their original rationale and card versions.

Analysis reports retain their project identity and appear inside the task that produced them. Project pages manage bindings and start analysis. They retain conclusions, input coverage, evidence, and suggestion acceptance status. Later project or card changes leave historical judgments intact.

The task center combines content and analysis tasks, showing queued, running, completed, failed, and canceled states. Running tasks show the current stage. Content tasks also provide a chronological process disclosure. Users can return from other pages and open results on completion. Reopening the window restores saved task state.

## Languages

Users select Simplified Chinese or English in Settings. The selection controls application labels, menus, guidance, and application-generated errors. User-entered cards, source text, quotations, URLs, and technical identifiers retain their original content.

New model tasks use the selected language for translated materials, reading introductions, findings, reasons, and suggested card text. Each task freezes its output language at launch. Changing the interface language updates the interface immediately; saved reports retain their generated language. A user retry retains the saved task language. Platform search language belongs to the search request when that capability is introduced.

## Settings and runtime boundaries

Settings contain one current model connection, Telegram access, and source reader configuration. A general API connection stores an API key, service URL, API type, and model ID in an owner-only local file; the API type is OpenAI Responses or OpenAI Chat Completions. A Codex subscription connection uses ChatGPT account login and selects an available model for that account and client. New configuration applies to later tasks; running tasks retain their start-time configuration.

Project analysis settings provide optional analysis-goal and focus-card-writing guidance. Filled fields enter the task message as user supplemental information. Each analysis run records the supplied guidance and its revision at launch. Evidence citation, JSON output, and source-as-data rules remain application controlled.

Controlled local readers inspect repository identity and selected Codex conversations. Pi's read-only tools access the project directory and the task's conversation file. Telegram accepts messages from bound chats; its bot credential uses an owner-only local file. Reports, task activity, and UI state use redacted content and error summaries. Source content and work conversations are analysis data; application code controls execution instructions.

## Manual focus search

Users select available focus cards, Xiaohongshu and/or X, and a recent day, week, or month. A manual run searches each card independently through the platform AI. Xiaohongshu receives Chinese prompts; X receives English prompts. Free-form card text retains its project context and interest. Each request starts a separate platform conversation.

The task report groups results by platform and card. Each result retains the original platform reply, extracted post titles, citation descriptions, source links, and failure state. The selected period is a fuzzy instruction to the platform AI. Available publication dates appear with their evidence. A completed search may yield zero links. Successful sections remain readable when another section fails. Retrying searches failed or interrupted sections with the saved inputs.

Users open original posts or submit selected candidates to content parsing. Submission creates independent content tasks; the search report retains their identities. Repeated addition of the same platform post within a report returns its existing content task. Reports preserve the launch-time card text, platform selection, period, prompt, and prompt language.
