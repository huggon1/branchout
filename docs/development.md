# Development guide

Commands run from the repository root with Node.js 24 or later and npm.

## Run the application from source

```sh
npm ci
npm run dev
```

`dev` builds `dist/` and launches Electron. Quit and rerun after source changes. The default launch uses regular application data. This refactor clears prior-generation test business records at startup and preserves connections and platform sessions through the [reset contract](data-contracts.md#telegram-queue-and-business-reset).

## Try changes with separate data

```sh
POSTROVE_TEST_DATA="$PWD/tmp/dev-profile" npm run dev
```

The selected directory retains its records across launches. A separate path defaults to review mode, with bot receiving paused during preparation. Saving bot credentials starts the selected receiver for that instance.

## Work with X or Xiaohongshu content

Install Google Chrome and sign in through Settings. Shared Chrome retains sessions under the selected profile. `npm run setup:xhs` prepares the optional Xiaohongshu note reader; browser capture provides fallback.

## Check types or build output

`npm run typecheck` reports TypeScript diagnostics. `npm run build` rebuilds Electron, workers, and the renderer. The [test guide](../tests/README.md) owns the verification commands and evidence scope.

## Create an installation package

```sh
npm run prepare:runtime
npm run package:app
```

Packaging clears generated `release/` output, rebuilds the app and icon, and writes ARM64 DMG, ZIP, update manifests, blockmaps, and checksums. The cleanup also retires the obsolete bird-search runtime.

## Create a Windows installation trial

Use a native Windows x64 host with Node.js 24 or later, npm, Git, and Google Chrome. Run from the repository root:

```powershell
npm ci
npm run check:full
npm run prepare:runtime
npm run package:windows
npm run test:package
npm run test:windows-installation
```

The package command generates `release/Postrove-<version>-win-x64.exe`, blockmaps, `build-manifest.json`, and `SHA256SUMS.txt`. The unsigned NSIS installer targets the current user and includes the Windows Xiaohongshu reader. The application carries its runtime. Installed users prepare Chrome and their model and platform connections through Settings.

The Windows job in [Checks](../.github/workflows/checks.yml) builds and verifies the trial on Windows Server 2025. Its `postrove-windows-x64-trial-<revision>` artifact holds the installer and checksums for fourteen days. Download and extract the artifact, then open the installer. Windows can show a publisher or reputation prompt for this unsigned trial. Windows Smart App Control and managed-device policies can block unsigned executables, as described in [Microsoft's distribution guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation). The [trial acceptance](../tests/windows-trial-failures.md) defines automated and live evidence.

Application updates remain disabled in the trial. A replacement installer retains the workspace. The installation check uses a separate profile and paths containing Chinese characters and spaces. Its screenshots and JSON results enter `.tmp/windows-installation/`. Real Windows 11 client use establishes the installation experience, live platform access, and display behavior.

## Prepare a review profile

```sh
npm run review -- --profile /absolute/path/to/review-data
npm run review -- --profile /absolute/path/to/new-review-data --from /absolute/path/to/source-data
```

Copy preparation requires an inactive source and preserves current-generation records. `--include-auth` includes supported credentials, including the native Pi connection directory and its model catalogs. Review startup keeps bot receiving paused until the selected connection is configured or verified in that instance. The launcher displays build and profile identity.

## Verify the search-first workspace

Use a review profile with the intended model and platform sessions. Submit a question, read both platform sections and source links, save a follow, add a candidate to parsing, stop active work, and export its Pi logs. Check partial-platform results and English output. Record inputs, screenshots, saved state, and observed failures in a local acceptance directory. [Product behavior](product-spec.md) defines expected outcomes.

## Verify reading with live sources

Submit a public source link in Parsed content. Inspect source coverage, translated body, introduction, and direct references. The [reading helper](../scripts/development/verify-reading.ts) submits through Electron IPC and exports saved material:

```sh
npm run build
npx tsx scripts/development/verify-reading.ts --profile /absolute/path/to/review-data --output /absolute/path/to/reading-evidence
```

The helper's `--help` lists sample selection. `--retry-existing` exercises the retained internal recovery API; user-facing flows use new submission and Stop.

## Release preparation

After local packaging, `npm run test:package` launches the packaged executable with separate data, checks startup and restart, and saves evidence under `.tmp/package-verification/`. Options `--app` and `--output` select other package and evidence paths.

The [release guide](releasing.md) owns approval, signing, assets, and GitHub publication. Its manual verification workflow uses `npm run prepare:upgrade` to build a signed pair and `npm run test:upgrade` to verify native replacement and restart. Evidence enters `.tmp/signed-upgrade/evidence/` and workflow artifacts.
