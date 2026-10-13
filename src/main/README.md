# Main process

[Architecture](../../docs/architecture-overview.md) owns runtime boundaries; [data contracts](../../docs/data-contracts.md) owns persistence.

| Path                                                                                                  | Responsibility                                               |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `services.ts`, `main.ts`, `window.ts`, `preload.ts`                                                   | Service assembly, lifecycle, windows, and renderer bridge    |
| `services/focus-search/`                                                                              | Search admission, follow scheduler, and candidate submission |
| `services/forwarding/`                                                                                | Collection orchestration and reading queue                   |
| `services/tasks/`                                                                                     | Task snapshots and native Pi export                          |
| `services/platform-access.ts`                                                                         | Capture and material validation                              |
| `services/browser-agent.ts`                                                                           | Browser and skill tool bridge                                |
| `services/platform-browser.ts`                                                                        | Shared Chrome operations and access lock                     |
| `integrations/telegram/`                                                                              | Authorization, receipts, and acknowledgments                 |
| `services/application-updates.ts`, `services/electron-update-driver.ts`, `services/execution-gate.ts` | Update state, native validation, and execution admission     |
| `services/model-service.ts`                                                                           | Model connections and execution leases                       |
| `runtime/business-reset.ts`, `runtime/profile.ts`                                                     | Generation reset and profile preparation                     |
| `storage/`                                                                                            | Atomic local stores                                          |
