# Versioned Downloads and Publication

## License

RepoDeck retains MIT: a short permissive license supporting commercial/private use, modification and redistribution with copyright/license notices retained. This matches the low-hurdle contribution goal and permits a future optional hosted team service. MIT does not require forks to remain open source and has no explicit patent grant. Third-party components keep their own licenses; this is not a declaration that every dependency has been legally audited.

Reference: https://choosealicense.com/licenses/mit/

## Distribution Channel

Store source and lockfiles in Git. Store installers as **GitHub Release assets**, associated with version tags and source commits. Actions artifacts are temporary CI evidence, not the permanent download channel. Do not commit installers, profiles, certificates or private repositories, and do not use Git LFS to distribute installers.

Each GitHub release asset must be smaller than 2 GiB. Build Windows x64 on Windows, and macOS ARM64/Intel on macOS runners. The workflow supplies all three targets. Hosted Actions terms/quotas depend on repository visibility and account plan; private CI is not necessarily unlimited or free.

References: https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases and https://v2.tauri.app/distribute/pipelines/github/

## Version Workflow

1. Update `package.json`, `package-lock.json` (root and root package), both Cargo package versions/Cargo.lock, and `src-tauri/tauri.conf.json` together. Run `npm run check:release` and `npm run test:release`.
2. Merge reviewed, tested changes to `main`. Run frontend/core tests, browser checks and native release-gate tests.
3. Create an annotated matching tag, for example `git tag -a v0.1.0 -m "RepoDeck 0.1.0 development preview"`, then `git push origin v0.1.0`. Never reuse a published tag; fixes need new versions.
4. The tag workflow checks versions, builds with locked Cargo dependencies and creates a **draft prerelease** only after all three matrix jobs succeed. Assets have architecture-specific filenames, SHA-256 files and source-commit JSON manifests. Existing releases are not overwritten; failed/retried drafts require deliberate maintainer handling.
5. Review and test all installers before publishing the draft. The current workflow creates unsigned development builds, not automatically published stable releases.
6. Enable repository release immutability where available before public release. Add all assets to the draft before publishing. See https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases.

## Stable Release Gates

The filter-safety regressions now run in the default suite and again on tags. The mitigation rejects filtered comparisons and skips implicit submodule working-file comparisons; it does not sandbox hostile concurrent metadata changes. Tagged publication also requires `REPODECK_RELEASE_APPROVED=true` as a repository Actions variable, which must remain unset until the following readiness checks are complete. The prepared workflow is not evidence that a cloud release or macOS build has succeeded.

- Resolve high-priority security findings. Do not represent the app as safe for untrusted local Git configurations while executable-filter behavior is unresolved.
- Verify dependency distribution obligations and bundle notices/license texts for shipped Rust/frontend components. Root MIT is not a substitute for dependency notices.
- Supply Windows signing and macOS Developer ID/notarization credentials through protected secrets, never files in Git. Add signing stages and change the generated signing description only after signing is implemented and verified.
- Free Apple development signing is not notarized distribution. Unsigned Windows executables can show SmartScreen warnings. Never disable OS security controls. References: https://v2.tauri.app/distribute/sign/macos/ and https://v2.tauri.app/distribute/sign/windows/.
- Test missing-Git setup, cancel/retry, launch, upgrade/uninstall and retained preferences in a disposable VM/dedicated Windows account and on a Mac. Different installation folders or `REPODECK_DATA_DIR` do not isolate Windows registration.
- Enable private vulnerability reporting, provide a private conduct-reporting contact and configure branch protection/rulesets. Require CI and review for workflow changes.

## Installed Updates

Versioned downloads do not automatically update installed apps. No updater is implemented. A future updater needs signed metadata/artifacts, protected keys, rollback/replay policies and migration/interruption tests; this workflow does not silently enable it.
