# Git Inspection Security Mitigation

## Scope

The original two ignored marker regressions were run and failed: status and unstaged diff executed a configured clean filter. They are now ordinary, passing tests. Status/diff reject tracked-file filter attributes before conversion. Git resolves macros, info attributes and index fallback. Driver names ambiguous with Git's attribute response keywords fail closed. Unused filter configuration remains compatible with ordinary files.

Parent comparisons skip submodule working-file dirtiness, disable summaries and use short gitlink diffs. Each discovered submodule is inspected independently. The UI and JSON/Markdown reports carry a comparison limitation notice.

All repository Git calls require the --no-lazy-fetch capability and deny every transport using GIT_ALLOW_PROTOCOL. Runtime checks and the Windows prerequisite probe also require that capability. Inherited configuration injection/redirection variables are removed. Preflight diagnostics stop comparison. Probe, preflight and execution share a 30-second deadline per guarded call; whole workspace scans contain multiple calls.

## Evidence

- Default core suite passed after the final implementation, including 19 repository tests and two submodule tests.
- Clean/process filter markers, included configuration, global configuration hidden by inherited GIT_CONFIG, ambiguous driver names, info attributes, index fallback, attribute diagnostics and a missing-object promisor helper fixture passed.
- 116 frontend tests passed, including comparison-notice rendering.
- JSON/Markdown report notice tests passed.
- Release version consistency and all three release-script tests passed.
- Workspace Clippy with warnings denied passed; Rust formatting and git diff whitespace checks passed.
- Production frontend and locked Windows NSIS builds passed.
- Browser fixture regression passed at 1280/800/600 widths, including the notice, aliases, labels and file/diff colors. Screenshots at 1280 and 600 were inspected. This uses fixture IPC, not native backend evidence.
- Independent source review by Russell found the initial lazy-fetch/version, diagnostics and deadline gaps. After those were addressed, the reviewer reported no remaining actionable findings within the stated scope. The reviewer did not independently run tests.

Installer: target/release/bundle/nsis/RepoDeck_0.1.0_x64-setup.exe

SHA-256: FF1C1896E7FDA43D1A182687FD1F4344A62AF67B7EC9F27F682F9C13B0ACDBB3

The installer was built only. The user's running installation, preferences and Windows product registration were not modified.

## Remaining Boundaries

This is not an OS sandbox or protection against concurrent malicious changes to attributes, configuration, index or metadata. Filtered/LFS comparisons are unavailable, not raw-byte approximations. Keep using trusted local repositories, configuration and Git executables. Sparse-index, unusual filesystem and older-Git rejection behavior still need wider cross-platform testing.

macOS DMGs, installer lifecycle in an isolated Windows account/VM, signing/notarization and complete dependency license notices remain pending. No claim of universal OS or Git-version compatibility is made. The tag pipeline runs filter regressions and additionally requires an explicit release-readiness approval variable; leave it unset until the documented release gates are satisfied.

## Publication

Owner selected by the user: pulkitchandra1997. Local origin is configured as https://github.com/pulkitchandra1997/repodeck.git. The public repository lookup returned 404, and Git Credential Manager had no noninteractive GitHub credential. The connector can update existing repositories but does not expose repository creation. Browser automation is unavailable due its URL-verification safety failure. Remote creation, upload, repository settings and cloud CI have not been completed. The user was asked to create an empty public repository. No tag or public release was created.
