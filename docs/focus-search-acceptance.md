# Focus-search acceptance

## Automated application scenarios

The isolated Electron fixture uses fictional cards and local platform responses. The verification artifact saves renderer screenshots, Playwright traces, and persisted report state.

| Scenario | Expected result |
| --- | --- |
| Select two cards and two platforms | Four independent requests retain card text and requested period |
| Platform returns linked posts | Report preserves original reply and displays observed platform post links |
| Platform returns zero posts | Section completes with an explicit empty state |
| One section fails | Successful sections remain readable; retry processes the failed section |
| Add a candidate twice or in parallel | Both actions reference one forwarding task |
| Batch addition partly fails | Each candidate shows its own result; successful additions remain associated |
| Restart after addition | Saved reply, candidates, and parsing task references are restored |
| Open both platforms with an independent browser already running | Each platform uses its own ordinary Chrome profile; the independent browser remains available |
| A human login redirects to an authentication provider | The login page reaches the provider; task-page navigation remains confined to its platform |
| Disconnect browser control and reconnect, then restart the service | Platform sessions remain available, and persisted status contains cookie names and expiry metadata |
| Sign out of X | X becomes disconnected while the Xiaohongshu session remains available |
| Activate the application while saved model data is loading | The window opens with the restored model connection after services are ready |
| Restart during search | Unfinished sections become retryable and successful sections are retained |
| Cancel a running search | Agent and browser access stop; saved sections remain readable |
| The AI renders its answer in a plain div with paragraphs and citations | The observed reading container captures the complete original text and images |
| Agent captures a conversation container beginning with the submitted question | The tool requests a narrower answer container; the saved reply contains the answer itself |
| Agent selects a successful capture by its returned identity | The main process saves the exact captured text, including its original punctuation |
| A search candidate starts content reading | The browser reading prompt targets the supplied post directly |
| Xiaohongshu enhancement falls back with a queued recovery token | Browser navigation retains that token and the saved source uses its canonical URL |
| A new control appears ahead of an existing editor | The existing editor retains its observed reference |
| An editor overlaps another editor | Snapshot identifies which control receives pointer input |
| Platform renders a citation control as a div or span with a pointer cursor | Snapshot exposes the labelled control; opening it reveals observed post links |
| Source cards load after a disclosure opens | A requested bounded wait returns a fresh snapshot with the loaded links |
| A cited source opens a new browser tab | The tool observes its final platform URL and closes the task's temporary tab |
| Platform clears bulk-filled text while accepting keyboard input | One keyboard fallback retains the question before submission |
| Filling a textarea changes its value while body text stays unchanged | The next snapshot includes the current input value and enabled state |
| Agent uses a common capitalization for an allowed key | The browser normalizes the key and applies the same submission boundary |
| A password field appears in a snapshot | Its value remains excluded from Agent observations |
| A browser action fails without a platform restriction message | The result identifies a browser interaction failure |
| AI invents an unobserved or foreign-platform link | Candidate validation excludes the link and records the extraction issue |

## Live user acceptance

The user signs in through each platform's persistent browser profile. One real card runs on each platform; the user reviews intent match, usefulness, original response fidelity, and working post links. A chosen post proceeds through content parsing. Rebuild and application restart retain the platform session when the platform still accepts it. Expiry or verification exposes a login action. Live results are recorded separately from fictional E2E evidence.
