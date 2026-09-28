# EV-08 focus-suggestion review

This guide expands the [EV-08 scenario](evaluation.md) with a reproducible human oracle. The [product specification](product-spec.md#projects-and-focus-cards) defines the card's product role. The [public fictional case](../scripts/evaluation/fixtures/ev-08-public-case.json) supplies a shared calibration example. Review records follow the [local sidecar schema](../scripts/evaluation/focus-review.schema.json).

## Review order

1. Before opening the generated report, read the selected user messages and repository coverage. Record two to five **intent anchors**: a durable goal or tradeoff, its source location, and whether the user stated it or it is a project-derived opportunity. Record one-off instructions separately as exclusions.
2. Read each proposed card by itself, as it would appear beside an unrelated future article. Score `standalone` and `concern` before opening its rationale.
3. Open the cited source excerpts, existing cards, and other suggestions. Score `evidence` and `distinct`, then record the matching intent anchor, evidence locations, and a short reason for every `fail` or `unclear`.
4. Check the full set against the pre-registered anchors. Record a missed angle when the report omits a supported durable concern. A zero-suggestion report receives an explicit coverage judgment.
5. A second reviewer resolves every `unclear` score using the same frozen report and source locations. The local sidecar keeps both judgments and the resolution.

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

Save `focus-review.json` alongside the evaluation run's `run.json`, report, and trace in the machine-local run directory. The sidecar identifies `runId`, `analysisReportId`, code revision, input fingerprint, effective prompt revision, reviewer alias, and review time. Each card entry uses the report's `suggestionId` and a content fingerprint; evidence locations and existing-card comparisons explain judgments. The sidecar stores the intent anchors written before report inspection and the final coverage decision.

The portable `run.json` keeps EV-08's four rubric labels and `criticalFailure` per suggestion fingerprint, plus a `review` artifact reference and digest. The local sidecar holds excerpts and reviewer notes. To compare runs, join by the selected-input fingerprint, then compare code revision, prompt revision, card decisions, and anchor coverage. A changed input fingerprint starts a new baseline rather than a direct quality delta.
