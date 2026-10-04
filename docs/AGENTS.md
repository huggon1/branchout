# Documentation rules

These rules apply to all project documentation in the repository.

- Write project documentation in English. Keep the root `README.md` as the English public entry point and `README.zh-CN.md` as its corresponding Chinese version. Describe available, verified capabilities in both READMEs; describe target behavior in specifications.
- Keep one authoritative source for each fact and link to it from other documents. Record confirmed information in the repository; keep open questions, alternatives, and meeting discussion outside the long-lived docs.
- Describe target behavior and design directly in long-lived documents. Put important historical rationale in decision records when needed.
- Label target design, current implementation, and verified runtime results when a document discusses more than one state.
- Add a document or local README/AGENTS.md when it has a lasting, distinct responsibility. Keep each document concise and substantive.
- When code changes documented behavior, paths, or commands, review the owning documents in the same change. Record the updated documents or the evidence that their existing descriptions remain accurate in the PR.
- Validate maintained local links, explicit repository paths, and documented npm script names through the documentation check. Operation claims use results from the current checkout; examples and generated paths carry their respective scope.
- Give temporary demos and investigation material an owning task and a retirement condition. At acceptance, remove fulfilled temporary material and repair inbound references; durable tools retain a distinct documented responsibility.
- Keep contributor-specific installation paths, profile aliases, credentials, and runtime records in local configuration or verification artifacts. Public development documentation describes shared capabilities and their inputs. Personal workflow instructions remain local.

Document responsibilities:

- Root READMEs: public positioning, current capabilities, and usage in English and Chinese.
- Root AGENTS.md: repository rules and documentation routing.
- docs/AGENTS.md: documentation governance.
- [Product specification](product-spec.md): feature scope and business rules; authority for target product behavior.
- [UX specification](ux-spec.md): flows, information hierarchy, and page behavior.
- [Design contract](../design.md): shared visual and interaction rules.
- [Architecture overview](architecture-overview.md): system relationships, runtime boundaries, and data ownership.
- [Data contracts](data-contracts.md): cross-module fields, persistence boundaries, and message conventions.
- Module READMEs: local responsibilities, dependencies, and key file layout.
- [Development guide](development.md): optional repository-supported help, organized by use case with commands and key behavior.
- [Test guide](../tests/README.md): verification scope, controlled inputs, evidence, and CI.
- Decision records: rationale for important choices when needed.
