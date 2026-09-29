# Workspace acceptance cases

Record before implementation. Exercise the production services and renderer with isolated fictional fixtures.

- Deleted cards could continue participating in new snapshots; verify exclusion and immutable historical versions.
- A stale delete or restore could overwrite a later edit; verify expected-version comparison within the store transaction.
- Suggestion acceptance could revive a deleted card; verify rejection and preserved report.
- Restart could lose deletion state; reopen the saved store and verify current visibility and history.
- Model text could bypass sanitization or include credentials, hidden reasoning, raw tool output, or executable HTML; display only public assistant text through a bounded redacted event and sanitized Markdown.
- Late events or retries could reorder activity or revive terminal tasks; preserve attempt markers, monotonic sequence and terminal-state checks.
- A completed analysis could navigate back to Projects; verify report and acceptance stay in Tasks, including historical projects.
- Filter changes, hidden pages and background activity could reset reading position or steal keyboard focus; preserve mounted page state and scroll containers.
- Dialogs could trap drafts, hide errors, or break Escape/focus return; exercise success, validation failure and cancellation.
- Partial source results could be presented as zero relations; keep completeness and unfinished-stage states distinct.
- Narrow layouts could clip controls or hide the return path; verify list/detail switching, dialog reachability and document width.

## Shared visual migration

- A migrated disclosure could expose collapsed controls to keyboard navigation; verify hidden panels and expanded state together.
- Legacy page styles could override shared buttons or restore tinted selections; inspect report, content, projects, cards, and settings in the rendered application.
- Button spacing could break when labels wrap in compact windows; verify action reachability and dialog footer alignment.
- Asset builds could retain the gray icon; regenerate both application PNG and native icon from the approved SVG.
