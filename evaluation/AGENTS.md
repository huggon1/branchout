# Human evaluation workbench rules

- Read the case README before changing its adapter or interface. Keep the named production function, source path, input description, observed output, and review instructions aligned with the implementation.
- Case runners call production functions. Interface code handles input selection, invocation, saved run records, and presentation.
- A person initiates live model requests and judges semantic quality. Agent checks cover input preparation, types, links, and local artifact structure.
- Keep private repositories, conversations, credentials, and run artifacts in operator-owned local directories. Repository examples use fictional data.
- Agent-operated E2E tests use a separate test directory and independent oracles.
