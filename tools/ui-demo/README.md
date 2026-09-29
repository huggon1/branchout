# Branchout interaction prototype

A standalone browser prototype for reviewing the proposed information hierarchy, navigation, reading flow, and white/graphite visual direction. The production renderer remains separate.

## Run

```sh
cd tools/ui-demo
npm ci
npm start -- --port 4319
```

Open `http://127.0.0.1:4319`. The registered localhost-manager entry is `branchout-ui-demo`.

## Scope

- Content: searchable source list, project connections, expandable evidence, original-source reading, and zero-connection examples.
- Projects: vertical project index, binding details, focus overview, and analysis preparation.
- Tasks: simulated activity, stop/retry, in-place reports, project/status filters, and suggestion acceptance.
- Focus cards: creation, editing, activation, deletion with undo, and project/status filters.
- Settings: connection hierarchy previews and a fixture reset action.

All reports, citations, repositories, and activity are fictional fixtures. Model execution is simulated over approximately 18 seconds. Focus-card changes persist in browser localStorage; tasks reset on reload. Settings dialogs preview configuration hierarchy. Real authentication and model connections belong to the production app.

## Visual approach

Native system sans-serif typography, white reading surfaces, neutral gray navigation, charcoal primary actions, and restrained cobalt interactions. Lists use compact metadata; reports separate conclusions, evidence, and actions. Phosphor supplies interface icons. The existing brand silhouette is presented with a grayscale CSS treatment for this prototype.

Controls use 7px corners, bounded objects 10px, and dialogs 13px. State transitions use short opacity/transform motion; reduced-motion preferences produce immediate transitions. Narrow screens switch between list and reading surfaces.

## Repeatable browser walkthrough

1. In Content, expand evidence and open its context. Return to the report and verify the expanded evidence remains available.
2. Search for an unmatched phrase and clear filters. Select the city-sound item to inspect the zero-connection state.
3. In Projects, select Branchout, start analysis, adjust selected conversations, and launch. Expand the initially collapsed activity. After about 18 seconds, verify a report occupies the same task detail.
4. Accept a card update. Open Focus Cards and verify the new text and version.
5. Pause a card, delete it, and select Undo. Create and edit a card, then reload to verify persistence.
6. In Tasks, select the failed content task. Inspect preserved stages and retry. Launch another simulation, stop it, and restart.
7. At 680px window width, open an item, read its details, and return to the list. Verify dialogs and focus-card actions remain reachable.
8. Use Settings → Reset to restore the initial focus-card fixtures.

Screenshots and the executed walkthrough record live in `qa/`.
