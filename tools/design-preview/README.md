# Branchout design review

This preview provides component and report scenes for [the design contract](../../design.md). It imports the shared React buttons and disclosure rows from `src/renderer/design/`, and the production native dialog from `Primitives.tsx`. Application pages use the same shared component and token source.

## Run

From the repository root:

```sh
node tools/design-preview/serve.mjs --port 4321
```

Open `http://127.0.0.1:4321`. The registered localhost-manager project is `branchout-design-preview`. The server builds the preview on startup; restart it after source edits. Dependencies resolve from the repository installation.

## Review

- Report scene: reading hierarchy, disclosure rows, suggestion actions, and chronological process records.
- Component sheet: brand and functional icons, semantic colors, primary/secondary/quiet buttons, compact controls, and disabled state.
- Edit Content: opens the shared dialog. Saving updates the suggestion text in session memory. Cancel and Escape preserve the saved version.
- Add to Focus Cards: previews the accepted state. Refresh restores all fictional fixtures.

Surrounding navigation and task rows provide illustrative layout context. This preview uses browser state and fictional data; application persistence and model execution remain separate.

## Observed checks — 2026-09-29

The preview loaded through its HTTP server. Keyboard Enter expanded input coverage, Space collapsed it, and the accessible expanded state changed accordingly. Editing focused the textarea; saving changed the displayed suggestion and returned focus to its trigger. Escape also returned focus. Accepting a suggestion displayed the disabled accepted action. The component sheet rendered the shared controls. At 680 px width, the reader wrapped within the viewport. TypeScript checking passed for shared source components; esbuild compiled the preview.

Screenshots: [components](qa/components.png), [report](qa/report.png), [compact reader](qa/compact.png).

Mouse activation through the in-app browser automation returned unchanged state; the interaction observations above were completed using keyboard activation. Manual pointer verification remains part of the next review.
