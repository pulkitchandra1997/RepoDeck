# Versioned Downloads and Publication

## License

RepoDeck retains MIT: a short permissive license supporting commercial/private use, modification and redistribution with copyright/license notices retained. This matches the low-hurdle contribution goal and permits a future optional hosted team service. MIT does not require forks to remain open source and has no explicit patent grant. Third-party components keep their own licenses; this is not a declaration that every dependency has been legally audited.

Reference: https://choosealicense.com/licenses/mit/

## Distribution Channel

Store source and lockfiles in Git. Store installers as **GitHub Release assets**, associated with version tags and source commits. Actions artifacts are temporary CI evidence, not the permanent download channel. Do not commit installers, profiles, certificates or private repositories, and do not use Git LFS to distribute installers.

Each GitHub release asset must be smaller than 2 GiB. Build Windows x64 on Windows, and macOS ARM64/Intel on macOS runners. The workflow supplies all three targets. Hosted Actions terms/quotas depend on repository visibility and account plan; private CI is not necessarily unlimited or free.

References: https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases and https://v2.tauri.app/distribute/pipelines/github/

## Unsigned Preview Policy

The maintainer authorizes unsigned **development previews** after a reviewed PR
and successful three-target CI. This is distinct from stable readiness approval:
do not set `REPODECK_RELEASE_APPROVED` for previews. The tag workflow recognizes
only `vX.Y.Z-preview.N` with an exact matching version record whose channel is
`unsigned-preview`. Other tags keep the stable readiness gate and are also
blocked until signing/notarization is implemented. Malformed preview tags,
missing version data and failed GitHub API calls fail closed.

This preview exception supersedes the earlier blanket tagged-release block
described in [SECURITY.md](../../SECURITY.md) only for the explicit path above.
It does not waive security regressions, license obligations or OS protections.
Signing and installer lifecycle evidence remain required for stable distribution.

"Reproducible" here means a repeatable, auditable process tied to a source commit,
locked application dependencies and verified artifact digests. Hosted runner
images, Rust stable and packaging tools can change: this is **not a promise of
byte-identical rebuilds**. SHA-256 manifests are integrity records, not signatures
or attestations of a safe installer. Windows can confirm downloaded DMG bytes and
the UDIF trailer, but cannot run native `hdiutil` verification, mount the image or
inspect the macOS bundle; those checks must run on macOS before artifact upload.

## Preview Version Workflow

Apple requires `CFBundleShortVersionString` to contain three numeric components.
The pinned Tauri bundler writes its configured version literally and does not
normalize prerelease suffixes. A preview build therefore needs an explicit numeric
macOS bundle version such as `0.1.1`; do not assume that `0.1.1-preview.1` will be
converted automatically. Native DMG validation compares the value actually written
to `Info.plist` and fails before upload when it is unsupported or unexpected. The
workflow derives only this comparison value with the SemVer parser; package,
artifact and release versions retain the full prerelease string.

1. In separately authorized version work, update `package.json`, `package-lock.json` (root and root package), both Cargo package versions/Cargo.lock, and `src-tauri/tauri.conf.json` together to `X.Y.Z-preview.N`. The authorized version work may share an integration PR; authorization does not itself authorize a tag push. Add matching [version notes](preview-notes.md). Run `npm run check:release` and `npm run test:release`.
2. Review the PR and wait for required `Desktop verification` on its current revision before merging to `main`. Resolve review conversations. Automated checks prove a merged PR association, not the quality of human review; the maintainer is accountable for that review.
3. In an explicitly authorized release session, create an annotated matching `vX.Y.Z-preview.N` tag at that PR's exact merge commit, then push the new tag. The workflow requires that source to be on `origin/main` and match a merged PR's `merge_commit_sha` in this repository with base `main`. Arbitrary branch tips, unmerged commits and mismatched tags are rejected. Never move/reuse a pushed release tag; fixes need a new version.
4. The tag workflow reruns the complete three-target matrix, including security regressions, and requires `Desktop verification` before draft creation. It verifies exactly three target directories, each containing one expected installer, checksum and source manifest. Missing/extra targets or files, links, empty/oversized installers, bad digests, or differing source/version/signing metadata block creation. Downloaded target artifacts remain separate, preventing cross-target flattening collisions.
5. The workflow generates prominent Windows x64/macOS ARM64/macOS Intel links and version-specific feature/fix/limitation notes, with supplementary verification details collapsed. It creates a new **draft prerelease**, never latest or automatically public. Any existing release, including a draft, blocks reruns. It neither uploads replacements nor deletes artifacts. A failed partial draft needs maintainer inspection; prefer a fresh version rather than deleting published history. Review notes and installer evidence before deliberately publishing. Record native first-launch/lifecycle gaps honestly; use only an isolated VM/account for installer tests.
6. Enable repository release immutability where available before public release. Add all assets to the draft before publishing. See https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases.

## Stable Release Gates

The filter-safety regressions run in the default suite and again on all tags, including previews. The mitigation rejects filtered comparisons and skips implicit submodule working-file comparisons; it does not sandbox hostile concurrent metadata changes. Stable tags require `REPODECK_RELEASE_APPROVED=true` as a repository Actions variable, which must remain unset until the following readiness checks are complete. Stable distribution is additionally blocked in code until signing/notarization is implemented: setting the variable alone cannot release unsigned stable binaries. The prepared workflow is not evidence that a cloud release or macOS build has succeeded.

- Resolve high-priority security findings. Do not represent the app as safe for untrusted local Git configurations while executable-filter behavior is unresolved.
- Verify dependency distribution obligations and bundle notices/license texts for shipped Rust/frontend components. Root MIT is not a substitute for dependency notices.
- Supply Windows signing and macOS Developer ID/notarization credentials through protected secrets, never files in Git. Add signing stages and change the generated signing description only after signing is implemented and verified.
- Free Apple development signing is not notarized distribution. Unsigned Windows executables can show SmartScreen warnings. Never disable OS security controls. References: https://v2.tauri.app/distribute/sign/macos/ and https://v2.tauri.app/distribute/sign/windows/.
- Test missing-Git setup, cancel/retry, launch, upgrade/uninstall and retained preferences in a disposable VM/dedicated Windows account and on a Mac. Different installation folders or `REPODECK_DATA_DIR` do not isolate Windows registration.
- Enable private vulnerability reporting, provide a private conduct-reporting contact and configure branch protection/rulesets. Require CI and review for workflow changes.

## Installed Updates

Versioned downloads do not automatically update installed apps. No updater is implemented. A future updater needs signed metadata/artifacts, protected keys, rollback/replay policies and migration/interruption tests; this workflow does not silently enable it.
