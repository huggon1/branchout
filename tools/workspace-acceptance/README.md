# Workspace acceptance

These fixtures exercise the production stores, services, preload interface, and React renderer with fictional project and content data. The [failure cases](failure-cases.md) were recorded before implementation.

## Repeat

From the repository root:

```sh
node tools/workspace-acceptance/run.mjs
npm run typecheck
npm run build
```

The runner writes [service-results.json](service-results.json), creates an isolated temporary profile, and records its path in the ignored `.fixture-path` file. Add `--launch` to build and open Electron using that profile with keychain access disabled. A running production profile remains separate.

## UI walkthrough

1. Open Content. Select complete, zero-connection, and unfinished-connection items. Verify understanding precedes connections and the unfinished result offers retry. Open the source snapshot from each state, press Escape, and verify focus returns to the source action.
2. Open Projects, choose Fieldnotes, and use View Result. Verify the analysis report opens inside Tasks. Expand evidence and Run Process; check formatted assistant text and chronological order.
3. Accept the outdated suggestion. Review the returned current version, then accept the reviewed change. Reopen the report and verify its accepted status and card link.
4. Open Focus Cards. Edit a card, save it, delete it, undo, then delete and restore it from Deleted. Open an older version and verify its text stays unchanged.
5. Reopen the isolated profile. Verify saved edits, deletions, task result, and historical versions. Filter lists to an empty result and return to the populated state.
6. Check a compact window: Content index-to-reader and Return; dialog focus and Escape; project actions; task report scrolling; wrapping settings controls.

The completed walkthrough is recorded in [observed results](observed-results.md).

## Evidence boundaries

The saved screenshots show the implemented Electron renderer using these fixtures. The service report verifies transaction, deletion, history, redaction, and terminal-event behavior. UI activity uses a persisted fictional assistant message. Live provider streaming, external source retrieval, and authenticated integrations require their own configured runtime verification.
