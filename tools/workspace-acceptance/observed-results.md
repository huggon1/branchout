# Observed acceptance — 2026-09-29

## Automated checks

The production service fixture passed all 12 assertions recorded in [service-results.json](service-results.json). TypeScript checking and the application build passed. Native icon generation passed. The fixtures cover deletion, optimistic concurrency, historical immutability, suggestion review, terminal-event handling, and public activity redaction.

## Electron walkthrough

The implementation was opened in a separate Electron application with an isolated fictional profile and keychain access disabled.

| Flow | Observed result | Evidence |
| --- | --- | --- |
| Content reading | Understanding precedes connections; complete, zero-connection, and partial-failure results have distinct states. | [Content](screenshots/content.png) |
| Source snapshot | A zero-connection item opens its source dialog; Escape returns focus to its trigger. | [Source dialog](screenshots/source-dialog.png) |
| Project to report | View Result opens the report inside Tasks. | [Projects](screenshots/projects.png), [Report](screenshots/task-report.png) |
| Suggestion review | An outdated suggestion requires review of the current card; confirmed acceptance survives renderer reload. | [Report](screenshots/task-report.png) |
| Run process | The initially collapsed disclosure renders a persisted assistant message with bold text and bullets in chronological order. | [Report](screenshots/task-report.png) |
| Focus cards | Editing creates a new version; deletion and Undo restore the row. The editor focuses its textarea and Escape returns focus to Edit. | [Cards](screenshots/focus-cards.png), [Editor](screenshots/focus-editor.png) |
| Compact window | Focus rows wrap; Content opens a reader with Return; Tasks stacks its index above the scrollable report. | [Focus](screenshots/compact-focus.png), [Reader](screenshots/compact-reader.png), [Task](screenshots/compact-task.png) |
| Empty search | A query with zero matches displays an empty state; clearing it restores the index. | Manual observation |

A conflicting legacy responsive rule found during the walkthrough was removed. The compact-task screenshot records the corrected layout.

## Remaining runtime coverage

Live model streaming, authenticated source retrieval, and real repository preflight require configured integration runs. The activity rendering evidence uses persisted fictional messages. Persistent deletion and restore across store reopen are verified by the service fixture; Undo is also verified through the UI. The final inline preflight failure message is covered by type checking and build validation.

## Approved design migration

The application now imports the same tokens, button variants, and disclosure component as the design preview. The folded-leaf SVGs use the approved yellow facet and neutral ink palette. Content, project, and task selections use neutral row surfaces.

The isolated Electron walkthrough verified pointer expansion and Space collapse of report coverage, initial editor focus, and Escape returning focus to Edit. Content evidence, project management, focus actions, and settings were inspected in the implemented renderer. The final compact task view retained independently scrollable index and report regions. The focused-card editor uses a smaller dialog and a neutral backdrop.

Type checking, application build, and native icon generation passed. This migration changes presentation and disclosure state; the existing fixture profile supplied persisted report and focus data. External authentication and live model execution retain the runtime coverage boundary above.

Updated screenshots: [content](screenshots/design-migration/content.png), [task report](screenshots/design-migration/report.png), [compact task](screenshots/design-migration/compact-task.png).
