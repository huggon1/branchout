# Documentation Policy

This repository keeps durable project knowledge in `README.md` and `AGENTS.md`.

## README.md

A `README.md` describes the current, post-merge truth of the directory or module that owns it.

Use it for:

- the area's purpose and responsibilities;
- behavior, boundaries, and limitations that callers or maintainers rely on;
- terminology needed to understand the area;
- concise rationale or intentional non-goals that code cannot safely explain;
- links to related or child READMEs.

Do not use it for implementation plans, work logs, PR history, or narration of code that is already clear from the source.

A README may summarize its direct children. Detailed facts belong in the nearest README that owns them.

## AGENTS.md

An `AGENTS.md` contains stable instructions for changing files in its directory and descendants.

Use it for:

- rules and constraints;
- required validation;
- required or prohibited development patterns;
- links to the README or other source that explains the area.

Do not use it for feature descriptions, one-off task requirements, work logs, or rules already stated by a parent `AGENTS.md`.

The root `AGENTS.md` applies repository-wide. A nested `AGENTS.md` supplements it only for its own subtree.

## Placement

Update an existing owner before creating another document.

Create a README only when a directory has a meaningful responsibility, consumer boundary, or vocabulary of its own.

Create a nested AGENTS file only when its subtree has stable instructions that differ from the parent scope.

Keep one authoritative home for each fact. Link instead of copying.

## Changes

Update the owning README in the same PR when a change alters behavior, responsibility, terminology, boundaries, limitations, or durable rationale.

Update the applicable AGENTS file in the same PR when a change creates or changes a stable instruction for future work.

Mechanical or local changes with no durable knowledge change require no documentation update.

Write documentation as the proposed post-merge current state, not as a future-tense plan or completion report.

For non-trivial work, present the planned README and AGENTS changes before implementation. After implementation, reconcile those documents with the final code and evidence.

## Evolution

Do not create new documentation categories preemptively.

Add a new document type only after recurring content no longer fits README or AGENTS cleanly, and update this policy when that happens.