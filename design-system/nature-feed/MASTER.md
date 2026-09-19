# nature-feed UI system

This file is the product-specific interpretation of UI UX Pro Max guidance for the Electron desktop app. Product behavior remains authoritative in `docs/mvp-prd.md`; runtime tokens remain authoritative in `src/ui/tokens.css`.

## Product posture

- Desktop productivity tool for collecting, understanding, exploring, and composing from source material.
- Content and decisions come before explanation or decoration.
- The interface uses one persistent rail, one page title, and task-local state. It does not expose implementation scope labels such as local, personal, or workspace in the permanent shell.
- The four primary modules are 内容收集, 项目理解, 素材探索, and 内容创作. 设置 is a separate utility destination.

## Information hierarchy

1. Show one page title. Do not repeat it with a breadcrumb and descriptive subtitle on flat or two-level pages.
2. Keep text only when it changes a choice, explains current state, provides recovery, or warns about a consequence.
3. Put optional technical detail behind an accessible info control. Do not render long explanations under every option.
4. Render controls only when they are usable. Empty states must not expose filters, bulk actions, or later workflow steps.
5. Each screen has at most one primary action. Secondary and destructive actions are visually subordinate and spatially separated.

## Page state model

- First use: one concise message and one action.
- Empty: compact state inside the content region; no oversized dashed frame.
- Ready: expose the controls for the current task only.
- Running: show progress, the current action, recovery, and results without repeating setup help.
- Error: state the cause and the next recovery action near the failed control.

Multi-stage flows use progressive disclosure:

- Exploration: project → angle → source and time → start.
- Feed creation: select material → arrange and configure → generate.
- Settings: category → item → detail.

## Visual tokens

| Role | Value |
| --- | --- |
| Canvas | `#F7F8F8` |
| Surface | `#FFFFFF` |
| Primary text | `#172322` |
| Secondary text | `#63706E` |
| Border | `#D7DDDB` |
| Brand / primary action | `#0F766E` |
| Selected surface | `#E3F2EF` |
| Warning | `#8A4B08` on `#FFF6E5` |
| Danger | `#DC2626` |
| Navigation | `#17211F` |

- Orange is not a generic CTA color. Warning and danger colors are semantic only.
- Teal is reserved for brand, focus, selection, and the single primary action.
- Base surfaces are neutral; avoid tinted page-wide backgrounds and bright borders.

## Typography and spacing

- Plus Jakarta Sans is bundled locally for all interface text.
- Page title: 24–30px; section title: 16–18px; body: 14px; supporting text: 12–13px.
- Do not use body text below 12px.
- Use the 4/8px spacing scale. Prefer 16px component gaps, 24px section padding, and 32px page separation.
- Long repository names and mixed-language content wrap naturally with `overflow-wrap: anywhere`.

## Components

- The brand mark uses one shared content-sprout geometry across the sidebar, app icon, and monochrome macOS menu-bar template. It must remain recognizable at 18px and must not resemble a settings/sliders control.
- Navigation uses an outline SVG icon plus a visible label. Decorative numbering and subtitles are forbidden.
- Cards represent selectable or independently actionable entities only. Ordinary groups use spacing and dividers.
- Non-interactive surfaces must not gain a hover border, shadow, or pointer cursor.
- Icon-only controls are limited to universal actions such as filter, more, close, and info; each requires an accessible name and visible tooltip or title.
- Empty states have one action at most.
- Destructive row actions live in an overflow menu rather than remaining permanently visible.

## Motion

- Page and detail content may enter with a 160–200ms opacity and 4px vertical transition.
- Popovers and disclosures use 120–160ms opacity/transform transitions.
- Motion communicates hierarchy or state only; do not stagger dense tables or animate every card.
- All motion must be interruptible and disabled under `prefers-reduced-motion`.

## Desktop acceptance

- Verify 1100×720, 1280×800, and 1440×940.
- No horizontal overflow; no action hidden behind sticky content.
- Keyboard navigation and visible focus work for navigation, disclosures, dialogs, forms, and icon controls.
- Normal text contrast is at least 4.5:1, functional icons and boundaries at least 3:1.
- Empty, populated, running, partial, error, and recovery states remain distinguishable without relying on color alone.
