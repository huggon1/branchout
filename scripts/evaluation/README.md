# Evaluation runner

`run.mjs` provides the command-line entry point and importable `runEvaluation` and `preflightLocalEvaluation` functions for the localhost console. `run-record.mjs` validates version 1 run records and reads or writes them atomically. The [scenario catalog](../../docs/evaluation.md) defines the failure modes and oracles.

Fixture coverage drives a packaged Branchout executable through synthetic project analysis (EV-04), interrupted multi-batch recovery (EV-05), or fresh model storage (EV-13). From the repository root:

```sh
npm run eval:fixture -- --app release/mac-arm64/Branchout.app
npm run eval:fixture -- --scenario EV-05 --app release/mac-arm64/Branchout.app
npm run eval:fixture -- --scenario EV-13 --app release/mac-arm64/Branchout.app
```

Pass `--app` with the packaged executable on other platforms. `--output-root` selects a machine-local directory outside the checkout. The default is `~/.branchout/evaluation/runs`. Each run creates a private directory containing `run.json`, a driver log, and a report screenshot. The run record contains fingerprints and counts for inputs, app and harness revisions, checks, stages, and artifact references. The temporary fictional repository and conversation are removed after the desktop check.

EV-04 exercises one analysis batch and a synthesis request through a local model stub. A passing record establishes selected-input coverage, saved report, suggestion acceptance, persisted JSONL and HTML for both requests, exported index links, and private trace permissions. EV-05 selects 45 fictional conversations to force three batches, persists the first, injects three HTTP 503 responses into the second, restarts the app, and retries. It checks model-call reuse, full report coverage, and a new-task trace export linked to the reused first batch. A failed EV-05 run retains a redacted diagnostic JSON and local HTML artifacts so the missing link remains reviewable. EV-13 saves a fictional API key through the packaged UI, checks the owner-only JSON file and a loopback model request, then reopens the app twice. The third launch leaves invalid legacy ciphertext beside the valid JSON file, establishing that the model path reads JSON first. Legacy migration needs ciphertext encrypted for the selected app identity on that computer; an operator-supplied local input and human Keychain observation will cover that path. Fixture CI creates fresh JSON through the app. Local target selection uses the same run record format while the app profile holds its model connection.

`npm run verify:package-ui` runs the packaged model UI check followed by EV-04, EV-05, and EV-13. Set `BRANCHOUT_EVAL_OUTPUT_ROOT` to retain the run records in a chosen machine-local directory. CI and release workflows upload those fictional-run records as workflow artifacts.

## Local console

Start the console with `npm run eval:console -- --port 4317`, then open `http://127.0.0.1:4317/`. The server binds to the loopback interface. It lists scenario implementation status and saved runs, launches fixture scenarios, and shows progress, checks, and artifacts. The directory browser selects a Git repository and saves its location in the local evaluation directory. `--output-root` selects another directory outside the checkout for isolated runs.

For EV-04 local mode, select a repository and packaged app in the console. Open the evaluation profile, configure its model connection in Branchout, and close that app window. Inspect conversations to run the packaged preflight, select session IDs, choose a commit range, and launch analysis. The evaluation profile lives beside the run directory; the app owns its credential. Each run saves its private input, report JSON, screenshot, trace HTML, and redacted `run.json` under the evaluation output directory. Saved runs remain available for comparison. The console displays session titles and previews only on loopback; the shared manifest stores counts and fingerprints.

The same local path is callable from a shell after packaged preflight and model setup:

```sh
node scripts/evaluation/run.mjs --mode local --scenario EV-04 --app /path/to/Branchout.app --repo /path/to/git-root --sessions session-id-1,session-id-2 --range recent_30
```

The run checks the selected IDs against fresh preflight data and records a failed result for missing model configuration, task failure, missing report, or missing trace. The operator reviews report quality separately using EV-08's rubric. The profile and run data stay outside the checkout. A closed profile window lets the runner acquire the app's single-instance lock.
