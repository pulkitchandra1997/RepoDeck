# RepoDeck V1 Implementation Plan

**Goal:** Deliver an installable Windows and macOS workspace manager meeting the product requirements, with real Git and installer verification.

**Architecture:** Tauri desktop shell, React/TypeScript UI, Rust local services. Git operations use argument arrays and existing credential helpers. Local identity and service boundaries allow optional team collaboration in v2.

**Spec:** ../../product/requirements.md

## Constraints

- Windows 10+; macOS 12+ with Intel and Apple Silicon packaging.
- No required account or cloud service. No automatic repository script execution.
- Show Git and non-Git files, nested repositories, agent configuration and status.
- Never represent fixture tests as authenticated private-host or installer verification.

## Execution

- [ ] Native Git adapter: `crates/core/src/git.rs`, tests in `crates/core/tests/git_status.rs` and `repository.rs`. Test NUL-delimited paths, renames, conflicts, detached and unborn branches, worktrees, remotes, text diffs and credential redaction. Run `cargo test -p repodeck-core` before and after each implementation.
- [ ] Workspace scanner: `crates/core/src/scanner.rs`, `tests/scanner.rs`. Temporary on-disk fixtures cover nested repositories, exclusions, inaccessible paths, symlinks, agent files, cancellation and progressive events.
- [ ] Persistence and settings: `crates/core/src/settings.rs`, `tests/settings.rs`. Persist stable local IDs and preferences atomically; test restart, corrupt settings and migration. Define metadata-only sync port, disabled in v1.
- [ ] Desktop commands: `apps/desktop/src-tauri/`. Restrict filesystem operations to selected workspaces, run blocking work off the UI thread, and test path traversal and symlink escapes. Add folder picker, export, editor/terminal and remote opening.
- [ ] React UI: `apps/desktop/src/`. Workspace sidebar, repository matrix, file tree, diff inspector, agent inventory and settings. Test loading, empty, partial-error and populated views, filters, keyboard access, themes and narrow window layouts.
- [ ] Git integration: support local folders and public/private HTTPS/SSH remotes without provider restrictions. Test public open-source GitHub repositories and authenticated local remote operations; record separately any untested private-host integration.
- [ ] Packaging: Windows NSIS, macOS DMG for both architectures, checksums, CI artifacts and source build instructions. Test packaged launch, folder selection, persistence, exports and uninstall in clean OS environments.
- [ ] Open source: license, contributing, security policy, issue/PR templates and architecture decision records.
- [ ] Completion audit: map every product requirement to implementation and direct evidence. Record unavailable macOS, private-provider or independent-agent checks as outstanding.

## Current Evidence

- Initial workspace contained documentation only.
- Windows C++ build tools detected. Rust installation started.
- No independent subagent execution tool is exposed in this session; independent agent reviews remain outstanding.
