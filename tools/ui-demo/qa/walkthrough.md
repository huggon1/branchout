# Browser verification

Verified on 2026-09-29 in the Codex in-app Chromium browser, using the locally served prototype and fictional fixtures.

| Interaction                           | Observed result                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| Expand evidence, open context, return | Citation appears; original-source dialog opens; returning retains the report                 |
| Search unmatched text, clear filters  | Empty state appears; clearing restores five content fixtures                                 |
| Open the city-sound item              | The reading view explicitly shows zero focus connections                                     |
| Start project analysis                | Conversation selection opens; launch navigates to the running task                           |
| Simulated task completion             | The same task detail presents the analysis report after the simulated run                    |
| Expand activity                       | Ordered model-message samples and grouped file details are readable                          |
| Accept update                         | Suggestion shows accepted state; the focus card contains updated text and version            |
| Pause focus card                      | Switch and participation copy change together                                                |
| Delete and undo                       | Card leaves the list, then returns through Undo                                              |
| Create, reload, edit                  | Created card survives reload; edited text appears after saving                               |
| Submit empty content URL              | Inline error identifies supported HTTPS links                                                |
| Retry failed task, stop, restart      | Running, stopped, and restarted states appear with their corresponding actions               |
| Narrow layout at 680 CSS pixels       | List and reader alternate; Return to list is reachable; document width equals viewport width |
| Browser log inspection                | Captured warning/error list was empty                                                        |

Keyboard activation was used for the interaction walkthrough. Native dialogs supply focus containment and Escape dismissal. The in-app browser's viewport-override screenshot scaling was inconsistent, so the narrow-width result is recorded from rendered DOM geometry and visible navigation state. Desktop screenshots provide visual review artifacts.

## Artifacts

- `content-reading.png`: default content reading surface.
- `projects.png`: project management and analysis entry.
- `analysis-setup.png`: conversation-selection dialog.
- `task-report.png`: completed task report with suggestions.
- `focus-cards.png`: cross-project focus-card management.

Repeat the steps in the parent README to inspect the interactions. Settings → Reset restores initial focus cards. Browser reload restores initial tasks. Production integrations and performance benchmarking remain outside this prototype verification.
