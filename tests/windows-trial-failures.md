# Windows installation trial acceptance

The Windows x64 trial uses an unsigned per-user NSIS installer. Its package and installation checks run on a native Windows runner with independent profiles. Each check saves JSON results and screenshots under `.tmp/`. Live account acceptance records the observed platform and model results separately.

| Trigger                                                           | Required result                                                                                                                                                       |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build on Windows x64                                              | The installer contains the application, task workers, icon, Windows Xiaohongshu reader, and its license. The manifest records the source revision and SHA-256 hashes. |
| Install into a directory containing spaces and Chinese characters | Installation completes for the current user and the installed executable opens the workspace.                                                                         |
| Open the unsigned trial                                           | Application updates have the disabled state and their section stays hidden.                                                                                           |
| Change language and save a follow, then restart                   | The saved language and follow remain readable.                                                                                                                        |
| Minimize the window                                               | The process and admitted work remain active.                                                                                                                          |
| Close the final Windows window                                    | The ordinary shutdown path saves state, stops services, and exits the process. The profile owner marker is removed.                                                   |
| Reinstall over an existing trial                                  | The installed application opens the same saved records.                                                                                                               |
| Uninstall the trial                                               | Installed program files are removed and the independent profile retains its records.                                                                                  |
| Launch Chrome with a saved session                                | The verified browser profile retains its cookies and closes through the existing cleanup path.                                                                        |
| A Windows reader briefly holds the task-state file                | State replacement retries for up to two seconds, then commits after the reader releases its handle. A lasting replacement failure preserves the committed file.       |
| Run search, parsing, model authentication, or bot fixtures        | The Windows application completes the existing E2E expectations and saves run evidence.                                                                               |

The CI evidence covers controlled external responses. A live trial covers real model authentication, X and Xiaohongshu login, platform search, source parsing, bot delivery, and retrieval coverage. Formal signing, application updates, and public Release publication have separate delivery scopes.

## Interface review

This change reuses existing page content and controls. The unsigned Windows trial omits the unavailable application-update section. Existing update copy and translations remain scoped to the enabled macOS updater and its fixture.
