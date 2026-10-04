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

When trying one of these sources, prepare its reader:

| Source | Command |
| --- | --- |
| X | `npm run setup:x` |
| Xiaohongshu | `npm run setup:xhs` |
| Both | `npm run prepare:runtime` |

The downloaded readers reside in `.runtime/`. Complete the corresponding sign-in in application Settings.

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
