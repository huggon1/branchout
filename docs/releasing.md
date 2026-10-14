# Releasing Postrove

This document owns release preparation and publication. The [development guide](development.md) owns source launch and local packaging; [tests](../tests/README.md) owns automated acceptance scope.

## Prepare a release

1. Finish the release PRs and review both READMEs and `docs/releases/<version>.md`. Set the same stable version in package.json and package-lock.json.
2. Merge the reviewed changes into main and confirm its Checks workflow passes.
3. Run the [Release workflow](../.github/workflows/release.yml) manually on that revision. It builds the signed installation package, verifies packaged startup, and exercises a signed native upgrade on a fresh macOS runner.
4. Record the source revision, workflow runs, package identity, screenshots, live trials, and remaining acceptance items in a local release evidence directory.
5. Obtain publication approval from the release owner, then tag the approved main revision as `v<version>` and push the tag. The tag run creates a GitHub Release draft with reviewed notes and verified attachments.

The first release is 0.1.0. Later manual verification builds the current package version and a trial version with the next patch number. Trial packages stay in Actions artifacts. Manual runs produce evidence; tag runs produce a Release draft.

## Signing and assets

macOS packages use the fixed project certificate in the `release-signing` environment. `MAC_CSC_LINK` holds the base64 P12, `MAC_CSC_KEY_PASSWORD` unlocks it, and `MAC_CERT_SHA256` identifies the expected certificate. Later releases retain the same certificate and private key so native updates satisfy the installed application's signing requirement. This is a project signature, separate from Apple Developer ID and notarization.

Published packages target macOS Apple silicon. Required attachments are the versioned DMG and ZIP, `latest-mac.yml`, generated blockmaps, `SHA256SUMS.txt`, and `build-manifest.json`. The DMG serves first installation; the ZIP and manifest serve installed clients. The build manifest records the source revision and artifact hashes. The draft job verifies checksums before upload.

Manual runs can reuse `package_run_id` after source validation confirms matching production inputs. Application code, dependencies, assets, and packaging changes select a fresh package pair. The separate native verification runner imports neither the project certificate nor its private key. Its evidence includes replacement, restart, retained records, and a session-directory marker; actual website login belongs to live acceptance.

## Acceptance and publication

Download the draft's DMG from GitHub on a macOS Apple silicon machine. Move Postrove to Applications, then verify first launch and the system's first-open approval path. A project-signed build may require approval in System Settings → Privacy & Security → Open Anyway. [Apple's guide](https://support.apple.com/en-us/102445) describes that approval and its security implications.

Connect a model and sign in to the platforms used for acceptance. Exercise X Grok and Xiaohongshu 点点 AI search, read original answers and source links, add a source to parsing, and parse a GitHub README. Record source coverage, a partial or access-limited outcome, and native Pi log export. Restart and check saved reports and sessions. [Product behavior](product-spec.md) defines expected results.

Review the draft's version, notes, artifacts, checksums, and acceptance record. Release owner approval allows publishing the draft as a stable latest Release. Installed clients discover it through the public GitHub source. A failed package check retains the draft and its diagnostic evidence for correction. Published artifacts identify one immutable version; a correction uses a new version.

The 0.1.0 migration behavior is described in its [release notes](releases/0.1.0.md). Ongoing update choices belong to the [product specification](product-spec.md#application-updates).
