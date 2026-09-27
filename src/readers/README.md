# Local source readers

`readers` provide local project-analysis input. The main process uses them for pre-submit previews; workers read selected scope during execution. Both paths use the same project attribution and source-location rules. See [analysis behavior](../../docs/product-spec.md#project-analysis-and-suggestions) and [input contracts](../../docs/data-contracts.md#project-analysis-input-and-results).

| Path | Responsibility |
| --- | --- |
| `repository/` | Current files, Git HEAD, worktree state, and file scope and locations |
| `git-history/` | Metadata, messages, and diffs for selected commits |
| `codex-sessions/` | Candidate discovery, project attribution, and user messages and final replies from selected conversations |
| `shared.ts` | Controlled Git calls, cancellation checks, and path and sensitive-content handling |
