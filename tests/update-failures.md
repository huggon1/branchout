# Application update acceptance

Write these cases before implementation. Controlled Electron runs cover UI, IPC, and queue admission. A separately signed package pair covers native installation.

| Failure or race                                                             | Required result                                                                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Startup check fails or release is unavailable                               | Application remains usable; Settings offers another check                                                                |
| Available update is dismissed                                               | Sidebar keeps the update entry; download starts on user action                                                           |
| Check or download is clicked twice                                          | One operation owns the state                                                                                             |
| Download fails or is cancelled                                              | Retry is available; cancellation preserves application tasks                                                             |
| Release notes contain HTML                                                  | Renderer sanitizes Markdown                                                                                              |
| Installation is requested while search or parsing runs                      | Confirmation offers installation after current tasks                                                                     |
| Waiting is confirmed while tasks finish                                     | Admission pauses before checking active task count                                                                       |
| New search, follow, or forwarding job arrives during waiting                | Job stays queued and resumes after cancellation or restart                                                               |
| Waiting is cancelled                                                        | Both execution queues resume                                                                                             |
| Native signature validation fails                                           | Queues resume; application stays open; installation error is shown                                                       |
| App quits with an update downloaded                                         | Normal quit preserves the explicit installation choice                                                                   |
| Old and new packages use different signing identities                       | Native installation fails with saved data retained                                                                       |
| Signed upgrade succeeds                                                     | New version opens with the same profile and queued work                                                                  |
| Source build checks for updates                                             | UI shows installed-build availability                                                                                    |
| Packaging finds files from another version                                  | Packaging starts with a clean output directory                                                                           |
| Reused verification packages have different production inputs               | Source validation asks for a fresh package pair                                                                          |
| Released-baseline verification starts outside a fresh hosted runner         | Verification stops before creating an application profile                                                                |
| Released package hashes or signing requirements differ from expected inputs | Verification stops before launching either application                                                                   |
| Published baseline upgrades to the candidate package                        | Native replacement restarts the candidate and retains saved reports, settings, model credentials, and the session marker |

Retain screenshots, operation records, and signed-upgrade results with the test run. Release publication remains a separate acceptance step.

Published-baseline verification also fails when replacement finishes but startup leaves the update receipt pending, or when API migration changes the saved endpoint, model, or key. A passing result requires the restarted process to stay alive after consuming the receipt and the migrated connection to retain those values.
