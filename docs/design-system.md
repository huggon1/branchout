# Branchout design system

This document defines the target interface's shared information hierarchy and interaction rules. See the [UX specification](ux-spec.md) for page flows.

## Information hierarchy and copy

- Each screen emphasizes the most important information for the current task. Peer headings, explanations, and actions surround the object the user is handling.
- Source content, model understanding, focus connections, and project analysis findings use distinct section headings and source labels.
- Status copy distinguishes queued, running, uncovered, zero connections, incomplete content, source read failure, and model failure, and offers the next action.
- Lists keep card excerpts, project names, and source titles identifiable. Detail views show complete text and evidence.
- Times, counts, and progress use recorded values. When the total is unknown, show the completed count and current action.

## Action hierarchy

- Place common primary actions by their objects: add a link on Content, edit or change status on a focus card, start analysis on a project, and accept a suggestion on that suggestion.
- Keep save, cancel, return-to-reading, and task-result actions in stable positions. Controls retain their positions and show status during processing.
- Icon actions have readable accessible names and keyboard focus. Use explicit text for accepting suggestions, pausing cards, and canceling tasks.
- Page transitions retain the selected project, list filters, and reading position. The task entry continues to show running status.

## Focus cards and connections

- Focus card editing centers on one free-text field. Guidance illustrates “necessary project context + angle of interest” and is visually separate from the saved content.
- Active and paused states use both text and visual cues. Historical versions show save time and version, with a clear route to the current version.
- Group report connections by project. Show each card, connection rationale, and source excerpt together. Give zero connections a complete state message.
- As the connection count grows, project groups can collapse while retaining a result count and clear expand action.

## Reading reports

- The reading view follows one primary vertical axis. Source text and images lead; general understanding and focus connections form separate sections.
- Distinct headings and quotation styles identify source text, model interpretation, and historical card content.
- Project analysis reports show conclusions and coverage first, then findings, evidence, and card suggestions. Create and update suggestions use the same comparison structure, with acceptance status beside the suggestion.
- Place partial retrieval and stage-failure messages by affected content, retaining readable completed results.

## Task center

- Running tasks emphasize the current stage, latest activity, and processed count. Earlier activities follow time order; a result link becomes the primary action on completion.
- Activity summaries name understandable actions and objects; reports contain detailed evidence.
- Text, icons, and color communicate status together. Failed and canceled tasks show completed scope and a corresponding action.
- Navigation indicators and task details use the same saved status across page changes and window reopening.

## Window and shared states

- Keep a narrow, stable left navigation and devote the main area to reading, card editing, or task activity.
- As width shrinks, reflow secondary information, connection groups, and actions while keeping text and controls readable.
- Controls cover default, hover, pressed, keyboard focus, disabled, and processing states. Focus outlines remain visible and state changes preserve layout.
- Show source images at their original aspect ratio along the reading axis. Scroll long text, connection lists, and activity logs in their appropriate areas.

## Brand icon

The app icon uses the [rounded pale-green folded-ribbon master](design/branchout-icon-light-master.png). The interface brand mark uses the same silhouette on a transparent background over the sidebar color. Both share the green palette and opening direction.

Choose font, spacing, control height, and breakpoints through Electron window and interaction validation. This document and the UX specification define the content sections.
