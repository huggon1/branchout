# Project analysis quality oracle

This document defines the first evaluation target for project-analysis findings and focus-card suggestions. [Product behavior](product-spec.md) and [data contracts](data-contracts.md) remain authoritative for saved reports and evidence.

## Observed implementation gap

The current worker asks each source batch for findings and card suggestions. It joins batch results using exact normalized text. A run with many batches can therefore keep several local implementation details as separate cards and repeat one user goal in different words.

## Failure modes to exercise before implementation

| Scenario | Failure signal |
| --- | --- |
| One user goal appears in several conversations and batches | The report proposes separate cards for equivalent angles. |
| A repository change has detailed implementation evidence but little user intent | The suggestion describes a command, file, function, or one-off task as the lasting interest. |
| A candidate cites an assistant conclusion alongside a user statement | The final card attributes a goal to the user that the user did not express. |
| Existing cards already cover the angle | A create suggestion repeats a current card instead of updating it or omitting it. |
| Source excerpts end at an input limit | The finding claims context beyond the visible excerpt. |
| A large run produces more candidates than the synthesis prompt can carry | The report presents a partial synthesis as if it reviewed every candidate. |

## Review rubric

Reviewers score each suggested card as **accept**, **revise**, or **reject** on these dimensions:

1. **Independent meaning:** The text gives a reader enough project context and an interest angle to judge a future content connection from the card alone.
2. **Durability:** The angle remains relevant beyond the immediate edit, command, or release step.
3. **User intent:** Conversation-backed claims trace to eligible user messages. Repository-only recommendations state a project-derived angle rather than attributing a preference to the user.
4. **Evidence:** Every selected angle has locatable support in the frozen analysis input. Quotes support the stated claim within the visible excerpt.
5. **Distinctness:** Equivalent angles merge into one suggestion. An existing card receives an update only when the proposed text materially sharpens its angle.
6. **Scope:** The final set favors the few strongest angles. A run may yield zero suggestions when evidence does not support a durable angle.

The evaluation record includes a short reviewer note and the evidence locations used for each judgment. Aggregate acceptance rate is reported alongside distinctness and coverage; a high count of cards alone is not a quality signal.

## Synthesis boundary

Batch analysis produces validated evidence-linked candidates. A final global synthesis reads compact candidate descriptions, batch summaries, existing cards, and the evidence IDs already validated by the batch stage. It returns a small ranked set. The validator resolves each selected candidate ID to its validated evidence IDs and checks update targets against frozen card versions. The report records how many candidates fit the synthesis input and how many were omitted by the character budget.

The prompt keeps evidence location, JSON shape, and source-as-data rules fixed. Users can edit the analysis goal and card-writing guidance. The resolved prompt text and deterministic revision hash belong to the frozen task input and evaluation record.
