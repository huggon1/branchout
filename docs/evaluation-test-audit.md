# Current test coverage audit

This audit describes the `v0.4.0` source baseline at `af95bfe`. It records what existing checks actually observe and guides migration toward [evaluation scenarios](evaluation.md). The [test standard](evaluation-test-standard.md) defines acceptance labels and retirement gates. The baseline has 63 `test(...)` declarations across 15 files; a two-protocol loop registers 64 runtime cases. The credential migration implementation removes one obsolete storage declaration, yielding 63 expected runtime cases on that branch. Runtime outcomes require a separate run.

## Current gates

`npm test` registers 64 runtime cases across 15 files with Node's test runner. Most call source modules with synthetic inputs or injected dependencies. CI also typechecks, prepares bundled runtimes, packages the macOS app, verifies package contents and release shape, and invokes `verify:package-ui`. That packaged UI gate runs `check-model-ui.mjs` and `check-analysis-desktop.mjs`. The release workflow runs unit tests and package verification; its package checks cover structure and signing.

`check-model-ui.mjs` launches Electron with isolated data and a local HTTP model stub. It exercises generic API save/check/switch behavior; its Codex path stops when the login button renders. `check-analysis-desktop.mjs` creates a temporary Git repository and synthetic conversation, launches Electron, and calls several app IPC methods through Playwright's page context. Its local model stub returns a ready-made report for one batch. It verifies preflight, coverage fields, acceptance, and report rendering. `check-project-desktop.mjs` and `check-forwarding-desktop.mjs` exercise additional real desktop paths outside the packaged UI gate. `check-focus-ui.mjs` exercises many renderer states against a fixture preload.

## Test families and decisions

| Existing files or scripts | Current oracle | Migration decision | Scenario mapping |
| --- | --- | --- | --- |
| `projects.test.ts`, `project-analysis.test.ts` | Store identity, version history, conflict and idempotency assertions | Keep as fast persistence contracts; add packaged desktop paths for user actions and restart | EV-01, EV-09 |
| `models.test.ts`, `codex-environment.test.ts`, `worker-environment.test.ts` | Model state, protected storage, environment and redaction assertions with injected clients | Keep security and contract cases; add actual login and connection persistence to local acceptance | EV-02 |
| `project-analysis-readers.test.ts`, `repository-evidence-link.test.ts` | Parser bounds, attribution, source location and URL rules | Keep deterministic input-boundary checks; cross-check selected and read scope in E2E | EV-03, EV-04 |
| `project-analysis-worker.test.ts`, `project-analysis-pipeline-service.test.ts` | Injected reader/model results, prompt filtering, batch coverage, frozen inputs and service recovery | Keep independent input and persistence assertions; replace fixture-shaped quality claims with reviewer evidence and inject failures through the desktop runner | EV-04, EV-05, EV-07, EV-08 |
| `forwarding-jobs.test.ts`, `forwarding-service.test.ts` | Injected model/stage messages, card coverage and stage reuse | Keep stage and completeness contracts; exercise source-to-report path in packaged app | EV-10 |
| `telegram-integration.test.ts`, `x-platform.test.ts`, `xhs-platform.test.ts` | Parsing, normalization, authorization, queue persistence and source safety | Keep protocol and credential cases; add restart and duplicate delivery scenarios | EV-10, EV-11 |
| `runtime-layout.test.ts` | Packaged resource path construction | Keep as a fast package contract; observe launched worker in packaged E2E | EV-12 |
| `check-focus-ui.mjs` with `focus-ui-preload.cjs` | Visible renderer states over a simulated backend | Keep for visual interaction coverage while labeling it a renderer fixture; require packaged paths for workflow claims | EV-01, EV-03, EV-09, EV-10 |
| `check-model-ui.mjs`, `check-analysis-desktop.mjs` | Packaged Electron plus controllable model responses | Generalize to the portable runner; add multi-batch faults, real Codex local mode, and trace checks | EV-02 through EV-08 |
| `check-project-desktop.mjs`, `check-forwarding-desktop.mjs` | Electron actions with isolated app state | Integrate relevant flows into the runner and packaged gate | EV-01, EV-10, EV-12 |

## Highest-risk gaps

The current packaged gate covers generic API checks, a rendered Codex login action, and one synthetic project-analysis batch. The next gates need completed Codex subscription login, multi-batch transient-error and process-restart continuation, persisted Pi session and HTML trace comparison, prompt-revision provenance, and independent focus-suggestion review. The analysis desktop stub writes the expected suggestion itself, so that assertion establishes wiring and validation. The runner should retain that deterministic check for plumbing and use a separately recorded human rubric for suggestion quality.

