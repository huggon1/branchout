# Branchout UX specification

The [product specification](product-spec.md) defines product behavior. This document describes target page structure, user flows, and visible states. The [design contract](../design.md) defines shared interaction rules.

## Navigation and opening screen

The left navigation shows Content, Projects, Focus Cards, Tasks, and Settings, in that order. Projects precede their cards. The app opens on the Content list. While tasks run, the Tasks entry continually shows the running count and states needing attention. Users can open the task center from any page to inspect current Agent work.

Content supports link submission, report search, and continuous reading. Focus Cards groups cards by project. Projects manages local repository bindings and starts analysis. Tasks owns analysis reports, suggestion review, and execution history. Settings manages models, Telegram, and content sources.

## Focus card editing

The Focus Cards page presents project-grouped text rows with search and a project filter. Each row uses the first line as an identifying label, followed by a short body excerpt, active or paused status, version, and update time. Editing and creation open a dialog with one free-text area; creation also selects the owning project.

Named icon actions edit, pause or activate, and delete a card. Deletion removes the row from the current list and later task snapshots, shows Undo, and retains the card in a collapsed Deleted section with Restore. Restoring preserves the saved active state. Historical project cards remain readable. Card links in reports open the exact referenced version; the version reader exposes all saved versions, including the current one.

## Content list and reading

The Content list offers Add Link and filters for search, source, time, and historical related projects. New items show a title, retrieval status, completion time, material count, and summary excerpt. Opening a reading report replaces the report index with its material directory and body. Return to Content List restores the index.

The material directory lists the main material first, followed by references and individual processing states. Selecting a material displays its title, source link, short introduction, actual coverage, and one Markdown body in the target language. A line beneath the source identity names the language frozen for that report. Selecting another material preserves each material's scroll position. The body renders images in source order, links, code, tables, and Mermaid diagrams. Narrow windows place the directory behind a Materials action.

Saved partial translations remain readable with their stopping position and a Continue Unfinished Materials action. A failed attachment shows its source and issue while other materials remain readable. Historical reports retain general understanding, grouped card connections, source snapshots, and saved-version links.

## Telegram forwarding

Settings shows Telegram connection status, authorized chats, and setup steps. Sending a supported link in a bound chat produces a receipt acknowledgment after the app retrieves and persists the message. On reopening, the task center shows pending messages being retrieved and processed. Full reports appear in the app.

One Telegram message produces one content task. For multiple links or unsupported formats, the bot gives actionable submission guidance. The app task center is the authority for processing status.

## Project analysis and reports

Projects uses a vertical repository index and a management reader with directory, card counts, task count, analysis action, and latest-task shortcut. Unbound projects move to history; their task shortcuts preserve access to saved reports. Analysis reports and acceptance controls appear inside Tasks.

Start Analysis opens a preparation dialog after repository and conversation discovery. The dialog shows repository state and discovered Codex sessions. It selects the ten most recently active confirmed sessions with readable user messages by default. The selector caps the chosen set at thirty and shows candidate and selected counts, user-message counts and excerpts in preview coverage, and project attribution. Search, filtering, grouping, and bulk actions help adjust the set. Users explicitly include sessions with uncertain attribution; scan scope and submitted session count are visible before launch. Submitting opens the new task. Its completed report presents one Markdown body with README implementation, tests, and documentation sections, followed by card suggestions. Numbered report references match supporting notes inside a collapsed Report Evidence disclosure. Coverage and evidence expand on demand.

Each suggestion compares the original and proposed card, shows rationale and evidence, and offers Accept. Acceptance links to the new card or version. If the target changed, the UI displays current and proposed text for another review.

## Task center

The task list shows task name, project or source, status, and recorded update time. Running and queued tasks appear first. Status filtering retains the selected task while it remains visible.

A running task reader emphasizes its current stage. Content tasks show persisted events in a collapsed Run Process disclosure. Project-analysis tasks present stage, result, or failure information; their detailed execution record opens through export.

A completed project-analysis task renders its report and suggestion acceptance directly in the same reader. Content tasks link to their Content reader, including saved partial results. Failed and canceled tasks show the recorded reason and a retry action. The analysis trace export remains a secondary task action and opens the latest session HTML directly after directory selection. Navigation preserves state; reopening reads saved tasks and activities.

## Settings and common states

Settings exposes a language selector for Simplified Chinese and English. Saving changes interface text and native menu labels while preserving page selection and drafts. Report content remains in its recorded generation language. Historical task details show that language.

Review and automated-test instances show their run mode, source revision, and data directory. Review startup keeps Telegram receiving paused and shows its current receiving state in Settings. Saving a Bot Token starts receiving for that instance.

Model settings show one current connection, selected from general API and Codex subscription. Telegram shows connection, chat binding, and message receipt. Content sources show GitHub, X, and Xiaohongshu reader capability and configuration.

Project analysis settings show optional report-emphasis and focus-card-writing guidance in separate text fields. Report guidance adjusts emphasis, detail, and wording; card guidance accepts concerns and examples. Saving applies filled fields to later runs. Clear Supplemental Information empties both fields. The page shows field errors and whether edits remain unsaved.

Empty projects, empty cards, zero connections, empty reports, missing model configuration, source failures, and insufficient analysis input each show a distinct state and next action. Narrow windows preserve the reading axis and primary actions; activities and connections scroll within their sections.

## Focus search and platform sessions

Focus Cards exposes Search Discussions. Its preparation dialog selects cards, Xiaohongshu and X, and a day, week, or month. Launch opens the search task in Tasks. The reader groups platform sections and card results, with the original AI reply followed by selectable candidate posts. Each candidate offers Open Original and Add to Parsing; added candidates link to their parsing task. A batch action submits selected candidates and displays individual failures. Empty and failed sections state their outcomes and offer retry for failed sections.

Settings groups GitHub under Public Sources and Xiaohongshu and X under Signed-in Platforms. GitHub describes public README parsing. Signed-in platform rows show the app icon, platform name, and session status. Expanded connection controls show browser availability and login and logout actions. Platform login opens a manual sign-in page in shared Chrome. Search, reading, and restart reuse all saved site sessions in the application profile. Reopening the connection brings its existing login page forward. Verification or expired sessions pause access for user handling.
