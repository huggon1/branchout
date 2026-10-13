# Worker

[Architecture](../../docs/architecture-overview.md) owns processes; [prompt flow](../../docs/agent-prompt-flow.md) owns instruction loading and recovery.

| Path | Responsibility |
| --- | --- |
| `jobs/browser/worker-entry.ts` | Browser/skill tool loop and native export |
| `jobs/forwarding/reading.ts` | Translation, fidelity correction, and introduction |
| `jobs/forwarding/worker-entry.ts` | Reading dispatch and task events |
| `pi-coding-session.ts` | Persisted sessions and explicit resource boundaries |
| `pi-runtime.ts` | Lightweight Agent calls and transcript export |
| `model-worker.ts` | Connection checks |
