# Overnight Work, September 13-14

## Approved Scope

Finish independent workspace and list searches, right-aligned colored language badges, restrained UI/count colors, and file/diff line numbers. The user also authorized identifying and implementing useful low-risk improvements overnight, with fresh testing. Do not promise all v1 work or native installer/macOS validation will be finished by morning.

## Current Implementation

- Sidebar search matches workspace name/path without changing the active workspace. List search sits immediately above repository/file results. Both searches have accessible clear buttons.
- Repository language badges are right-aligned and color-grouped. Workspace selection and file counts use blue accents; Git status retains green/amber/red with text labels.
- Text previews show physical line numbers, including wrapped content; trailing newline does not invent an extra file line. Unified diff bodies have separate old/new gutters; headers and missing-side entries remain blank. Binary/loading/status messages have no gutter.
- Gutters are non-selectable and hidden from accessibility text. Copy handling strips gutter elements and retains content newlines. The numbering reader only interprets Git's ordinary unified hunk headers; combined diffs are not assigned invented line numbers.

## Evidence

Run `npm test`, `npm run test:ui`, `npm run test:repository-metadata`, and `npx tauri build --bundles nsis`. Browser verification covers 1280/800/600 widths, name/badge geometry, two search locations, alias persistence, colors, old/new diff numbers, source numbering and dark-theme screenshots. Files under `.tools/screenshots/repository-metadata-*` and `numbered-dark-*` record current visual checks. These use fixture IPC, not a newly installed application.

## Prioritized Follow-Ups

1. Audit large preview performance and long-line/large-line-number layout; add bounded rendering if measured performance requires it.
2. Expand search tests for empty results, keyboard clearing, workspace switching and preserving selection. Keep scans and filesystem contents unaffected by filtering.
3. Consider optional repository status filters (changed, conflicted, unavailable), with visible result counts and no backend writes.
4. Consider find-in-file with match navigation in the read-only preview. Preserve copying, line numbers and conflict visibility.
5. Improve missing-Git diagnostics and runtime discovery regression tests. Do not remove or install Git unattended.
6. Audit local alias editing focus, navigation during an unsaved edit, and concurrent settings saves. Preserve current aliases and user settings on all failure paths.

Keep improvements narrowly scoped and follow applicable design/approval requirements. Record verified outcomes and failures rather than treating proposals as implemented features. Build a new installer only after a coherent tested batch.

## First Overnight Audit: Diff Header Lookalikes

Found and reproduced a rendering bug: content lines beginning with `+++` or `---` inside a valid diff hunk were treated as file headers and lost their green/red colors. A new component regression test failed before the fix. Color classification now receives hunk-body context from the already-computed old/new line numbers, keeping actual headers neutral and content correctly colored.

Fresh verification: all 81 frontend tests passed. The browser fixture now includes both header-like content lines and asserts their colors and old/new line numbers at 1280/800/600 widths. The initial expanded fixture exposed an ambiguous substring locator; it was narrowed to an exact-line regex before rerunning. Current screenshots include this regression case. No Git operations or repository files were modified by the fix. Installer packaging is rebuilt separately; native lifecycle testing remains pending.

Next priority remains measuring large-preview rendering before introducing a performance abstraction, followed by alias-edit navigation and settings-save races. No new unapproved workflow was added in this audit.

## Second Overnight Audit: Alias Keyboard Focus

Reproduced three accessibility failures: saving an alias, canceling an unchanged edit, and confirming discard left keyboard focus on the page body. RepositoryAlias now remembers editing transitions and focuses its restored Custom name button only when an edit closes; initial rendering does not steal focus.

All 84 frontend tests passed on the final full-suite run. An earlier run had a workspace-removal test failure; the focused App suite (38 tests) and subsequent full suite passed without changing removal code. Keep this intermittent failure visible for future investigation rather than counting the earlier run as passing.

Browser testing uncovered a stale preview server: HTTP inspection showed port 1420 still serving the old RepositoryAlias implementation despite the changed source on disk. A separate development-server attempt stalled during dependency optimization and was canceled; its owned test processes were checked to have exited. The metadata test now builds current production assets first, starts an owned Vite preview server, and closes it and its browser afterward. It does not stop or replace the existing development server or installed application.

