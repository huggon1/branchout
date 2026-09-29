# Project analysis evaluation

These commands use the same `prepareProjectAnalysis` and `runProjectAnalysis` functions as the desktop worker. The model receives the same system instruction, JSON evidence batches, and synthesis prompts. The script supplies an operator-selected repository and conversations with an empty focus-card set; the desktop app supplies its frozen focus cards. This run analyzes the selected commit range because the current product pipeline does.

Run files are saved under `~/.branchout/evaluation/prompt-runs` by default. Each invocation creates a private directory.

## Inspect the selected conversations and actual prompts

List conversations attributed to a Git repository:

```sh
npm run analysis:preview -- --repo /path/to/git-root --list
```

Choose conversation IDs and prepare the model inputs:

```sh
npm run analysis:preview -- --repo /path/to/git-root --sessions id-1,id-2
```

`conversation.xml` is a readable view of messages produced by the production Codex parser, with source JSONL line numbers. The model receives the JSON evidence in `prompts/batch-*.txt`. `system-prompt.txt` contains the exact batch system instruction. `input.json` records selected IDs, parser coverage, repository revision, input hashes, and the commit range. The XML file is a review artifact; the desktop model receives the JSON prompts.

## Run the desktop analysis implementation

Prepare the prompts for inspection:

```sh
npm run analysis:run -- --repo /path/to/git-root --sessions id-1,id-2
```

Add `--execute` when you want to run the configured model:

```sh
npm run analysis:run -- --repo /path/to/git-root --sessions id-1,id-2 --execute
```

The script reads the existing Branchout model connection from its local application data. Use `--app-data /path/to/Branchout-userData` for another profile. It calls the production batch runner and report validator. Product retry limits, batch planning, synthesis, and Pi session settings apply. `prompts/system-*.txt` and `prompts/batch-*.txt` retain the instructions actually sent, including synthesis calls. `report.json` contains the validated application report; `result.md` presents its summary, findings, and suggested cards. `trace.html` links to available Pi HTML records for every attempt. `run.json` records the run outcome.

Pass `--range recent_30|recent_100` to match the commit range selected in the app. Pass `--guidance /path/to/guidance.json` to compare `analysisGoal` and `cardWriting` overrides. Pass `--output-root /path/to/private-runs` to choose another private artifact directory outside the source repositories.

The current desktop analysis gives Pi an empty tool set. The next `read` exploration change belongs in the production worker; this script will then exercise it through the same entry point.
