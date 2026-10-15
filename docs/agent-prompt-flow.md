# Agent prompt flow

## Loading paths

| Stage | System | User | Tools and additional instructions |
| --- | --- | --- | --- |
| Search answer | Generic `browserSystem` plus capture/access rules, assembled in browser worker | `platformSearchInstruction`: adapted question and reply capture | Browser plus the selected search skill catalog; `load_platform_skill` returns its full file |
| Search sources | Same persisted browser session | `searchCitationInstruction`: extract citations after saving the answer | Browser and `capture_search_sources`, with the loaded platform skill |
| Main/reference collection | Same browser system | `materialCollectionInstruction`: address, capture requirements, reference scope, and schema | Browser plus reading skill catalog; optional `read_xiaohongshu` tool |
| Translation | `translationSystem` in a new lightweight Agent | One original Markdown chunk | Empty tool list |
| Fidelity correction | Translation system plus correction instructions | Original, returned translation, and preservation issues | One new lightweight Agent with empty tools |
| Introduction | `summarySystem` in a new lightweight Agent | Material title, coverage, and available translation | Empty tools; long inputs use successive reduction calls |
| Connection check | Fixed connection-check system | Fixed OK request | Empty tool list, bounded output |

[Browser prompts](../src/platforms/browser/prompts.ts) owns common task templates. [Reading prompts](../src/worker/jobs/forwarding/reading-prompts.ts) owns translation and introduction systems. [Browser worker](../src/worker/jobs/browser/worker-entry.ts) assembles persisted sessions; [Pi runtime](../src/worker/pi-runtime.ts) creates lightweight Agents.

## Platform skills and tools

[Bundled skills](../src/platforms/browser/skills.ts) derive names and descriptions from separate `SKILL.md` files. Search exposes only its selected platform's search skill. Collection exposes reading skill summaries so redirected or referenced pages can select the relevant instructions. `load_platform_skill` loads one file into a tool response; other bodies stay outside model context.

[Tool definitions](../src/platforms/browser/tools.ts) owns browser operations and optional enhancement descriptions. Adding a tool changes its definition and registration. Platform instructions change in their own skill file. The generic system stays platform-independent.

Persisted sessions use the application system and Pi's working-directory section. The factory fixes append-system input to an empty list and disables automatic context, skill, extension, and template discovery. Application skills use the explicit tool catalog. Lightweight Agents receive their explicit system directly. Both paths use the shared [Pi bridge](../src/pi/README.md) for native credentials, reasoning, and request options. New native sessions append provider, Pi version, and requested/effective reasoning as `postrove:model-settings` metadata.

## Recovery and logs

Browser recovery keeps the same session and task budget, with up to three transient-failure attempts and bounded result corrections. Tool-free translation and introduction calls also permit three transient-failure attempts, with short waits and cancellation checks. Authentication, quota, and invalid configuration failures end the call. Fidelity correction uses its own preservation check and correction prompt.

Persistent sessions write native Pi JSONL and HTML. Lightweight export copies the actual system, user, assistant, and tool-result messages into the persisted session and restores the Agent message state before native export. [Execution identity](data-contracts.md#development-profiles-and-execution-identity) defines revision scope.
