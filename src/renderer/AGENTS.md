# Renderer changes

Read [the UX specification](../../docs/ux-spec.md) for page ownership and [the design contract](../../design.md) for visual and interaction rules before changing a user flow.

- Compose the existing shell, toolbar, index, reader, row, and dialog patterns. The shell owns the module heading; readers name the selected object.
- Reuse `Primitives.tsx`, `AnalysisReportView.tsx`, semantic color tokens, and shared control classes. Extend a shared role at its source and update every matching usage.
- Keep page-facing mapping in `product-ui.ts`; route writes through validated main-process commands. Preserve saved report and focus-version references.
- Apply the design system's acceptance checklist to changed states. Include implemented-renderer screenshots and exercised interactions with isolated fictional fixtures in the change verification record.
- Update the authoritative UX or design section when the associated rule changes.

- Use `design/Components.tsx` for disclosures and buttons, and `design/tokens-and-controls.css` for their tokens and states. Exercise shared changes in the application; retire superseded rules at the same call sites.
