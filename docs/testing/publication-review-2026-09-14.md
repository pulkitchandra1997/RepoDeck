# Publication Review: September 14, 2026

Two independent code reviewers examined frontend workflows and Rust/native inspection. Findings were reproduced with isolated fixtures. The coordinator reviewed the changes and reran integration checks. No installed application lifecycle testing occurred.

## Unresolved Release Blocker

**P1: configured Git clean filters execute during inspection and unstaged diff.** Git status/diff can perform content conversion, even when external diff and filesystem-monitor execution are disabled. Tests in `crates/core/tests/repository.rs` configure a harmless marker command in disposable repositories. Both safety assertions failed when explicitly executed by the reviewer and coordinator. This is not merely a static hypothesis.

Run `cargo test --locked -p repodeck-core --test repository does_not_execute_clean_filters -- --ignored --nocapture` to reproduce. These tests are ignored in the default suite but are mandatory for tag/release CI, which therefore blocks release creation until a proper mitigation passes. Do not remove the gate to force publication.

Only trusted checkouts/configurations should be opened in development builds. A mitigation must consider clean/process drivers, global and included configuration, submodule subprocesses and LFS compatibility. Silently changing filtered-file semantics or disabling user security controls is not an acceptable fix.

## Repaired Findings

| Severity | Finding | Repair |
| --- | --- | --- |
| P1 | `core.worktree` could redirect inspection outside the authorized checkout | Validate the canonical effective root before Git operations and bind commands to the selected checkout; legitimate linked-worktree metadata remains supported. |
| P2 | Pending aliases and Add/Remove workspace could race, replacing UI state with older snapshots | Extend the existing saving guard to workspace mutations. |
| P2 | Navigation discarded unsaved aliases | Keep drafts by canonical checkout identity in App, outside the transient inspector. |
| P2 | Partial scan results unmounted the editor and lost drafts | The same lifted draft state survives scan-driven unmounts. |
| P2 | Workspace removal completion used a stale active ID | Validate the current active ID with a functional state update against the returned workspace list. |

Drafts remain memory-only and do not survive app restart. The saving guard is not cross-process concurrency control. These scoped fixes do not claim a complete application security audit.

## Verification

- Full frontend suite: 115 tests passed.
- Release script tests: three passed, including version/tag mismatch, architecture naming, checksums, missing/empty/duplicate bundles and overwrite rejection.
- Default core tests passed, including new redirected-worktree checks and existing linked-worktree/submodule cases. Opt-in tests are not implicitly counted as run.
- Two explicit filter-safety tests failed as described above. Consequently, release readiness is **blocked**, regardless of the passing default suites.
- Production-build browser suite passed at 1280/800/600 with fixture IPC.
- Color check: 72 combinations passed; minimum contrast 4.84:1. Not a full accessibility certification.
- Rust formatting and workspace Clippy with warnings denied passed.
- npm audit reported zero known advisories for current production and development JavaScript dependencies. Rust advisory scanning and complete dependency-license verification remain outstanding; Clippy is not a vulnerability scan.

## Publication Status

The updated Windows NSIS installer built successfully using locked Cargo dependencies. Its SHA-256 is `F68CA3B40034F28197ADB2C564F60785B037FE34840A27B6568DEADCB9EEC811`; it remains local at `target/release/bundle/nsis/RepoDeck_0.1.0_x64-setup.exe`, was not executed, and is not a safe-for-untrusted-checkouts release. The browser screenshot was inspected. No DMG was built on this Windows host.

The initial staged inventory excludes generated directories, `.tools` test data, installers, environment files and private-key extensions. A limited staged-text scan found no common GitHub/OpenAI token patterns or private-key headers. This is not an exhaustive secret audit. Historical trailing blank lines remain in several original documents; other staged whitespace checks passed. YAML was manually inspected, but GitHub Actions itself has not run and cloud runner compatibility is unverified.

Local Git was initialized on `main`. MIT metadata, ignore rules, source-path redaction, a pinned-actions CI/release workflow and a release guide were prepared. No release tag was created, because the security gate is still failing.

Repository creation/remote push still needs the owner/visibility choice and a working creation/authentication route. The connected GitHub profile is available, but its connector lacks repository creation. Browser automation failed to initialize after a normal reset/retry; the failure was not bypassed. No remote repository, GitHub release or DMG build is claimed here.
