# Branchout design

## Status and authority

This is the shared visual contract for Branchout. The application and [the design preview](tools/design-preview/README.md) use the same tokens, buttons, and disclosure components. The preview provides fictional component and report scenes for subsequent visual changes.

This file owns colors, typography, spacing, shapes, component states, and visual acceptance. [UX](docs/ux-spec.md) owns page responsibilities and flows; [product](docs/product-spec.md) owns behavior; [data contracts](docs/data-contracts.md) own persistence. The supplied Miro marketing analysis informed the document structure, white canvas, dark actions, and limited brand color. Branchout adapts those ideas to a Chinese desktop reading workspace.

## Overview

White surfaces carry content. Ink carries actions. A small yellow facet identifies the folded-leaf brand. Neutral functional icons follow their surrounding text. Conclusions receive the strongest reading emphasis; evidence and execution details become available beside the claims they support.

The shell names the module once. The reader names the selected object. Lists organize peers, whitespace separates reading sections, and bounded panels identify actionable suggestions or decisions.

## Colors

| Token              | Value     | Role                                            |
| ------------------ | --------- | ----------------------------------------------- |
| `--ds-paper`       | `#ffffff` | Reading and dialog surfaces                     |
| `--ds-canvas`      | `#f7f7f5` | Navigation, selected index row, inset surface   |
| `--ds-ink`         | `#242421` | Primary text, functional icons, primary actions |
| `--ds-muted`       | `#686863` | Metadata, secondary controls                    |
| `--ds-line`        | `#e7e7e2` | Separators and quiet panel boundaries           |
| `--ds-hover`       | `#f1f1ed` | Control hover feedback                          |
| `--ds-yellow`      | `#f2d76b` | Brand facet                                     |
| `--ds-yellow-soft` | `#faf3d7` | Small brand context surface                     |
| `--ds-blue`        | `#355ec7` | Links and keyboard focus                        |
| `--ds-red`         | `#ad443d` | Destructive action and failure text             |

White text accompanies ink-filled actions. Yellow appears with ink text. Completion uses an ink check and explicit text; running uses an activity icon and stage text; incomplete coverage uses a written warning with an amber icon. Every state carries a readable name.

Shared roles reference semantic tokens. Brand asset facet colors belong to the SVG. New semantic roles receive a purpose here and a token in the shared stylesheet together.

## Typography

Use the native system sans-serif stack with PingFang SC and Microsoft YaHei fallbacks. Paths and code use monospace. Chinese uses normal letter spacing; Latin brand lettering may use slight optical tightening.

| Role                   | Size / weight  | Line height |
| ---------------------- | -------------- | ----------- |
| Object title           | 26–30 px / 550 | 1.35        |
| Section heading        | 18 px / 550    | 1.5         |
| Reading text           | 14–15 px / 400 | 1.85–1.9    |
| List title             | 14 px / 550    | 1.5         |
| Controls               | 13–14 px / 500 | 1.4         |
| Supporting information | 12 px / 400    | 1.6         |
| Secondary timestamp    | 11 px / 400    | 1.5         |

Titles, conclusions, and action names carry emphasis. Counts and timestamps use the secondary tier. Essential instructions use at least the supporting-information tier.

## Layout and spacing

Use a 4 px base with 8 px as the primary step. Icon-to-label space is 8 px; tightly paired metadata uses 4–8 px. Buttons in one action group have an 8 px gap. Separate action groups use 24 px. Reading sections use 32 px; panel contents use 20–24 px. Desktop reader gutters use 40–48 px and compact gutters use 24 px.

The desktop shell uses a 184 px navigation area, a 230 px task index, and a reader up to 844 px including gutters. Content and project indexes may widen when their labels require it. Each index and reader owns its scroll area. Long object names wrap in readers and truncate with an accessible full label in indexes.

At compact widths, preserve a usable reading measure and reachable actions. The preview hides its illustrative index below 760 px; production index-to-reader navigation follows the UX specification. Control groups wrap as groups; dialog actions remain together.

## Shapes, elevation, and icons

