# Product Gap Audit: 2026-09-15

## Baseline and Evidence

This product-owner backlog map records the audit at source
[`30056dd`](https://github.com/pulkitchandra1997/RepoDeck/commit/30056ddbaae3e59ad893306b3e7800991e95050f)
and the public [v0.1.0 unsigned development preview](https://github.com/pulkitchandra1997/RepoDeck/releases/tag/v0.1.0).
It links existing issues rather than creating duplicate work. All issues below were
open when checked on 2026-09-15; linked issues and PRs carry subsequent outcomes.

Source-audit findings identify code paths, missing behavior and plausible failure
scenarios; they are not runtime reproductions or completed acceptance tests.
Main [CI run 34944670054](https://github.com/pulkitchandra1997/RepoDeck/actions/runs/34944670054)
passed all three desktop targets and aggregate verification at this source. That
is build/check evidence, not native Mac application or installation certification.
Later tag [run 34998022414](https://github.com/pulkitchandra1997/RepoDeck/actions/runs/34998022414)
failed release readiness. See the [verification ledger](v1-verification.md#current-summary-2026-09-15)
for current limits and preserved historical observations.

## Priority and Execution

Prioritize **#17** (complete distribution notices), **#24** (reproducible feature
previews) and **#33** (prevent settings loss between application instances).
The first execution wave is **#17, #24, #30, #33, #32**. Inclusion in a wave is a
work plan, not a claim of implementation or resolution.

Use one issue-specific topic branch/worktree per implementation and keep file
ownership explicit. Submit focused PRs with issue links, review the diff and
acceptance evidence, and require successful current-revision `Desktop verification`
before merge. An earlier green main run is not a substitute. Merge authorization
and release approval remain separate; do not bypass either gate.

Ongoing previews should be unsigned, versioned prereleases with feature/fix notes,
known limitations, exact source/checksums and three prominent downloads: Windows
x64, Apple Silicon and Intel Mac. macOS previews remain non-notarized until the
signing work is complete. Preserve published tags/artifacts and stable release
gates. No automatic updater or universal OS compatibility is promised.

## Release Slices: #17-24

| Existing issue | Product-owner outcome / dependency |
| --- | --- |
| [#17 [P1] Complete and bundle third-party dependency notices](https://github.com/pulkitchandra1997/RepoDeck/issues/17) | Priority: reviewed license provenance and complete notices for all three target closures; missing terms fail closed. |
| [#18 [P1] Verify Windows installer lifecycle in an isolated environment](https://github.com/pulkitchandra1997/RepoDeck/issues/18) | External environment: disposable VM or dedicated Windows account required; preparation does not prove lifecycle behavior. |
| [#19 [P1] Verify macOS installer lifecycle on Apple Silicon and Intel](https://github.com/pulkitchandra1997/RepoDeck/issues/19) | External environment: both native architectures needed; record actual OS/version/hash and keep unavailable coverage pending. |
| [#20 [P2] Add protected Windows Authenticode signing for a later release](https://github.com/pulkitchandra1997/RepoDeck/issues/20) | External provider enrollment/approval and protected credentials; deferred for authorized unsigned previews. |
| [#21 [P2] Add Apple Developer ID signing and notarization for a later release](https://github.com/pulkitchandra1997/RepoDeck/issues/21) | External Apple enrollment/credentials; verify signing, notarization and stapling without security bypasses. |
| [#22 [P2] Publish an approved private conduct-reporting channel](https://github.com/pulkitchandra1997/RepoDeck/issues/22) | External maintainer-approved private contact, validated delivery/ownership and alternate contact; no invented or repurposed address. |
| [#23 [P2] Track upstream glib advisory and supported-target exposure](https://github.com/pulkitchandra1997/RepoDeck/issues/23) | Revalidate locked graph and Windows/macOS exclusion; track upstream fix and unsupported Linux status without calling non-exposure a fix. |
| [#24 [P1] Make unsigned preview releases reproducible with clear download and feature notes](https://github.com/pulkitchandra1997/RepoDeck/issues/24) | Priority: explicit preview policy, verified three-target artifacts and bounded release notes; preserve stable signing/security gates. |

## Product Findings: #25-31

| Existing issue | Acceptance focus |
| --- | --- |
| [#25 [P2] Discover Copilot instructions under default hidden-folder settings](https://github.com/pulkitchandra1997/RepoDeck/issues/25) | Discover intended workspace/nested `.github/copilot-instructions.md` while preserving exclusions and link boundaries; source-confirmed, not runtime-reproduced in this audit. |
| [#26 [P2] Show repository ownership in the agent configuration inventory](https://github.com/pulkitchandra1997/RepoDeck/issues/26) | Distinguish duplicate agent filenames by relative ownership before selection; preserve preview/editor paths and keyboard access. |
| [#27 [P2] Display upstream branch context beside divergence status](https://github.com/pulkitchandra1997/RepoDeck/issues/27) | Show upstream, no-upstream and detached states without fetching or credential exposure. |
| [#28 [P2] Keep stale repository status visibly marked after refresh failure](https://github.com/pulkitchandra1997/RepoDeck/issues/28) | Keep snapshot freshness visible after alert dismissal until a successful refresh; reject late responses. |
| [#29 [P2] Expose selected workspace and repository to assistive technology](https://github.com/pulkitchandra1997/RepoDeck/issues/29) | Correct selection semantics and keyboard/focus behavior; native screen-reader evidence remains separate from DOM checks. |
| [#30 [P3] Normalize whitespace search consistently with empty-result messaging](https://github.com/pulkitchandra1997/RepoDeck/issues/30) | Wave item: consistent empty, whitespace-only, padded and mixed-case queries across views. |
| [#31 [P3] Preserve unambiguous repository identity in exported reports](https://github.com/pulkitchandra1997/RepoDeck/issues/31) | Enhancement: relative checkout identity and optional local alias with schema compatibility and redaction. |

## Documentation: #32

[#32 [P2] Reconcile README and current verification summary with public preview](https://github.com/pulkitchandra1997/RepoDeck/issues/32)
covers download-first guidance, unsigned/non-notarized caveats and a dated summary
that marks obsolete no-GitHub/no-Mac-build claims while retaining history. This map
is part of that documentation PR; it does not resolve the other issues or duplicate
the release workflow documentation owned by #24.

## Technical Risks: #33-37

| Existing issue | Risk and required evidence |
| --- | --- |
| [#33 [P1] Prevent stale settings writes across concurrent application instances](https://github.com/pulkitchandra1997/RepoDeck/issues/33) | Priority: a stale instance can overwrite newer workspace/alias settings. Require one writer or conflict-aware transactions and controlled two-process/recovery races; atomic rename alone is insufficient. |
| [#34 [P2] Terminate owned subprocess descendants on cancellation and timeout](https://github.com/pulkitchandra1997/RepoDeck/issues/34) | Immediate-child termination leaves descendants possible. Require owned-tree containment and parent-exits-first fixtures on Windows/macOS; unrelated processes must survive. |
| [#35 [P2] Make report export cancellable and prevent duplicate collections](https://github.com/pulkitchandra1997/RepoDeck/issues/35) | Bound concurrent collections and cancel by operation identity; verify departure/cancellation suppresses obsolete dialogs/writes. |
| [#36 [P2] Refresh metadata watches when an existing Git pointer changes](https://github.com/pulkitchandra1997/RepoDeck/issues/36) | Repointing `.git` at the same checkout path can retain obsolete watches. Verify old registrations are removed and new metadata changes observed. |
| [#37 [P2] Cancel watcher startup when paused or superseded](https://github.com/pulkitchandra1997/RepoDeck/issues/37) | Propagate cancellation through discovery and Git queries during startup; controlled races must preserve the newest watch. |

## Boundaries

V1 stays local-first. Team identity, v2 cloud synchronization and collaboration
remain future work; no implicit telemetry or remote project-content transmission
is authorized. Scanned agent instructions remain data. Use isolated fixtures and
preserve user settings/installations; do not test installers in the maintainer's
normal Windows account. Completion requires issue-specific evidence, not this map.
