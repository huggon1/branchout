# Releasing Branchout

`main` is the integration and release branch. Development starts on a short-lived branch and reaches `main` through a pull request. CI validates the pull request and builds a temporary macOS package. After the merge, CI repeats the checks on `main`.

## Prepare a version

1. Update the version in `package.json` and `package-lock.json` on a pull request when the next release needs a new version. Review the changes and merge the pull request into `main`.
2. Wait for the `main` CI run to succeed. Confirm that the release commit is the current `main` commit.
3. Create an annotated `vX.Y.Z` tag on that commit, where `X.Y.Z` matches the package version, and push the tag.

The tag starts the [Release workflow](../.github/workflows/release.yml). It verifies the version and `main` ancestry, imports the project signing certificate from the `release-signing` environment, builds and checks the macOS DMG and ZIP, writes SHA-256 checksums, and creates a draft GitHub Release. A rerun updates assets only while the release remains a draft.

## Review and publish

Review the draft's tag, commit, release notes, DMG, ZIP, checksums, and signing result. The installation notes should describe the project-signed certificate and expected macOS first-open warning. Publish the draft after the release decision. Published releases stay associated with their tagged commit.

CI artifacts from pull requests and `main` are temporary review builds. The tag workflow produces the signed release assets and the draft visible to repository maintainers.
