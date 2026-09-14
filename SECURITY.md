# Security Reports

Do not post credentials, private repository contents or exploitable details in a public issue. When this repository is hosted on GitHub with private vulnerability reporting enabled, use Security > Report a vulnerability. If that channel is unavailable, ask a maintainer for a private reporting channel without disclosing the vulnerability publicly.

Only the latest released version will receive security fixes. RepoDeck currently has no stable release; development builds should not be treated as hardened production software.

Development mitigation: status and diff first resolve tracked-file filter attributes without converting file contents. Comparisons requiring content filters (including LFS) are rejected, not reported as clean. Unused filter configuration does not block ordinary files. Ambiguous driver names are rejected. Parent status/diff skip submodule working-file comparisons; inspect each submodule separately. Inherited Git configuration injection variables are removed from subprocesses.

This is not an OS sandbox. Open only trusted local checkouts with trusted Git executables/configuration. The preflight and comparison are separate processes: concurrent malicious replacement of configuration, attributes, index or metadata is outside this mitigation. Partial clones, older Git versions and platform-specific helper behavior still need release review. Git is not a safe parser for arbitrary hostile repositories merely because the filter regressions pass.

Tagged release publication remains disabled until platform, security and dependency-license review is complete. The maintainer must deliberately set the repository variable `REPODECK_RELEASE_APPROVED=true` after those gates are satisfied; this variable is not proof of review by itself.

Include the version, OS, affected workflow, reproduction with non-sensitive fixtures, expected behavior and observed impact. Existing checks and remaining security limitations are documented in the verification ledger. Git credentials belong in Git/OS credential helpers, not RepoDeck preferences or reports.
