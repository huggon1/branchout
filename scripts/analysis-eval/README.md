# Project analysis prompt evaluation

These two commands prepare local inputs and run a manual prompt evaluation for a selected Git repository. They reuse Branchout's Codex conversation reader and Pi session runner. The desktop product keeps its current analysis pipeline; this evaluation records a separate exploration run for prompt review.

The input scope contains current repository files and explicitly selected Codex conversations. Git HEAD and worktree state identify the repository version. The command writes run artifacts under `~/.branchout/evaluation/prompt-runs` by default.

## 1. Inspect the conversation input

List conversations attributed to the repository:

```sh
npm run analysis:preview -- --repo /path/to/git-root --list
```

Choose IDs from that list and prepare the input:

```sh
npm run analysis:preview -- --repo /path/to/git-root --sessions id-1,id-2
```

The command prints a run directory. `conversation.xml` contains the cleaned user messages and final assistant replies that the evaluation agent can read. Each message includes its source JSONL line. `input.json` records selected IDs, omitted message counts, excluded record counts, and input hashes. The production parser applies its existing size limits and redaction rules.

## 2. Inspect or run an analysis

Prepare the exact XML and prompt files before making a model request:

```sh
npm run analysis:run -- --repo /path/to/git-root --sessions id-1,id-2
```

Review `conversation.xml`, `system-prompt.txt`, and `prompt.txt` in the printed directory. Start a model request by adding `--execute`:

```sh
npm run analysis:run -- --repo /path/to/git-root --sessions id-1,id-2 --execute
```

The command reads the existing Branchout model connection from its local application data. Set `--app-data /path/to/Branchout-userData` for another profile. Codex subscription runs use that profile's Codex login; general API runs use its saved API connection. `--thinking medium` selects a requested Pi thinking level. Codex models use Pi's model capabilities. A general API connection uses `--generic-reasoning` when its model supports reasoning; the default uses ordinary responses.

The run directory contains the input XML, both prompt files, `result.md`, `trace.html`, Pi's session JSONL, and `run.json`. The HTML shows tool calls, model replies, and any thinking content returned by the provider. `run.json` records the requested and effective thinking levels. The script offers Pi's `ls`, `find`, `grep`, and `read` tools for repository exploration. It starts one Pi session and makes one attempt, so each result corresponds to one manual evaluation run.

Pass `--guidance /path/to/guidance.json` to compare guidance text. The JSON file accepts `analysisGoal` and `cardWriting`. Pass `--output-root /path/to/private-runs` to choose a local artifact root outside the source repositories. Each invocation creates a separate directory for later comparison.
