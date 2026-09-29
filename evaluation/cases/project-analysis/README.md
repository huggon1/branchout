# Project analysis · human evaluation

## Function under review

| Role | Production target |
| --- | --- |
| Analysis entry point | [`runProjectAnalysis`](../../../src/worker/jobs/project-analysis/index.ts) |
| Input preparation | [`prepareProjectAnalysis`](../../../src/worker/jobs/project-analysis/index.ts) |
| Report mapping | [`analysisDraftSchema` and `reportFromDraft`](../../../src/main/services/project-analysis/pipeline-service.ts) |
| Pi session and trace | [`runPiCodingBatch`](../../../src/worker/pi-coding-session.ts) |

`runProjectAnalysis` receives a repository, selected Codex session IDs, frozen prompt guidance, focus cards, and model connection. It returns an analysis draft with findings, evidence, suggestions, and source coverage. The workbench passes an operator-selected repository and conversations with an empty focus-card set, then applies the production report validator and mapper.

The current production implementation reads selected repository files, a chosen commit range, and parsed Codex conversation messages. It sends bounded JSON evidence batches to Pi with an empty tool set and thinking disabled, then synthesizes batch results. The `conversation.xml` artifact presents the parsed messages for human inspection; the model receives the JSON batches. This description will change with the planned read-tool exploration work in the production function.

## Human review

Select a repository and conversations, inspect the parsed conversation, source coverage, and actual prompts, then start a model run. Read the report for project understanding, evidence quality, and independently useful focus angles. Open the Pi HTML trace to inspect the model work behind the result. Save observations beside the run artifacts for comparisons across prompt and code revisions.

These commands call the production preparation and analysis functions. The desktop app supplies its frozen focus cards; this case supplies an empty focus-card set. Both use the same batch prompts and synthesis logic.

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

The read-tool exploration change belongs in the production worker. This case will exercise it through the same entry point and update this function description and artifact list with the new behavior.
