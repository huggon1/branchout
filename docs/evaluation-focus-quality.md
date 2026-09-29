# EV-08 focus-suggestion review

This guide expands the [EV-08 scenario](acceptance-scenarios.md) with a human review rubric. The [product specification](product-spec.md#projects-and-focus-cards) defines the card's product role. The SeedShelf example below provides a fictional calibration case.

## Review order

1. Before opening the generated report, read the selected user messages and repository coverage. Record two to five **intent anchors**: a durable goal or tradeoff, its source location, and whether the user stated it or it is a project-derived opportunity. Record one-off instructions separately as exclusions.
2. Read each proposed card by itself, as it would appear beside an unrelated future article. Score `standalone` and `concern` before opening its rationale.
3. Open the cited source excerpts, existing cards, and other suggestions. Score `evidence` and `distinct`, then record the matching intent anchor, evidence locations, and a short reason for every `fail` or `unclear`.
4. Check the full set against the pre-registered anchors. Record a missed angle when the report omits a supported durable concern. A zero-suggestion report receives an explicit coverage judgment.
5. A second reviewer resolves every `unclear` score using the same saved result and source locations. The review note keeps both judgments and the resolution.

The reviewer inspects the saved report and selected input only. A later prompt edit, repository change, or card acceptance creates a separate comparison run.

## Card rubric

| Field in run record | `pass` | `fail` | `unclear` |
| --- | --- | --- | --- |
| `concern` | Names a durable user concern or tradeoff, or a clearly project-derived direction, at a level useful for future content matching. | Restates an immediate command, file edit, release step, or a low-level implementation choice as the interest. | The selected input suggests a broad concern, but the card's wording could also describe a one-off task. |
| `standalone` | Names the project or domain and the interest angle so a reader can judge a new article from the card text alone. | Depends on an unexplained “this,” task ID, function name, repository path, or report context; or says only “quality” or “performance.” | The card names an angle but its project context or intended audience remains ambiguous. |
| `evidence` | Cited excerpts directly support the stated concern and any attribution to the user; locations open within selected input. | The quote supports a different claim, comes only from an assistant's conclusion for a claimed user preference, or falls outside selected scope. | The excerpt ends before the decisive context or the source location is temporarily unavailable. |
| `distinct` | Adds a materially new angle or clearly improves a current card; equivalent batch suggestions are consolidated. | Duplicates another suggestion or current card in different words; an update repeats the current angle. | The difference from an existing angle depends on context absent from the report. |

Mark `criticalFailure` for private data exposure or a proposed action outside the selected project's scope. The EV-08 gate passes when every card has four `pass` scores, there are zero critical failures, and every pre-registered supported intent anchor has a coverage decision of `covered` or `deliberately_omitted` with a source-grounded reason. `unclear` keeps the gate pending until a second review. A missing strong anchor or any `fail` closes the run as failed. The reviewer may mark an anchor `unsupported` after reading more context, with an evidence-based explanation.

## Public calibration case

The fictional project is **SeedShelf**, a community seed-exchange inventory app. Its user asks for volunteers to record stock while offline and to understand conflicts after reconnecting. A separate user message asks to run a build command for a release. The repository also contains a sync implementation file. The first message supports a lasting interest; the command and file path provide execution context.

| Example card | Expected judgment | Reason |
| --- | --- | --- |
| “SeedShelf helps volunteers maintain a community seed inventory. Watch whether offline stock entry and clear conflict review make inventory changes reliable after reconnecting.” | Pass on `concern` and `standalone`, provided citations point to the user's offline and conflict goal. | It preserves the user-facing tradeoff and can guide future content matching. |
| “Run the release build and fix `src/sync/merge.ts` before publishing.” | Fail on `concern` and `standalone`. | It is an immediate action tied to one file and one release. |
| “Keep improving reliability.” | Fail on `standalone`. | It names neither the project context nor the relevant reliability problem. |
| “The user wants a specific merge algorithm for every conflict.” | Fail on `evidence` when cited only to the user's offline/conflict request. | The cited user goal leaves the implementation choice open. |
| A second create suggestion that paraphrases the passing card while an equivalent card already exists | Fail on `distinct`. | The report adds a duplicate angle instead of refining the current card. |

These examples calibrate judgment. A fixture model response that repeats the passing card establishes output plumbing; a human reviewer checks whether a real run abstracts the intent from source material.

## Local record and comparison

Save a `focus-review.md` note beside the manual prompt run's `run.json`, `result.md`, and `trace.html`. Record the intent anchors before opening the result, then write the four card judgments, cited locations, existing-card comparisons, and coverage decisions. Include the reviewer and review time. Compare runs with the same selected input fingerprint, then examine the code revision, prompt fingerprint, card decisions, and anchor coverage.
