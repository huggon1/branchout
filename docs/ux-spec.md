# Branchout UX specification

The [product specification](product-spec.md) defines product behavior. This document describes target page structure, user flows, and visible states. The [design system](design-system.md) defines shared interaction rules.

## Navigation and opening screen

The left navigation shows Content, Projects, Focus Cards, Tasks, and Settings, in that order. Projects precede their cards. The app opens on the Content list. While tasks run, the Tasks entry continually shows the running count and states needing attention. Users can open the task center from any page to inspect current Agent work.

Content supports link submission, report search, and continuous reading. Focus Cards groups cards by project. Projects manages local repository bindings, analysis, and reports. Tasks shows current and recently completed work. Settings manages models, Telegram, and content sources.

## Focus card editing

The Focus Cards page shows project selection, then active and paused cards. Lists use the first line or a short excerpt as an identifying label, plus status and update time. Card details show full text and version. Creation and editing use a single free-text area.

Guidance asks for necessary project context and an angle of interest, with one short example. Saved text appears as written. Status actions sit by the card; after pausing or reactivation, lists and later submissions use the updated state. Card links in reports open the historical version and offer a route to the current one.

## Content list and reading

The Content list offers Add Link at the top and filters for search, source, time, and related project. Each item shows a title or identifiable link, retrieval status, completion time, and related projects. Reports with zero connections have an explicit state in the list and reading view.

The reading view focuses on one item. Stable back, previous, and next actions retain filters and list position. The page presents source identity and completeness, source text and images, general understanding, then “Connected to your focus.” Connections group by project and show the card excerpt, specific relationship, supporting source excerpt, and card link. All results remain available; grouping and collapse keep long lists readable.

When only some stages finish, the reading view shows saved source or understanding, the unfinished stage, and a retry action. Completeness appears by the source; connection failures appear by the connection area.

## Telegram forwarding

Settings shows Telegram connection status, authorized chats, and setup steps. Sending a supported link in a bound chat produces a receipt acknowledgment after the app retrieves and persists the message. On reopening, the task center shows pending messages being retrieved and processed. Full reports appear in the app.

One Telegram message produces one content task. For multiple links or unsupported formats, the bot gives actionable submission guidance. The app task center is the authority for processing status.

## Project analysis and reports

Projects lists local repositories and binding status. A project page shows its card overview, analysis action, and historical reports. Unbound projects move to history while retaining report and referenced-card reading paths.

Before analysis, the UI lists the planned repository range, Git history range, and discovered Codex sessions. The session selector shows candidate and selected counts, user-message counts and excerpts in preview coverage, and project attribution. Search, filtering, grouping, and bulk actions help adjust the set. Users explicitly include sessions with uncertain attribution; scan scope and submitted session count are visible before launch. The report shows conclusions and coverage, then findings and evidence, then card suggestions.

Each suggestion compares the original and proposed card, shows rationale and evidence, and offers Accept. Acceptance links to the new card or version. If the target changed, the UI displays current and proposed text for another review.

## Task center

The task list uses task name, project or source link, status, start time, and result. Running tasks appear first. Details show recent Agent activities in time order, such as reading a source, understanding content, checking card 8 of 16, reading 12 commits, analyzing selected Codex sessions, or preparing suggestions. Activities show actual actions and counts; unknown totals leave only completed counts visible.

Navigation retains running status after leaving Tasks. Returning restores recent activity and current stage. Completed tasks open their content or analysis reports. Failed and canceled states show completed scope, reason, and retry action. Activities use readable summaries; reports contain detailed evidence.

## Settings and common states

Model settings show one current connection, selected from general API and Codex subscription. Telegram shows connection, chat binding, and message receipt. Content sources show GitHub, X, and Xiaohongshu reader capability and configuration.

Project analysis settings show the current analysis goal and focus-card-writing guidance in separate text fields. Saving applies to later runs. Restore Defaults replaces both fields with the shipped text. The page shows field errors and whether edits remain unsaved.

Empty projects, empty cards, zero connections, empty reports, missing model configuration, source failures, and insufficient analysis input each show a distinct state and next action. Narrow windows preserve the reading axis and primary actions; activities and connections scroll within their sections.
