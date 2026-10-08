# Development guide

This guide describes development support available in the repository for macOS. Choose the sections relevant to your task. Commands run from the repository root with Node.js 24 or later and npm.

## Run the application from source

To explore the application or try source changes, install locked dependencies and launch Electron:

```sh
npm ci
npm run dev
```

`dev` builds into `dist/` before launching. After source changes, quit the development instance and run the launch command again. The default launch uses the application's regular data directory; the next section describes a separate directory.

## Try changes with separate data

To keep trial settings and results in their own directory, launch with a selected data path:

```sh
BRANCHOUT_TEST_DATA="$PWD/tmp/dev-profile" npm run dev
```

The first launch creates a profile there; later launches retain its settings and records. Choose another path for fresh data. `tmp/` is ignored by Git. Continue using the same environment variable when relaunching that profile.

Selecting a separate data path defaults to review mode. Review startup keeps Telegram receiving paused; saving a Bot Token in Settings starts receiving for that instance. A fresh profile lets you configure the connections needed for the trial.

## Work with X or Xiaohongshu content

Install Google Chrome and complete each platform sign-in in Settings. Shared Chrome retains all website sessions under the selected Branchout data directory across rebuilds. Xiaohongshu optionally uses its enhanced note reader, prepared with `npm run setup:xhs`; browser reading provides the fallback.

## Check types or build output

Use the check relevant to the change:

| Purpose | Command | Result |
| --- | --- | --- |
| Run shared checks | `npm run check` | Type, documentation, and isolated-rule results |
| Run complete verification | `npm run check:full` | Shared checks, build, and application E2E evidence |
| Run application E2E | `npm run test:e2e` | Screenshots, traces, and scenario results in `test-results/` |
| Check TypeScript | `npm run typecheck` | Diagnostics and a failing exit status for type errors |
| Build the application | `npm run build` | Recreated Electron, worker, and renderer output in `dist/` |

The [test guide](../tests/README.md) defines scenario coverage and CI.

For visible behavior, launch the application using one of the options above and exercise the affected interaction. Inputs and observed results help another person repeat the check.

## Create an installation package

To try a packaged macOS ARM64 build, prepare the bundled readers and package the application:

```sh
npm run prepare:runtime
npm run package:app
```

Packaging rebuilds the application and icon, then writes DMG and ZIP artifacts to `release/`. Select an installation location locally. The [release workflow](../.github/workflows/release.yml) handles tagged GitHub releases.

## Prepare a review profile

To start with empty data, reuse trial data, or copy an inactive source profile, use the review launcher:

```sh
npm run review -- --profile /absolute/path/to/review-data
npm run review -- --profile /absolute/path/to/new-review-data --from /absolute/path/to/source-data
```

Copy preparation preserves business records. Add `--include-auth` to select supported local credentials. Review startup keeps Telegram receiving paused, including when credentials are copied; saving a Bot Token in Settings starts receiving. The launcher shows build and profile identity. Personal installation and update routines remain local.

## Refine project-analysis output

Use a persistent review profile for model settings, projects, guidance, and saved reports. In Settings, edit Analysis Goal to adjust report emphasis and wording, or Card Writing Guidance to supply concerns and examples. Save, then start a new project analysis with the same conversation selection. Each report retains the actual fixed-prompt revision and supplemental guidance snapshot.

Fixed editorial instructions and the simple Markdown example live in [the project-analysis prompt module](../src/worker/jobs/project-analysis/prompts.ts). For fixed-prompt wording changes, run `npm run build:analysis` while analysis tasks are idle, then start a new analysis in the already-open review application. Each new task forks the rebuilt worker. Protocol, main-process, and interface changes use the full build and relaunch. Changes to saved Settings guidance take effect on the next analysis.

Export actual saved reports for local comparison:

```sh
npm run review:export -- --profile /absolute/path/to/review-data --output /absolute/path/to/local-results
```

The export writes one Markdown and JSON file per report, including card suggestions, evidence, language, execution identity, and guidance. Add `--report` with a report identity to select one run. Exports contain project material and belong in private local storage. Model credentials and raw conversation files remain in the profile.

For feedback, identify the report and the paragraph, numbered supporting note, or card, describe the desired change, then compare the next run with the saved output. Wording changes use shared checks and real-model review; changes to protocol, persistence, or interaction also use application E2E.

## Verify reading with live sources

Build the application, select an inactive or independently prepared review profile with saved model and site sessions, then run:

```sh
npm run build
npx tsx scripts/development/verify-reading.ts --profile /absolute/path/to/review-data --output /absolute/path/to/reading-evidence
```

The verifier submits the three reference posts through actual Electron IPC, records each material's source, translation, summary and state, and saves reading screenshots. The JSON identifies the real-browser and configured-model boundary. Platform failures and partial materials remain in the evidence. Review-mode Telegram receiving stays paused.

`--retry-existing` continues unfinished tasks recorded in the output directory. `--only zero`, `--only boris`, or `--only lanshu` reruns one source while retaining the other saved acceptance results.
