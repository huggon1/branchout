# Human evaluation workbench

This directory holds interactive workbenches for people reviewing Branchout behavior and model output. Each case names a production function, accepts operator-selected inputs, calls the production implementation, and saves the inputs, process record, and result for review.

A person starts model execution and judges the usefulness of its result. The workbench prepares inputs, records provenance, and presents artifacts. [Product acceptance and E2E scenarios](../docs/acceptance-scenarios.md) have separate failure modes and oracles.

## Available case

- [Project analysis](cases/project-analysis/README.md): select a local repository and Codex conversations, inspect the prepared input, run the production analysis function, and review its report and Pi HTML trace.

The current interface uses command-line entry points. A local interactive page will wrap the same case entry points and show the target function, inputs, run history, result, and trace links. Run artifacts stay in an operator-owned local directory outside the repository.
