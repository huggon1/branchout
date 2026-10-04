# Local source readers

`readers` provide local project-analysis input. The main process uses them for pre-submit previews; workers parse selected conversations and inspect repository identity during execution. Both paths use the same project attribution and source-location rules. See [analysis behavior](../../docs/product-spec.md#project-analysis-and-suggestions) and [input contracts](../../docs/data-contracts.md#project-analysis-input-and-results).

| Path | Responsibility |
| --- | --- |
| `repository/` | Repository identity, Git HEAD, worktree state, and candidate file count |
| `codex-sessions/` | Candidate discovery, project attribution, and user messages and final replies from selected conversations |
| `shared.ts` | Controlled Git calls, cancellation checks, and path and sensitive-content handling |

## Local document links

`document-links/` checks Markdown file targets and standard heading anchors for one document. It reports valid, missing, missing-anchor, external, outside-scope, and unreadable references. Repository boundaries apply to resolved symbolic links. Each inspection covers the first 200 distinct links. External references receive the external status.
