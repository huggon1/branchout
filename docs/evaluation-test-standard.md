# Evaluation test standard

This standard governs product acceptance and the migration of the `v0.4.0` test suite. The [scenario catalog](evaluation.md) defines product outcomes. The [case inventory](evaluation-test-audit.md) assigns each existing test a migration action.

## Admission criteria

Each new scenario records these fields before implementation:

1. **Failure mode:** a specific user-visible or durable-state defect that the scenario can expose.
2. **Portable input:** a fictional repository and conversation for CI, or operator-selected local inputs. The invocation supplies the target; the script contains no personal target path.
3. **Independent oracle:** a visible app result and a persisted-state or external-call observation. An assertion that repeats a model stub response establishes plumbing only.
4. **Reproducible artifact:** code and app revision, scenario and harness revision, input fingerprints and counts, model and prompt revision, event timeline, checks, screenshots, and redacted failure details in a versioned run record.
5. **Packaged boundary:** a product-flow acceptance result launches the packaged Electron executable with isolated app data and exercises the user path. Source-module checks carry the `contract` label.
6. **Decision type:** deterministic checks state exact expected values; semantic outcomes use a documented human rubric and retain the reviewer decision with its evidence.
7. **Process cleanup:** a timed-out or aborted packaged run terminates its isolated Electron process group and leaves the user's installed app and profile untouched. The run record keeps the driver timeout or interruption code.

Private repository content, conversation text, credentials, full paths, and traces stay in the local run directory. Shared manifests contain counts, fingerprints, redacted summaries, and artifact types. A credential scenario uses only fictional credentials.

## Result labels

`contract` means a focused deterministic source check. `fixture-e2e` means a packaged run with fictional inputs and controlled services. `local-e2e` means a packaged run using operator-selected material. `human-reviewed` adds a recorded semantic judgment. `unsupported`, `blocked`, and `failed` remain distinct results. A green `contract` result supplies no product acceptance claim.

Each product change maps its affected behavior to scenario IDs. The change record cites a run ID for each applicable fixture gate and a local run summary when semantic or real-service evidence matters. The console shows the coverage and latest result by scenario and code revision.

## Migration gates

| Gate | Required evidence | Retirement action |
| --- | --- | --- |
| G0: baseline | Record the existing test's failure mode and oracle; assign an EV scenario and migration action. | Keep the existing case while the stronger path is built. |
| G1: runner | Run a fictional packaged scenario from a portable command and save a complete local run record. | Replace duplicate wiring assertions after the corresponding packaged path runs in CI. |
| G2: resilience | Inject a failure after one validated batch, restart, and prove saved work is reused. Run credential migration across launches with the legacy input present. | Replace service-mock recovery and storage-success assertions after their E2E gates run in CI. |
| G3: real workflow | Select a local repository and conversations, complete analysis with a configured model, and inspect trace and report. | Retire quality assertions that compare output with a prepared model response; keep deterministic boundaries with distinct failure modes. |
| G4: release | Review focus-card meaning against EV-08, inspect packaged startup and persistence, and link the run records to the code revision. | Declare product acceptance only from completed fixture, local, and human gates that apply to the release. |

The migration action `keep` retains a narrow independent contract. `replace` retains the old test until the named packaged gate is runnable and then removes its duplicate claim. `delete` removes an oracle that contradicts current product policy immediately while its replacement scenario remains open. A test that merely restates implementation stays until its replacement gate covers the underlying risk. A failing or blocked packaged run leaves the gate open regardless of unit-test status.
