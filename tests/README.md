# Application verification

This module defines the engineering-foundation test design. The implementation supplies the commands below.

## Scope and failure cases

E2E tests launch the real Electron application with a temporary profile and fictional Git repository. The renderer, preload, IPC, main services, worker jobs, and storage remain active. Controlled HTTP model responses and source fixtures replace external access.

| Scenario | Failure the check detects |
| --- | --- |
| Card creation, editing, and restart | Lost content, wrong version, or writes to another profile |
| Chinese/English switching | Lost drafts, untranslated application labels, or a language setting lost after restart |
| Submission and zero connections | Missing source persistence or a false association |
| Stage failure and retry | Lost completed stages, duplicate reports, or a retry with a different saved language |
| Analysis suggestion acceptance | Wrong target, stale-version overwrite, or duplicate acceptance |
| Runtime and profile preparation | Shared-profile writers, partial copies, copied active integrations, or credential copies without selection |

Deterministic checks cover prompt language/revision, invalid output and references, documentation links/paths/commands, and profile integrity. Each isolated rule lists its invalid cases before implementation. Application E2E assertions inspect visible state and persisted records; prompt quality uses separate real-model review.

## Commands and evidence

- `npm run check`: types, documentation, and isolated rules.
- `npm run check:full`: the shared checks, application build, and E2E.
- `npm run test:e2e`: build and run application scenarios.
- `npm run docs:check`: maintained local links, explicit source references, and npm commands.

Playwright writes scenario results, screenshots, and failure traces to `test-results/` and an HTML report to `playwright-report/`. Run metadata records the revision, dirty state, platform, and controlled-input boundary. Temporary profiles and processes are cleaned up on completion and failure. Artifacts contain fictional data.

## CI

PR CI calls the same scripts used locally. Linux runs `check`; macOS runs `check:full`. Jobs install from the lockfile, have timeouts, cancel superseded PR runs, and upload failure evidence. Repository settings select required checks. Release signing stays in the release workflow. Real model accounts and platform sign-ins are configured for separate manual trials.
