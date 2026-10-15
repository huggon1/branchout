# Application verification

[Product specification](../docs/product-spec.md) owns expected behavior. [Development](../docs/development.md) owns local launch and live-source preparation. Run artifacts record observed pass or failure.

## E2E scope

Fixtures use isolated profiles and controlled external responses.

| Test                                                      | Scope                                                                                                                                                                                                                                                |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [application updates](e2e/application-updates.spec.ts)    | Version visibility, download cancellation, installation errors, shared queue hold, and queued search restart                                                                                                                                         |
| [application](e2e/application.spec.ts)                    | Startup, saved language, profile copy, and Telegram preparation                                                                                                                                                                                      |
| [Windows lifecycle](e2e/windows-lifecycle.spec.ts)        | Minimize, final-window shutdown, retained language and follow, independent Unicode profile, and omitted trial updates                                                                                                                                |
| [search workspace](e2e/search-workspace.spec.ts)          | Search, follows, partial results, candidate parsing, and task views                                                                                                                                                                                  |
| [Feishu bots](e2e/feishu-bot.spec.ts)                     | Setup, registration cancellation, concurrent receipt deduplication, SDK reconnection, history pagination, submission replay, authorization revocation, pending acknowledgement recovery, account isolation, paused review startup, and drawer layout |
| [Telegram setup](e2e/telegram-setup.spec.ts)              | Collapsed settings, verification recovery, chat authorization, restart, and drawer layout                                                                                                                                                            |
| [task panel](e2e/task-panel.spec.ts)                      | Global task visibility, terminal clearing, Undo, keyboard focus, and narrow layout                                                                                                                                                                   |
| [record deletion](e2e/record-deletion.spec.ts)            | Independent visibility, timed undo, candidate re-addition, and restart                                                                                                                                                                               |
| [reading](e2e/reading.spec.ts)                            | Materials, frozen language, partial output, and restart                                                                                                                                                                                              |
| [reading fidelity](e2e/reading-fidelity.spec.ts)          | Code and link preservation                                                                                                                                                                                                                           |
| [reading recovery](e2e/reading-recovery.spec.ts)          | Transport recovery, failed-task preservation, cancellation, and native logs                                                                                                                                                                          |
| [material collection](e2e/material-collection.spec.ts)    | References, frame recovery after a transient click failure, provenance, and source structure                                                                                                                                                         |
| [browser Agent](e2e/browser-agent.spec.ts)                | Capture identity, reply capture after a failed Ask click, observed access requirements, 404 admission after a failed source navigation, and recovery budgets                                                                                         |
| [browser tools](e2e/platform-browser.spec.ts)             | Constrained actions, observed links, visibility changes, and retained sessions                                                                                                                                                                       |
| [model network](e2e/worker-network.spec.ts)               | Main and worker GUI manual system proxy on macOS and Windows, explicit proxy precedence, and loopback routing                                                                                                                                        |
| [platform sessions](e2e/platform-session.spec.ts)         | Shared sessions, logout, and restart                                                                                                                                                                                                                 |
| [Native Pi connections](e2e/pi-model-connections.spec.ts) | Native catalog/auth UI, option propagation, frozen leases, restart, and native Codex authentication                                                                                                                                                  |

## Service and contract scope

`tests/rules/` covers search/follow admission, reset integrity, profiles, and prompt identity. The reading fixture can invoke internal recovery directly. That scope establishes saved-state behavior independently of available UI actions.

## Commands and evidence

| Command              | Result                                    |
| -------------------- | ----------------------------------------- |
| `npm run check`      | Types, document references, and rules     |
| `npm run docs:check` | Markdown paths, anchors, and npm commands |
| `npm run test:rules` | Rule/service checks                       |
| `npm run test:e2e`   | App and fixture builds, then Playwright   |
| `npm run check:full` | Shared checks and application E2E         |

[Playwright configuration](../playwright.config.ts) owns evidence settings. Screenshots, attachments, and retained failure traces enter `test-results/`; the report enters `playwright-report/`. Tests record fixture and build scope. Live trials establish actual platform login, current page behavior, retrieval quality, and usefulness. Desktop acceptance checks the real export chooser and exported pages.

The [Checks workflow](../.github/workflows/checks.yml) runs shared checks on Linux and complete verification on macOS and Windows. Its Windows job also builds and verifies the unsigned installation trial. [Release](../.github/workflows/release.yml) owns macOS packaging and signing.

## Signed update acceptance

[Failure cases](update-failures.md) define the update acceptance boundary. The controlled Electron fixture replaces update transport and native staging while retaining production UI, IPC, queue admission, and stores. The [signed upgrade verifier](../scripts/development/verify-upgrade.mjs) separately proves native replacement, restart, compatible project signatures, and retained data with two real packages. Manual Release workflow runs upload its evidence. The [release guide](../docs/releasing.md#signing-and-assets) owns signing and artifact setup.

Release runs also verify the latest published package against the current production package when their versions differ. `--released-baseline <version>` selects these intact signed ZIPs, validates their hashes, and requires a fresh GitHub-hosted macOS runner. Evidence enters `.tmp/released-upgrade/evidence/` and the `released-upgrade-evidence` workflow artifact. Tag runs create the draft after this verification passes.

## Packaged startup acceptance

The release package smoke check covers these failure cases:

- Missing ASAR resources, worker entries, icon, update configuration, or bundled Xiaohongshu reader stops verification before upload.
- A package version or source revision that differs from the workflow checkout fails the build identity check.
- Startup, preload, renderer, or page navigation failures produce a failed result and an available screenshot.
- A disabled macOS packaged updater or an incorrect default browser mode fails the Settings check. The Windows trial check confirms the disabled update state and omitted update section.
- A language change lost after restart fails the profile persistence check.

The check launches the packaged executable twice with an independent local profile and saves screenshots and a JSON result. The Windows [installation trial](windows-trial-failures.md) additionally installs, reinstalls, and uninstalls the NSIS package, retaining its test records. Signing and native upgrade have their own checks. Live platform retrieval and the downloaded DMG's first-open approval belong to [release acceptance](../docs/releasing.md#acceptance-and-publication).
