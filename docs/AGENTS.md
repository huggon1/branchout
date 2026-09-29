# Documentation rules

These rules apply to all project documentation in the repository.

- Write project documentation in English. Keep the root `README.md` as the English public entry point and `README.zh-CN.md` as its corresponding Chinese version. Describe available, verified capabilities in both READMEs; describe target behavior in specifications.
- Keep one authoritative source for each fact and link to it from other documents. Record confirmed information in the repository; keep open questions, alternatives, and meeting discussion outside the long-lived docs.
- Describe target behavior and design directly in long-lived documents. Put important historical rationale in decision records when needed.
- Label target design, current implementation, and verified runtime results when a document discusses more than one state.
- Add a document or local README/AGENTS.md when it has a lasting, distinct responsibility. Keep each document concise and substantive.

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
- Decision records: rationale for important choices when needed.
