# Evaluation runner

`run.mjs` provides the command-line entry point and an importable `runEvaluation` function for a future localhost console. `run-record.mjs` validates version 1 run records and reads or writes them atomically. The [scenario catalog](../../docs/evaluation.md) defines the failure modes and oracles.

Fixture coverage drives a packaged Branchout executable through synthetic project analysis (EV-04), interrupted multi-batch recovery (EV-05), or fresh model storage (EV-13). From the repository root:

```sh
npm run eval:fixture -- --app release/mac-arm64/Branchout.app
npm run eval:fixture -- --scenario EV-05 --app release/mac-arm64/Branchout.app
npm run eval:fixture -- --scenario EV-13 --app release/mac-arm64/Branchout.app
```

Pass `--app` with the packaged executable on other platforms. `--output-root` selects a machine-local directory outside the checkout. The default is `~/.branchout/evaluation/runs`. Each run creates a private directory containing `run.json`, a driver log, and a report screenshot. The run record contains fingerprints and counts for inputs, app and harness revisions, checks, stages, and artifact references. The temporary fictional repository and conversation are removed after the desktop check.

EV-04 exercises one analysis batch and a synthesis request through a local model stub. A passing record establishes selected-input coverage, saved report, suggestion acceptance, persisted JSONL and HTML for both requests, exported index links, and private trace permissions. EV-05 selects 45 fictional conversations to force three batches, persists the first, injects three HTTP 503 responses into the second, restarts the app, and retries. It checks model-call reuse, full report coverage, and a new-task trace export linked to the reused first batch. A failed EV-05 run retains a redacted diagnostic JSON and local HTML artifacts so the missing link remains reviewable. EV-13 saves a fictional API key through the packaged UI, checks the owner-only JSON file and a loopback model request, then reopens the app twice. The third launch leaves invalid legacy ciphertext beside the valid JSON file, establishing that the model path reads JSON first. Legacy migration needs ciphertext encrypted for the selected app identity on that computer; an operator-supplied local input and human Keychain observation will cover that path. Fixture CI never invokes Safe Storage to manufacture legacy ciphertext. Local target selection will reuse the same runner and record format while the app profile holds its model connection.

## Local console

Start the console with `npm run eval:console -- --port 4317`, then open `http://127.0.0.1:4317/`. The server binds to the loopback interface. It lists scenario implementation status and saved runs, launches EV-04 or EV-13, and shows progress, checks, and a desktop screenshot. The directory browser selects a Git repository and saves its location in the local evaluation directory; preflight currently reads Git metadata. The console labels real-repository execution as unavailable until the runner and app session path support it. `--output-root` can select another directory outside the checkout for isolated runs.
