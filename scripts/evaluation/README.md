# Evaluation runner

`run.mjs` provides the command-line entry point and an importable `runEvaluation` function for a future localhost console. `run-record.mjs` validates version 1 run records and reads or writes them atomically. The [scenario catalog](../../docs/evaluation.md) defines the failure modes and oracles.

Current fixture coverage drives a packaged Branchout executable through the existing synthetic project-analysis flow. From the repository root:

```sh
npm run eval:fixture -- --app release/mac-arm64/Branchout.app
```

Pass `--app` with the packaged executable on other platforms. `--output-root` selects a machine-local directory outside the checkout. The default is `~/.branchout/evaluation/runs`. Each run creates a private directory containing `run.json`, a driver log, and a report screenshot. The run record contains fingerprints and counts for inputs, app and harness revisions, checks, stages, and artifact references. The temporary fictional repository and conversation are removed after the desktop check.

The fixture currently exercises one analysis batch and a local model stub. A passing record demonstrates packaged-app wiring, selected-input coverage, saved report, suggestion acceptance, and rendered report. The catalog assigns separate scenarios to multi-batch recovery, Pi trace export, prompt provenance, and human suggestion quality. Local target selection will reuse the same runner and record format while the app profile holds its model connection.