Migration removes tests only after their independent failure mode is covered by a stronger check. The scenario catalog provides the oracle before new implementation or test code is written. CI can require fixture-mode structural gates; a local private run supplies real-model and semantic evidence for release review.

## Case-by-case migration map

Numbers below identify source order within each file. `Keep` marks an independent deterministic boundary. `Replace` retains the case through the named gate, then moves its product claim to packaged E2E. `Delete` identifies an obsolete oracle; the gate still covers the original risk. Counts include both protocol registrations in `models.test.ts`.

| File / case | Failure risk currently asserted | Action and stronger evidence |
| --- | --- | --- |
| `codex-environment` 1 | Older Codex binary masks a newer client catalog | Keep contract; EV-02 exercises installed discovery. |
| `codex-environment` 2 | Isolated auth process inherits unsafe config or loses OS home | Keep environment contract; EV-02 exercises login. |
| `codex-environment` 3 | macOS default keychain discovery fails in isolated environment | Keep platform contract; EV-02 verifies actual client use. |
| `forwarding-jobs` 1 | Zero cards yield incomplete coverage | Keep completeness boundary; EV-10 verifies visible report. |
| `forwarding-jobs` 2 | Batching skips a frozen card or cites unsupported text | Replace after EV-10 multi-card packaged run; stubbed relation wording is only wiring evidence. |
| `forwarding-jobs` 3 | Bad citation destroys earlier stages | Keep validation boundary; EV-10 verifies recovery. |
| `forwarding-jobs` 4 | Oversized card silently disappears | Keep bounded-input boundary; EV-10 verifies visible failure. |
| `forwarding-jobs` 5 | Resume reruns saved stages or skips remaining cards | Replace after EV-10 restart and model-call evidence. |
| `forwarding-service` 1 | Partial relation report completes or retry reruns saved stages | Replace after EV-10 packaged interrupted run. |
| `forwarding-service` 2 | Sink retry duplicates Telegram task | Keep idempotency contract; EV-11 exercises replay. |
| `models` 1 | Pi model catalog is confused with account availability | Keep catalog distinction; EV-02 verifies selectable account models. |
| `models` 2 | Connection switch leaks key or changes active task lease | Keep state/redaction contract; EV-02 checks UI and frozen task. |
| `models` 3 | Encrypted storage refuses a cleartext key | Delete obsolete oracle after EV-13 migration/restart gate; current owner-only JSON policy supersedes it. |
| `models` 4 | Failed catalog refresh changes selected model | Keep catalog-failure contract; EV-02 checks user state. |
| `models` 5 | Saved Codex connection retains a stale catalog after restart | Replace after EV-02 packaged restart with CLI fixture. |
| `models` 6 | Account catalog omits valid new model or invents absent model | Keep catalog filtering contract; EV-02 checks visible selection. |
| `models` 7 | Switching account logs out active leased credentials | Keep lease boundary; EV-02 exercises task switch. |
| `models` 8 | Late login completion overrides cancellation or leaks errors | Keep async race/redaction boundary; EV-02 exercises cancellation. |
| `models` 9 | Late connection check overrides cancellation or leaks error | Keep async race/redaction boundary; EV-02 checks UI. |
| `models` 10 | Endpoint URL embeds credentials or unsupported protocol | Keep security input boundary; EV-02 checks visible rejection. |
| `models` 11a | Responses Pi adapter shares sessions or exposes provider failure | Keep protocol contract; EV-04/EV-06 inspect executed sessions. |
| `models` 11b | Chat Completions Pi adapter shares sessions or exposes failure | Keep protocol contract; EV-04/EV-06 inspect executed sessions. |
| `models` 12 | Codex Pi provider decodes an opaque token incorrectly | Keep provider boundary; EV-02 verifies actual login. |
| `models` 13 | Failed connection save erases prior account | Keep atomic-save contract; EV-02/EV-13 check restart state. |
| `models` 14 | Abandoned login cleanup revokes saved account | Keep cleanup boundary; EV-02 checks restart. |
| `models` 15 | Old check marks replacement connection verified | Keep stale-result boundary; EV-02 checks visible status. |
| `models` 16 | Model check exposes raw provider error | Keep redaction boundary; EV-02 checks failure display. |
| `project-analysis-pipeline-service` 1 | Report completion precedes durable report or scope selection | Replace after EV-03/EV-04 packaged run. |
| `project-analysis-pipeline-service` 2 | Suggestion cites a focus version outside frozen input | Keep frozen-version boundary; EV-08 reviews provenance. |
| `project-analysis-pipeline-service` 3 | Retry changes frozen versions or cancellation keeps model lease | Keep lease/snapshot contract; EV-05 verifies restart. |
| `project-analysis-pipeline-service` 4 | Frozen retry input disappears across restart | Replace after EV-05 packaged multi-batch restart. |
| `project-analysis-pipeline-service` 5 | Shutdown loses task or fails to mark retryable | Replace after EV-05 packaged process interruption. |
| `project-analysis-readers` 1 | Codex event parser imports tool turns as user intent | Keep parser boundary; EV-03 checks selection counts. |
| `project-analysis-readers` 2 | Response-only or command-only sessions vanish | Keep format boundary; EV-03 checks inclusion. |
| `project-analysis-readers` 3 | Attachment stripping removes the user request | Keep text boundary; EV-03 checks preview. |
| `project-analysis-readers` 4 | Long-session truncation drops early or recent user intent | Keep budget boundary; EV-03 checks coverage. |
| `project-analysis-readers` 5 | Same-remote clone is silently treated as verified repository | Keep attribution boundary; EV-03 checks review status. |
| `project-analysis-readers` 6 | Huge tool output exhausts reader; user message silently disappears | Keep streaming/bounds boundary; EV-03 checks coverage. |
| `project-analysis-readers` 7 | Repository reader exceeds bounds or misstates commit range | Keep input boundary; EV-03 checks preview range. |
| `project-analysis-worker` 1 | Prompt includes reasoning/tool data or accepts untraceable card | Keep disclosure/validation boundary; EV-08 determines card quality. |
| `project-analysis-worker` 2 | Budget displaces user/final messages with repository excerpts | Keep priority boundary; EV-03/EV-04 check coverage. |
| `project-analysis-worker` 3 | Repository-only evidence produces an invented user-grounded card | Replace after EV-08 human review of repo-only input. |
| `project-analysis-worker` 4 | One prompt cap drops selected sessions | Replace after EV-04 multi-batch coverage run. |
| `project-analysis` 1 | Stale suggestion overwrites a newer focus version | Keep atomic conflict contract; EV-09 checks UI history. |
| `projects` 1 | Rebind changes project identity or history | Keep store boundary; EV-01 checks restart UI. |
| `projects` 2 | Concurrent edit overwrites newer focus version | Keep version conflict boundary; EV-09 checks UI. |
| `projects` 3 | Retried task creation duplicates task ID | Keep idempotency boundary; EV-04 checks task list. |
| `projects` 4 | Malformed store data overwrites original | Keep data-integrity boundary; EV-01 checks recoverable state. |
| `repository-evidence-link` 1 | Valid scoped GitHub links are discarded | Keep URL contract; EV-03 checks evidence links. |
| `repository-evidence-link` 2 | Credentialed or path-escape URL enters evidence | Keep URL security boundary; EV-03 checks visible links. |
| `runtime-layout` 1 | Packaged worker path points outside bundle | Replace after EV-12 launched worker gate. |
| `runtime-layout` 2 | Development worker path points outside checkout | Keep development path contract; product acceptance uses EV-12. |
| `telegram-integration` 1 | Parser queues multiple or unsupported links | Keep parser boundary; EV-11 checks submitted link. |
| `telegram-integration` 2 | Duplicate update or restart duplicates task/loses ack | Replace after EV-11 packaged replay and restart. |
| `telegram-integration` 3 | Bot or temporary source token enters plain persistence | Keep credential boundary; EV-11 checks local artifacts. |
| `telegram-integration` 4 | XHS share token leaks from queue or dispatch | Keep transient-token boundary; EV-11 checks artifacts. |
| `worker-environment` 1 | Worker inherits unrelated secrets while proxy settings are needed | Keep environment boundary; EV-12 checks launched worker. |
| `x-platform` 1 | X URL parser accepts wrong host/path | Keep source boundary; EV-10 checks accepted link. |
| `x-platform` 2 | X normalization loses text/photos/source identity | Keep format boundary; EV-10 checks report evidence. |
| `x-platform` 3 | Anonymous X read claims success | Keep coverage boundary; EV-10 checks uncovered state. |
| `xhs-platform` 1 | XHS URL accepts wrong path or persists access parameter | Keep source/privacy boundary; EV-10 checks saved source. |
| `xhs-platform` 2 | XHS normalization loses order or accepts untrusted image | Keep content boundary; EV-10 checks report evidence. |
| `xhs-platform` 3 | Temporary share token persists with normalized result | Keep transient-token boundary; EV-10 checks artifacts. |
| `xhs-platform` 4 | Anonymous XHS read claims success | Keep coverage boundary; EV-10 checks uncovered state. |