The fresh production-build fixture passed at 1280/800/600 widths, including all three focus-return paths, aliases across reload, diff colors and numbers, and light/dark screenshots. This remains fixture IPC, not native installation evidence. Package the verified batch without installing it. Remaining priorities: large-preview measurements, alias navigation/settings-save races, and investigation of intermittent removal-test timing.

## Third Overnight Audit: Background Refresh Feedback

Traced the earlier disappearing-error symptom to `scan`: every automatic refresh cleared the shared error and notice state before doing any work. A deterministic regression launched an editor failure, triggered the watcher, waited for the background scan, and failed because the error banner vanished. Background scans now leave existing action feedback intact; explicit refresh still clears it. Background scan failures can still report their own error.

The expanded test also saves appearance preferences, triggers another automatic refresh, and checks that Settings saved stays visible. Fresh full frontend verification passed 85 tests. The current production-build browser fixture passed at 1280/800/600; its screenshots were inspected. Those browser checks exercise general UI behavior, while the new error/notice race is covered by the deterministic component test. No native installation, system Git changes or repository writes were performed.

Keep large-preview performance measurement as the next audit task. Do not add unrelated UI features merely to increase the feature count.

## Fourth Overnight Audit: Large File Previews

A 250,000-line synthetic file (500 KB, below the backend's 1 MiB preview limit) stalled the previous browser rendering for over 60 seconds. A failing component regression also showed that every line became a DOM row. Previews now render pages of at most 1,000 lines, with first/previous/next/last navigation and explicit full-content copying. Diff numbering retains preceding hunk context. Large line-number gutters were widened and made non-wrapping after screenshot inspection revealed six-digit numbers wrapping.

Fresh frontend verification passed all 89 tests. Two watcher tests initially failed during fake-clock cleanup, including in a focused run; limiting fake timers to the debounce's setTimeout/clearTimeout APIs resolved the harness issue without changing watcher production code. Paging tests cover navigation, content changes, diff numbering across a page boundary, and clipboard success/failure.

The fresh production benchmark rendered only 1,000 rows per sample. The 250,000-line sample opened in about 93 ms at 1280 pixels and 100 ms at 600 pixels on this host, with no document overflow; last-page numbering reached 250000. The narrow screenshot was visually inspected. Results live in `.tools/preview-performance.json` and `preview-*-*.png` screenshots. These are synthetic fixture IPC results, not native installation evidence. Remaining follow-ups include alias navigation/settings-save races and expanded search edge cases.

The general fresh-build repository metadata browser suite also passed at 1280/800/600 pixels. `npx tauri build --bundles nsis` completed successfully for this batch, producing `target/release/bundle/nsis/RepoDeck_0.1.0_x64-setup.exe`. It was not installed or run; the user's existing installation remains unchanged.

## Fifth Overnight Audit: Search Keyboard Focus

Four regression cases reproduced focus falling to the document body when clearing workspace search or the repository/file/agent list filter. The conditional Clear button disappeared while it held focus. Both handlers now focus their associated input after clearing, allowing immediate keyboard entry of a replacement query. No filtering rules, selection state, scan behavior or persisted data changed.

All 92 frontend tests passed. The first production build found an unsupported Testing Library `exact` option in the new test; it was removed, and the fresh production build and metadata browser suite then passed at 1280/800/600 pixels. Browser assertions exercise workspace empty results and both Clear buttons' focus restoration. The narrow screenshot was inspected. These remain fixture IPC checks, not native installation tests.

The four focused regressions passed again after the test typing correction. Windows NSIS packaging completed successfully for this batch; the installer was built, not executed.

Next audit priorities are unsaved alias navigation and overlapping settings saves; these need deterministic reproductions before changing shared persistence. Keep native Windows/macOS installation verification pending in an isolated environment.

## Sixth Overnight Audit: Language Detection False Positives

Nine new regression cases failed before the fix. Extensionless files named `go`, `py`, or `csproj` were incorrectly treated as source/project extensions. Ordinary object lookups also returned inherited functions/objects for filenames or extensions such as `constructor`, `toString`, and `__proto__`, allowing invalid values into the language-label set. Detection now requires a dotted filename for extension matching and own-property membership in its explicit dictionaries. Real manifests and source files retain their existing behavior, including a genuine Python file alongside an unrelated extensionless `go` file.

Fresh verification passed all 101 frontend tests. The production-build browser fixture now includes the unusual filenames in its Python repository and verifies that only Python is shown. The browser suite passed at 1280/800/600 pixels with no page errors; the desktop screenshot was inspected. These are synthetic fixture IPC checks. No repository, settings, Git installation or installed app was modified.

Windows NSIS packaging completed successfully for this batch. The installer was built only, not executed.

Unsaved alias navigation and overlapping settings saves remain audit priorities, not completed fixes. Native Windows/macOS lifecycle verification remains pending in isolation.

## Seventh Overnight Audit: Fresh Git Integration Data

Created a new, independent fixture at `.tools/test-workspaces/manual-1789345481868/workspace` using `npm run fixtures:create`. Its sibling `manifest.json` records expected branch/change states; keep the sibling `support` directory for linked worktrees/submodules. The generator created 11 synthetic repositories and copied three existing public checkouts offline. No existing fixtures or user projects were overwritten.

`cargo test -p repodeck-core` completed successfully. Explicitly running the normally ignored `manual_workspace` test against the new manifest also passed: 14 repositories and 2,559 entries, with expected branches/status codes, non-Git files and agent configuration discovery. The standard suite still skips opt-in benchmarks and integration fixtures; this is not a claim that every ignored test was run.

`npm run test:private-git` passed with both HTTP and `REPODECK_TEST_TLS=1` HTTPS loopback fixtures. Anonymous and incorrect credentials were rejected, temporary credentials allowed cloning without being persisted, and RepoDeck inspected modified/untracked files after the server stopped. HTTPS additionally rejected an untrusted certificate and a hostname mismatch before HTTP authentication; trust was supplied only to the test Git processes through a temporary CA file. No system certificate store was changed. Temporary server/credential fixtures were cleaned up by their owning harness. Hosted private providers, SSH agents, native installer lifecycle and actual macOS execution remain unverified.

This pass adds test evidence and fresh reusable data, not application code. The previously built installer remains the latest application artifact; no installation or rebuild is needed for documentation-only changes. Unsaved alias navigation and overlapping settings saves remain future audit work.

The fresh production-build metadata browser suite also passed at 1280/800/600 pixels in this pass. Its 800-pixel dark-theme screenshot was inspected. These browser checks still use fixture IPC and are separate from the real Git backend tests above.

## Eighth Overnight Audit: Alias Save Coordination

A delayed-save regression failed because Settings and Pause automatic refresh stayed enabled while an alias save was pending. Both paths submit full preference snapshots, so allowing overlapping writes can replace newer preferences with stale values. Alias saves now participate in the existing application-wide saving state. RepositoryAlias also accepts that shared disabled state, preventing a second alias submission while another preference write is pending. The lock is released on both success and failure; failed saves preserve the draft.

Fresh full verification passed 103 frontend tests. Tests cover pending alias writes, the reverse overlap while an automatic-refresh preference save is pending, preserved drafts, and re-enabled controls after failure. The fresh production browser fixture deliberately holds an alias save open and asserts disabled Settings/automatic-refresh controls before releasing it. The suite passed at 1280/800/600; the desktop screenshot was inspected. These remain fixture IPC tests, not native installation evidence.

This is a UI guard for alias/preference writes, not a cross-process transaction system. Unsaved alias navigation, workspace add/remove response ordering, and multiple app instances remain separate audit work. Do not describe all persistence races as fixed.

Windows NSIS packaging completed successfully for the eighth batch. The installer was built only; the user's installed application remains unchanged.

## Final Morning Readiness Pass

Reran the full frontend suite (103 passing tests), the current production preview benchmark (250,000 lines in approximately 103-115 ms on this host, with bounded rows and no document overflow), and core Clippy with warnings denied (passed). Inspected the new narrow preview screenshot. Recorded the current installer SHA-256 and a consolidated delivery/evidence/release-gate summary in `docs/planning/morning-handoff-2026-09-14.md`. No application code changed in this pass, so the eighth batch's installer remains current. No installation was performed.

## Installation Boundaries

Follow AGENTS.md. No normal-account silent install/uninstall tests, no process-name killing, no Computer Use policy bypass, no unattended OS/security changes, and no publishing/uploading user projects. The user's installed application remains untouched. Native Windows/macOS installer flows remain explicit release gates.

Eight hourly thread follow-ups were scheduled as `repodeck-overnight-improvements`. Stop adding work after 09:00 Asia/Calcutta on September 14 and summarize tested results and remaining gaps. Execution depends on the scheduler and host being available.