Primary actions have pill corners. Secondary controls use 10 px corners; inputs use 8 px; bounded suggestions use 12 px; dialogs use 16 px. Text actions remain visually flat. Status text and filter controls have distinct visual treatments.

Reading sections and rows remain flat. Dialogs use one neutral shadow, `0 16px 48px rgb(36 36 33 / 12%)`, above a neutral backdrop. Focus rings provide explicit keyboard feedback.

Use Phosphor regular icons, 16 px within actions and 18–20 px in navigation. Functional icons inherit the control's foreground. Icon-only buttons use a 32–36 px square target, accessible name, and tooltip. Touch-oriented controls use a 44 px target.

Preserve the folded-leaf silhouette. The application SVG assets use one yellow folded face and ink-to-neutral facets; their small and app-icon sizes appear together in the preview. Build scripts derive the PNG and native icon from the application SVG.

## Components

### Buttons and action groups

`DesignButton` owns primary, secondary, quiet, and compact variants. Standard height is 36 px; compact height is 30 px. Horizontal padding is 14 px, or 18 px for the primary pill. Icons and text align to the vertical center.

Each decision area emphasizes its next action with one primary button. Secondary actions use a border or quiet treatment. Low-frequency destructive actions live in a labeled menu or a separate group. Processing retains the action's width, displays a readable progress label, and prevents repeat submission. Failures retain user input and place recovery beside the action.

Hover changes the surface; pressing shifts the control by 1 px; keyboard focus draws a 2 px blue ring with 3 px offset. Disabled controls reduce emphasis and preserve readable labels.

### Disclosure rows

`Disclosure` owns evidence, input coverage, and run-process expansion. The trigger spans the available row, with title and subdued count on the left and “查看” / “收起” on the right. Its minimum height is 48 px, with a quiet top divider and a surface hover response. The content aligns with the title and continues the reading flow.

The trigger is a native button with `aria-expanded` and `aria-controls`; the controlled panel uses the corresponding ID. Enter and Space toggle the panel. Collapsed content leaves the reading and focus order. Group navigation, where required, uses a right-aligned regular chevron from the same icon family. Inline supplementary evidence may use a named text action beside its claim.

### Lists and selection

Selected index rows use a neutral surface with an emphasized ink title; metadata remains muted. Selection is conveyed by the whole row surface. Hover is lighter than selection. Rows expose an actual navigation action when connected to application data. The preview's surrounding navigation and task list are illustrative context.

### Inputs and dialogs

Inputs use a neutral border and explicit labels. Dialogs reuse the existing native `Dialog` for top-layer placement, focus containment, Escape, and return-to-trigger focus. Editable dialogs initially focus their first field. Save keeps the draft until persistence succeeds; failure feedback appears beside the field or footer. The preview's draft exists only in the current browser session.

### Reading and suggestions

Reports begin with the conclusion and compact task context. Findings pair a short title with prose, then supporting evidence. A suggestion uses a bounded white panel, explicit project context, proposed text, and grouped actions. Acceptance changes the action to a check and saved-state label. Execution history remains a separate, initially collapsed section.

## Motion

Surface feedback uses 150 ms easing. Press feedback moves 1 px. Expansion is immediate for stable reading position. Reduced-motion preferences remove transitions. Activity conveys an actual running state; completion replaces it with a stable state label.

## Shared implementation and iteration

Reusable button and disclosure components live in `src/renderer/design/Components.tsx`; tokens and component styles live beside them in `tokens-and-controls.css`. The application and preview import this shared source. Existing application button classes alias the same shared definitions. `Primitives.tsx` owns the native dialog, sanitized Markdown, and icon mappings. Page styles own composition and responsive geometry.

For a visual change:

1. Identify the semantic role and existing shared component.
2. Update that component and its token source; add a variant when the role has distinct behavior.
3. Show the changed states in the preview and a populated report composition.
4. Verify keyboard operation, dialog focus, long labels, compact width, disabled controls, and reduced motion.
5. Record screenshots and exercised interactions in the preview README; update this file when the rule changes.

Visual acceptance checks button grouping, text hierarchy, icon weight and color, disclosure prominence, and reading measure. Runtime acceptance separately checks persistence, task execution, and version-sensitive writes through the application services.
