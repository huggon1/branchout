# Documentation

- Write maintained documentation in English, with `README.zh-CN.md` corresponding to the English README.
- Keep each fact in one owning document. Link to it from other documents.
- Describe objects, triggers, and results directly. Distinguish target behavior, current implementation, and recorded runtime evidence.
- Update the owning document with the code change. Validate local references through `npm run docs:check`.
- Keep temporary review artifacts local, with an owning task and a retirement condition.

| Document | Responsibility |
| --- | --- |
| Root READMEs | Product entry, current capabilities, and usage |
| [Product specification](product-spec.md) | Behavior and page ownership |
| [UI design](ui-design.md) | Page identity, content hierarchy, adaptive layout, and review evidence |
| [Architecture](architecture-overview.md) | Processes, execution paths, and module boundaries |
| [Data contracts](data-contracts.md) | Saved fields, message identities, and reset boundaries |
| [Prompt flow](agent-prompt-flow.md) | Prompt and tool loading |
| [Development](development.md) | Running, isolated data, and packaging |
| [Test guide](../tests/README.md) | Verification scope and evidence |
| Module READMEs | Local responsibilities and source navigation |
