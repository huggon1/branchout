# UI design

[Product specification](product-spec.md) owns page behavior. This document owns application layout and information hierarchy. [UI content admission](../AGENTS.md#ui-content-admission) owns copy approval. Reuse the renderer's shared controls and visual style.

## Page identity and headings

Navigation identifies the current destination, toolbars contain actions, and content headings identify objects or groups.

When the sidebar shows the current destination, its selected item provides visual page identity. Collapsing the Content group presents the selected child name and current state on its group control. Navigating to a Content destination expands that group.

When the sidebar becomes a drawer, the shared header presents the navigation control, current page name, and task entry in one row. Selecting a destination closes the drawer and moves focus to the page content. Escape returns focus to the navigation control.

The shared layout owns the page heading and the main region's accessible name. The page heading is visually hidden while sidebar navigation supplies location and becomes visible in the drawer layout. Each page begins with its first operation, saved object, setting group, or empty state.

Content headings name the current article, search question, follow, or settings group. Each heading introduces information within its own region. Object names can appear in both a selection list and its reader because each region supports its own task. Heading ranks express the content hierarchy.

## Layout and actions

The shared header keeps the global task entry in a consistent position across pages and reading states. Page actions sit near their target objects.

The content viewport fills the space remaining below the header. Lists and readers scroll within that space. Removing a heading also retires its dedicated container, minimum height, margins, and separator. Spacing follows the first remaining content element and the shared layout's spacing rules.

Returning from a reader focuses its selected list row. Deleting a selected record focuses the next selection when that row is visible. An empty list focuses its first input or filter. When the reader occupies the compact viewport, the page content supplies the focus fallback. Task-history actions return focus within the task panel.

## Review evidence

For each added or expanded title, label, or explanation, record its information gain, admission source, and triggering state. Review the rendered interface and both interface languages.

Layout evidence covers sidebar and drawer navigation, empty and populated lists, reading and return navigation, collapsed current groups, and final-record deletion. Save complete-window screenshots so navigation, global tools, and content can be assessed together. Record content bounds, header count, overflow, and focus targets with the screenshots.

The [workspace layout E2E](../tests/e2e/workspace-layout.spec.ts) provides repeatable layout evidence with isolated profiles and fictional records. The [test guide](../tests/README.md) defines broader application verification.
