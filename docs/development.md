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
BRANCHOUT_TEST_DATA="$PWD/tmp/dev-profile" npm run dev
```

The selected directory retains its records across launches. A separate path defaults to review mode, with Telegram receiving paused during preparation. Saving a Bot Token starts receiving for that instance.

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

## Prepare a review profile

```sh
npm run review -- --profile /absolute/path/to/review-data
npm run review -- --profile /absolute/path/to/new-review-data --from /absolute/path/to/source-data
```

Copy preparation requires an inactive source and preserves current-generation records. `--include-auth` selects supported credentials. Review startup keeps Telegram paused until configured in that instance. The launcher displays build and profile identity.

## Verify the search-first workspace

Use a review profile with the intended model and platform sessions. Submit a question, read both platform sections and source links, save a follow, add a candidate to parsing, stop active work, and export its Pi logs. Check partial-platform results and English output. Record inputs, screenshots, saved state, and observed failures in a local acceptance directory. [Product behavior](product-spec.md) defines expected outcomes.

## Verify reading with live sources

Submit a public source link in Parsed Results. Inspect source coverage, translated body, introduction, and direct references. The [reading helper](../scripts/development/verify-reading.ts) submits through Electron IPC and exports saved material:

```sh
npm run build
npx tsx scripts/development/verify-reading.ts --profile /absolute/path/to/review-data --output /absolute/path/to/reading-evidence
```

The helper's `--help` lists sample selection. `--retry-existing` exercises the retained internal recovery API; user-facing flows use new submission and Stop.

## Release preparation

The release line starts at 0.1.0. Tag `v<package version>` from main after verification. The [Release workflow](../.github/workflows/release.yml) checks tag/version equality and main ancestry, then prepares a draft GitHub Release. Publishing the reviewed draft makes its stable version available to installed clients. A manual workflow run produces package verification and upgrade evidence.

macOS packages use the fixed project certificate named `Branchout Release Signing` in the `release-signing` environment. `MAC_CSC_LINK` holds the base64 P12, `MAC_CSC_KEY_PASSWORD` unlocks it, and `MAC_CERT_SHA256` identifies the expected certificate. Keep the same certificate and private key for later releases so native updates satisfy the installed application's signing requirement. This project signature is separate from Apple Developer ID and notarization. macOS may require first-open approval in Privacy & Security for the downloaded application.

Required assets are the ARM64 DMG and ZIP, `latest-mac.yml`, generated blockmaps, `SHA256SUMS.txt`, and `build-manifest.json`. The package manifest records the source revision and artifact hashes. The draft job verifies checksums before uploading assets. Historical CI evidence remains in Actions; a packaging run replaces its generated local output.

In a manual workflow run, `npm run prepare:upgrade` builds signed 0.1.0 and trial 0.1.1 packages. A separate, fresh macOS runner uses `npm run test:upgrade` to serve a local feed and exercise production check, download, native installation, and restart. Its bootstrap fixes an isolated profile across native restarts. The acceptance runner verifies that project signing material is absent from its keychains. Evidence is written to `.tmp/signed-upgrade/evidence/` and uploaded by the workflow. The trial version belongs to verification artifacts; package.json remains 0.1.0. [Update behavior](product-spec.md#application-updates) defines runtime acceptance.

Manual runs can reuse `package_run_id` after source validation confirms matching production inputs. Changes to application code, dependencies, assets, or packaging select a fresh package pair.
