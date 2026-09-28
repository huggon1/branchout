# Current test coverage audit

This audit describes the `v0.4.0` source baseline at `af95bfe`. It records what existing checks actually observe and guides migration toward [evaluation scenarios](evaluation.md). Counts refer to declared top-level Node tests found in source; runtime outcomes require a separate run.

## Current gates

`npm test` runs 62 declared tests across 15 files with Node's test runner. Most call source modules with synthetic inputs or injected dependencies. CI also typechecks, prepares bundled runtimes, packages the macOS app, verifies package contents and release shape, and invokes `verify:package-ui`. That packaged UI gate runs `check-model-ui.mjs` and `check-analysis-desktop.mjs`. The release workflow runs unit tests and package verification; its package checks cover structure and signing.

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
