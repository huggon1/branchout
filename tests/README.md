# Application verification

This guide maps implemented checks to product behavior, source modules, and repeatable evidence. The [product specification](../docs/product-spec.md) defines behavior; the [development guide](../docs/development.md#refine-project-analysis-output) describes real-model feedback runs. Test execution results belong to each run's artifacts.

## Application scenarios

[application.spec.ts](e2e/application.spec.ts) currently defines nine Electron E2E scenarios. Each row links to the scenario's entry point; its assertions cover the outcomes listed here.

| Scenario and assertions | Related implementation | Saved evidence |
| --- | --- | --- |
| [Startup activation](e2e/application.spec.ts#L300): restore the saved model connection before exposing Settings during an activation event | [Application lifecycle](../src/main/main.ts), [model connection](../src/main/services/model-service.ts) | Saved model state and rendered Settings assertions |
| [Cards and bilingual switching](e2e/application.spec.ts#L352): create and edit a card, preserve an unsaved settings value across language changes, retain the selected language and two card versions after restart | [Card editor](../src/renderer/components/FocusCardsPage.tsx), [card service](../src/main/services/focus-cards/focus-card-service.ts), [language contract](../src/shared/language.ts) | `persisted-card.png`, `state` attachment |
| [Forwarding and material retry](e2e/application.spec.ts#L423): save the source and failed material, reuse it on retry, and generate reading introductions in the task's original language | [Forwarding job](../src/worker/jobs/forwarding/run.ts), [reading workflow](../src/worker/jobs/forwarding/reading.ts), [reading prompts](../src/worker/jobs/forwarding/reading-prompts.ts) | `forwarding.png`, `forwarding-state` attachment, request counts |
| [Analysis and suggestion acceptance](e2e/application.spec.ts#L504): render three Markdown sections, freeze supplemental guidance, keep analysis activities empty, export the latest session directly, require review after a card changes, and accept a repeated request once | [Analysis pipeline](../src/main/services/project-analysis/pipeline-service.ts), [report reader](../src/renderer/components/AnalysisReportView.tsx), [trace export](../src/main/services/project-analysis/trace-export.ts) | `markdown-report.png`, `compact-report.png`, `accepted.png`, `accepted-state` and `direct-session-export` attachments |
| [Independent copied profile](e2e/application.spec.ts#L644): reject copying an active profile, copy saved cards after closure, keep credentials in the source by default, and retain copied card versions while the source changes | [Profile preparation](../src/main/runtime/profile.ts) | `copied-profile.png`, persisted profile assertions |
| [Review with copied Telegram credentials](e2e/application.spec.ts#L699): show the copied credential as configured and report a disconnected receiver in review mode | [Profile preparation](../src/main/runtime/profile.ts), [service initialization](../src/main/services.ts) | `telegram-review-paused.png`, `telegram-review-status` attachment |
| [Invalid analysis evidence](e2e/application.spec.ts#L748): return a quotation absent from the fixture repository, reach a failed task state, and retain an empty analysis-report collection | [Analysis job](../src/worker/jobs/project-analysis/index.ts), [output validation](../src/worker/reasoning/project-analysis-agent.ts) | `unverifiable.png`, `unverifiable-state` attachment |
| [Search retry and submission](e2e/application.spec.ts#L787): retain successful platform replies, retry the failed section, and add a candidate once across restart | [Search service](../src/main/services/focus-search/service.ts), [report reader](../src/renderer/components/FocusSearchReportView.tsx) | Search report, post action screenshots and persisted associations |
| [Search cancellation](e2e/application.spec.ts#L922): retain a retryable search report after cancellation and complete it after restart | [Search service](../src/main/services/focus-search/service.ts) | Persisted report and task assertions |

## Isolated rules

The six files below currently define eleven rule-test cases, including the three generated rejection cases in the analysis-output suite. These checks exercise local contracts and failure boundaries.

| Test source | Assertions | Related implementation |
| --- | --- | --- |
| [analysis-output.test.ts](rules/analysis-output.test.ts) | Preserve a Markdown body longer than the former summary limit; reject invented quotes, paths outside the repository, unknown update targets, and dangling numbered references | [Project-analysis validator](../src/worker/reasoning/project-analysis-agent.ts) |
| [document-links.test.ts](rules/document-links.test.ts) | Classify encoded paths, duplicate heading anchors, missing files and anchors, external links, and symlinks outside the repository; treat fenced Markdown as example text | [Local document-link inspector](../src/readers/document-links/index.ts) |
| [output-diagnostic.test.ts](rules/output-diagnostic.test.ts) | Identify a quote's field and length limit; replace unknown output keys and raw error text with a fixed diagnostic | [Correction diagnostic](../src/worker/reasoning/output-validation-diagnostic.ts) |
| [prompt.test.ts](rules/prompt.test.ts) | Change execution revision when instructions change; retain stable revision, model identity, and output language for identical inputs | [Execution identity](../src/worker/prompt-execution.ts) |
| [foundation.test.ts](rules/foundation.test.ts) | Reject active source profiles, existing destinations, and malformed records; keep credentials in the source during a default copy; separate source text from English instructions and the requested output language | [Profile preparation](../src/main/runtime/profile.ts), [understanding input](../src/worker/understanding/platform-content.ts), [analysis instructions](../src/worker/jobs/project-analysis/prompts.ts) |
| [docs.test.mjs](rules/docs.test.mjs) | Recognize valid document references and detect missing paths, heading anchors, and npm commands | [Documentation checker](../scripts/checks/docs.mjs) |

## Controlled inputs and verification boundaries

The [E2E setup and cleanup](e2e/application.spec.ts#L28) create a temporary profile, fictional Git repository, and local HTTP fixture server. Electron, renderer, preload, IPC, services, job orchestration, validation, and storage run through the application. The following adapters define the controlled boundary.

| Component | Automated execution | Additional verification |
| --- | --- | --- |
| [Forwarding adapter](support/forwarding.ts) | Calls the production forwarding job with controlled material collection, translation and summary responses; historical inputs retain their adapter | Actual platform retrieval, account sessions, and model judgments use platform trials |
| [Analysis adapter](support/analysis.ts) | Calls the production analysis job with a fixture session result and a real fixture README | Pi tool exploration, provider retries, correction turns, and editorial quality use real-model trials |
| [Direct-export assertions](e2e/application.spec.ts#L550) | Seed HTML files, select a directory through a substituted dialog, and capture the shell-open path | Native directory selection and browser rendering use desktop acceptance |
| [Prompt rules](rules/prompt.test.ts) and [output rules](rules/analysis-output.test.ts) | Verify execution identity, output shape, and exact source quotations | Report usefulness and focus-card wording use the [saved-report feedback workflow](../docs/development.md#refine-project-analysis-output) |

Coverage here describes exercised behaviors and assertions. Line, branch, and function coverage percentages require a separate instrumentation report; the current [test commands](../package.json) produce rule results and application evidence.

## Commands and execution wiring

The [npm scripts](../package.json) are the command authority. The [Playwright configuration](../playwright.config.ts) selects application scenarios and evidence settings; the [test-worker builder](build-workers.mjs) bundles both controlled adapters using the application's build identity.

| Command | Execution path | Result |
| --- | --- | --- |
| `npm run check` | TypeScript → [documentation checker](../scripts/checks/docs.mjs) → rule suites above | Diagnostics and per-rule results |
| `npm run test:rules` | Node test runner → `rules/*.test.ts` and `rules/*.test.mjs` | Per-case pass/fail results |
| `npm run docs:check` | [Documentation checker](../scripts/checks/docs.mjs) → maintained Markdown references and npm scripts | Broken-reference and command diagnostics |
| `npm run test:e2e` | Application build → [test-worker build](build-workers.mjs) → [Playwright](../playwright.config.ts) | Scenario results, screenshots, attachments, and failure traces |
| `npm run check:full` | Shared checks → application E2E | Combined engineering checks and application evidence |

## Evidence and CI

[Platform-session E2E](e2e/platform-session.spec.ts) exercises installed Chrome with temporary application profiles and a local authentication fixture. It verifies ordinary startup, manual authentication navigation, HTTPS task navigation and shared site sessions, reconnect and restart persistence, isolated logout, and preservation of another browser. Its JSON attachment and screenshot record fictional session evidence. Real platform login and Grok availability use the separate live acceptance workflow.

| Evidence | Producer and interpretation |
| --- | --- |
| `test-results/` | [Playwright configuration](../playwright.config.ts) stores scenario output, failure screenshots, and retained failure traces; scenario code saves the named artifacts listed above |
| `playwright-report/` | The configured HTML reporter presents scenario results and attachments |
| `run-metadata` attachment | [E2E cleanup](e2e/application.spec.ts#L159) records build identity, controlled execution boundaries, and fixture request paths for every scenario |
| CI failure artifact | [Checks workflow](../.github/workflows/checks.yml) uploads `test-results/` and `playwright-report/` after an application-job failure, with seven-day retention |

The [Checks workflow](../.github/workflows/checks.yml) runs on pull requests and pushes to `main`: Linux executes `check`; macOS executes `check:full`. Both jobs install locked dependencies. Job timeouts and concurrency cancellation bound each run. Repository branch settings select required checks. The [release workflow](../.github/workflows/release.yml) owns packaging and release signing.

[Reading E2E](e2e/reading.spec.ts) verifies a main material, an explicit article, an inaccessible attachment, partial model output, frozen language labels, one target-language body, same-language presentation, retry, restart, unreadable-main recovery, per-material scroll positions, cached images, Mermaid labels, and canonical note identities with separated recovery tokens. Its state and request attachments show completed chunks retained across retry. Screenshots record partial, compact, and same-language reading. Controlled HTTP responses mark the external collection and model boundary; live examples provide source and output quality evidence separately.

[Material collection E2E](e2e/material-collection.spec.ts) runs the production browser Agent and Chrome against controlled web pages and model responses. It verifies direct-reference collection, a readable cross-site frame, reference provenance, image position, linked images, code and table structure, common system instructions, and depth-one navigation. Its JSON attachment retains the saved material bytes and collection progress.

[Subscription credential E2E](e2e/codex-token.spec.ts) runs Electron with a fixture app-server that reports the account method while storing its access token in the isolated authentication file. It verifies refresh before credential use and redacted task storage. The fixture owns the account boundary; live reading verifies the configured account separately.

[Translation fidelity E2E](e2e/reading-fidelity.spec.ts) runs the production translator against a model fixture that changes command text and a link destination. It verifies command and identifier restoration, link repair, and provider-default output capacity for a custom model. Its saved material attachment records the corrected output.
