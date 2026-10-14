# Application verification

[Product specification](../docs/product-spec.md) owns expected behavior. [Development](../docs/development.md) owns local launch and live-source preparation. Run artifacts record observed pass or failure.

## E2E scope

Fixtures use isolated profiles and controlled external responses.

| Test                                                   | Scope                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [application updates](e2e/application-updates.spec.ts) | Version visibility, download cancellation, installation errors, shared queue hold, and queued search restart |
| [application](e2e/application.spec.ts)                 | Startup, saved language, profile copy, and Telegram preparation                                              |
| [search workspace](e2e/search-workspace.spec.ts)       | Search, follows, partial results, candidate parsing, and task views                                          |
| [reading](e2e/reading.spec.ts)                         | Materials, frozen language, partial output, and restart                                                      |
| [reading fidelity](e2e/reading-fidelity.spec.ts)       | Code and link preservation                                                                                   |
| [reading recovery](e2e/reading-recovery.spec.ts)       | Transport recovery, failed-task preservation, cancellation, and native logs                                  |
| [material collection](e2e/material-collection.spec.ts) | References, frame recovery after a transient click failure, provenance, and source structure                 |
| [browser Agent](e2e/browser-agent.spec.ts)             | Capture identity, reply capture after a failed Ask click, observed access requirements, 404 admission after a failed source navigation, and recovery budgets                                         |
| [browser tools](e2e/platform-browser.spec.ts)          | Constrained actions, observed links, visibility changes, and retained sessions                               |
| [worker network](e2e/worker-network.spec.ts)           | GUI system proxy, explicit proxy precedence, and loopback routing                                            |
| [platform sessions](e2e/platform-session.spec.ts)      | Shared sessions, logout, and restart                                                                         |
| [Codex token](e2e/codex-token.spec.ts)                 | Credential refresh, catalog, and redacted state                                                              |

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

The [Checks workflow](../.github/workflows/checks.yml) runs shared checks on Linux and complete verification on macOS. [Release](../.github/workflows/release.yml) owns packaging and signing.

## Signed update acceptance

[Failure cases](update-failures.md) define the update acceptance boundary. The controlled Electron fixture replaces update transport and native staging while retaining production UI, IPC, queue admission, and stores. The [signed upgrade verifier](../scripts/development/verify-upgrade.mjs) separately proves native replacement, restart, compatible project signatures, and retained data with two real packages. Manual Release workflow runs upload its evidence. The [release guide](../docs/releasing.md#signing-and-assets) owns signing and artifact setup.

## Packaged startup acceptance

The release package smoke check covers these failure cases:

- Missing ASAR resources, worker entries, icon, update configuration, or bundled Xiaohongshu reader stops verification before upload.
- A package version or source revision that differs from the workflow checkout fails the build identity check.
- Startup, preload, renderer, or page navigation failures produce a failed result and an available screenshot.
- A disabled packaged updater or an incorrect default browser mode fails the Settings check.
- A language change lost after restart fails the profile persistence check.

The check launches the packaged executable twice with a fresh local profile and saves screenshots and a JSON result. Signing and native upgrade have their own checks. Live platform retrieval and the downloaded DMG's first-open approval belong to [release acceptance](../docs/releasing.md#acceptance-and-publication).
