# Dependency Notice Collection

This tooling supports the dependency-notice gate in the [release guide](release-guide.md).
It collects declarations and actual dependency license/notice files. It does not
perform a legal audit, choose among alternative licenses, verify that supplied
texts satisfy every declared license, or authorize publication.

## Usage

From the repository root, with supported Node.js and Cargo on PATH:

```sh
node --test scripts/notices.test.cjs
node scripts/generate-notices.cjs THIRD-PARTY-NOTICES.json
node scripts/generate-notices.cjs --inventory dependency-inventory.json
npm run package:notices -- --target x86_64-pc-windows-msvc --bundles nsis -- --locked
```

Use a new output filename. Existing files are never overwritten. Collection must
finish before writing starts; failures exit nonzero with path-free diagnostics.
An output write failure may leave a partial file, so downstream packaging MUST
require a successful generator exit in the same build, not merely file existence.
Do not reuse a stale artifact after a failed run.

The schema-v2 UTF-8 JSON artifact contains exact names, versions, declared license
identifiers, target membership, original texts (including line endings/BOM),
SHA-256 hashes and provenance. A package can also carry a versioned source offer
whose exact crates.io archive URL and SHA-256 are verified against Cargo's cached
archive before collection succeeds. Local filenames are package-relative;
fallback texts carry immutable upstream URLs and revisions. Packages and target
membership are sorted; there are no timestamps, Cargo IDs, registry URLs or
absolute locations.
Identical inputs produce identical bytes. Conflicting evidence for the same
ecosystem/name/version is an error. `npm run test:notices` runs in CI and
`npm run notices -- OUTPUT.json` invokes strict collection.

`--inventory` is for investigation only: it writes all reachable packages and
aggregated unresolved Cargo license-text/review entries after visiting all three
targets. It exits zero when the inventory is successfully written, even when
`collectionComplete` is false. Such output MUST NOT be bundled. Malformed graphs,
unsupported declarations, invalid provenance, unreadable inputs and bounds errors
still abort without an artifact. Strict collection rejects any unresolved entry.
`collectionComplete: true` means the collector found texts and no recorded
blockers; it is not a semantic license audit or approval to distribute.
Cargo records separately expose `licenseTextAvailable`: at least one collected
license text was found. This is a presence indicator, not proof that every
component/alternative is covered. A record can have available texts and still
carry an unresolved distribution decision.

## Future Notice Packaging

[The notice-specific Tauri overlay](../../src-tauri/tauri.notices.conf.json) runs
strict collection before the frontend build and maps the fresh artifact to
`THIRD-PARTY-NOTICES.json` in the application resource directory. For example,
after the blockers below and distribution review are resolved:

```sh
npm run package:notices -- --target x86_64-pc-windows-msvc --bundles nsis -- --locked
```

Use the matching macOS target and `--bundles dmg` on macOS. The overlay invokes
`node scripts/generate-notices.cjs --bundle`, which only creates
`.tools/notices/THIRD-PARTY-NOTICES.json` after successful strict collection.
Existing output causes failure, including a previous successful output: use a
fresh isolated worktree, or deliberately remove only that generated file before
another build. Linked output directories are rejected. The build must succeed in
the same invocation; file existence alone is never a gate. Do not use a direct
`tauri bundle` invocation to bypass the pre-build collection step.

The `package:notices` command selects this overlay. It remains intentionally
opt-in while the collection is blocked. The default development/preview build and
CI do not yet bundle complete dependency notices.
Enabling this overlay for every future release and inspecting the resulting NSIS
and both DMG resources remain acceptance work after review. The existing preview
limitation remains disclosed; no current installer is certified by this change.
Never run installer/uninstaller automation in the normal Windows account.

## Coverage And Bounds

- npm: traverse dependencies, optional dependencies and peers from the lockfile
  root, resolving installed nested/hoisted packages from package-lock v3. Check
  installed name/version/dependency declarations against the lock, reject
  unlocked installed shadows and validate resolved semver constraints. Non-semver
  dependency specifications require review and fail closed. Unreachable
  development packages are excluded. Missing optional/peer packages also fail:
  this collector cannot infer their absence is safe for all release platforms.
  Workspaces, links, bundled dependencies and platform-constrained npm packages
  are unsupported and fail closed. The current frontend closure is portable;
  future native npm dependencies require an explicit per-platform design.
- Cargo: invoke `cargo metadata --locked --offline --format-version 1
  --filter-platform TARGET` separately for `x86_64-pc-windows-msvc`,
  `aarch64-apple-darwin`, and `x86_64-apple-darwin`. Traverse structured
  `resolve.nodes[].deps[].dep_kinds` from workspace `repodeck-desktop`, including
  normal and build edges and excluding dev-only edges. Workspace packages are
  treated as first-party. Do not derive coverage from the unfiltered `packages`
  array or parse `Cargo.lock` as a substitute for resolution.
- Cargo uses workspace default features. This is a conservative metadata union,
  not an exact linker inventory. Review feature changes, host/build dependencies
  in cross builds, generated/vendored native code, system libraries and assets
  separately. Target membership describes metadata traversal, not proven binary
  inclusion. Release builds with different feature flags need aligned collection
  before relying on the result. See [Cargo metadata documentation](https://doc.rust-lang.org/cargo/commands/cargo-metadata.html).
- Collection performs no installs, fetches, build scripts or shell commands. The
  development tooling uses the locked `semver` library for npm constraints. Cargo
  calls use `execFile` argument arrays, a 120-second timeout per target and a
  32 MiB output bound. Offline caches must already contain needed dependencies.
- Collect root `LICENSE`, `LICENCE`, `COPYING`, `NOTICE`, `COPYRIGHT` files and
  their dot/dash/underscore variants, recursively collect `license(s)`,
  `licence(s)` and `notice(s)` directories, and honor Cargo `license_file` paths
  contained within the crate. Unsupported layouts require investigation, not
  guessed terms or runtime downloads. A NOTICE alone does not replace license text.
- The checked-in [fallback manifest](../../scripts/license-fallbacks/manifest.json)
  contains exact upstream text strings, SHA-256 hashes, source roles and package
  review records. JSON escaping preserves source bytes, including absent trailing
  newlines, independently of checkout line-ending conversion. Source URLs are
  derived from a validated GitHub repository, a full 40-hex commit and a bounded
  relative path. Collection never follows a network URL.
- Fallback use requires the exact crate name/version/declaration, crates.io
  registry source, repository, and published `.cargo_vcs_info.json` revision/path.
  Dirty or linked provenance is rejected. No version ranges, latest tags,
  generic license substitutions or unreferenced external terms are permitted.
  Every stored text hash is validated, including entries unused on a target.
  Local notice files are still retained and validated; a fallback never masks
  empty, escaping or unreadable local evidence. Explicit `blocked` records remain
  blocking even if a local file named LICENSE appears.
- A reviewed `linkedTerms` entry can connect an external pinned license-steward
  text to a same-revision source declaration that explicitly names its URL.
  The declaration must be included as evidence, its crate-relative location must
  match the upstream path, and the installed declaration's exact hash must match.
  Both the declaration URL and official text URL remain in artifact provenance.
  This permits the explicit MPL source-header referral, not guessing from SPDX.
  URLs are evidence only; the collector never downloads them. There are at most
  32 links per package, with bounded HTTPS URLs and the existing source limits.
- The [WebView2 SDK supplement](../../scripts/license-fallbacks/webview2-sdk.json)
  holds exact LICENSE, NOTICE and nuspec text from a versioned Microsoft NuGet
  archive, its SHA-256, and all nine loader hashes. Collection validates the
  pinned crate identity, archive URL, text hashes and binary paths, then hashes
  all nine installed loader files before including `pinned-archive` texts.
  Supplemental JSON is limited to 256 KiB; each text to 128 KiB; each binary to
  16 MiB, hashed in 64 KiB chunks. Linked files/directories and changed bytes fail.
  No archive download, extraction or executable invocation occurs at collection.
- Fallback bounds: 4 MiB manifest, 128 source records, 256 package records,
  32 distinct source references per package, 2 MiB per source text and 8 MiB
  combined local/upstream text per package. The existing aggregate budget also
  accounts for the manifest and every retained fallback instance.
- Bounds: 20,000 npm lock entries, 10,000 Cargo packages/nodes per target,
  100,000 queued edges per graph, 2,048 scanned directory entries per package,
  five nested notice directories, 2 MiB per text, 8 MiB per package and 32 MiB
  for the final artifact. A separate 32 MiB collection budget counts escaped
  text and record overhead before retaining each item, conservatively including
  duplicate evidence across targets. Invalid UTF-8, empty files and escaping paths fail.
- License syntax recognizes the identifiers observed in the current locked
  closure, with parentheses, `AND`, `OR`, `WITH LLVM-exception` and Cargo's
  legacy slash separators (see `licenseIdentifier` in the generator). All
  declarations are retained verbatim. This is recognition, not approval.
  Unrecognized identifiers/exceptions, missing declarations,
  custom licenses and `SEE LICENSE IN` require review and fail closed. License
  files are copied, never synthesized from identifiers.
- Filesystem errors and Cargo stderr are not printed. Source text containing
  the checkout/package path or recognizable Windows/UNC/home-directory paths is
  rejected rather than silently altering license terms. This is not a general
  secret scanner; review the output before distributing it.

## Pinned Source Review

The fallback manifest records source-text/provenance inspections by Codex on
2026-09-15, 2026-09-16 and 2026-09-21. `text-reviewed` means that inspection only;
it does not represent independent human review or legal clearance. Twenty-two
GitHub source files at thirteen commits and three Microsoft SDK archive texts
support 22 exact crate records, including explicitly blocked evidence.

- `webview2-com@0.38.2`, `webview2-com-macros@0.8.1`, and
  `webview2-com-sys@0.38.2`: repository-root MIT text with Bill Avery's copyright.
  Published VCS revisions and workspace manifests bind it to those crates.
  The sys crate also collects Microsoft's SDK license/NOTICE after verifying every
  loader hash. Its collector gate is resolved; actual packaged notice delivery and
  separately deployed Runtime review remain pending release work. The SDK terms do
  not establish separately deployed Runtime terms.
- `alloc-stdlib@0.2.4`: Dropbox's repository-root BSD-3-Clause text, matched to
  the `alloc-stdlib/Cargo.toml` declaration at its published revision.
- Five UNIC 0.9.0 crates: actual repository-root MIT/Apache texts plus
  `COPYRIGHT.md` and the referenced `AUTHORS`. Old published VCS metadata omits
  the package path, which is explicitly recorded as null, not invented. The
  pinned manifests inspected were `unic/char/property`, `unic/char/range`,
  `unic/common`, `unic/ucd/ident`, and `unic/ucd/version` (each `Cargo.toml`).
- `defmt-parser@1.0.0`: root Apache and MIT texts (including Ferrous Systems'
  attribution), matched to `parser/Cargo.toml` at the published revision.
- Eleven `objc2` family crates: the shared `LICENSE.md` at four published
  revisions is retained as applicability evidence. A later upstream commit,
  `ee9a7ada2131f5944b8750428e265c15632f2a19`, added the project's full MIT,
  Zlib and Apache-2.0 texts to fix upstream issue #826 without changing the
  Apple SDK uncertainty. MIT-only crates collect the MIT text; declarations of
  `Zlib OR Apache-2.0 OR MIT` retain all three texts without selecting an
  alternative. The records remain blocked only on the explicitly unresolved
  Apple SDK-derived distribution rights.
- `selectors@0.36.1`: its pinned `selectors/lib.rs` explicitly refers to
  `https://mozilla.org/MPL/2.0/`. Mozilla's official plaintext download matched
  `mozilla/bedrock` commit `a15178c3c7c976c67b3641af77cae0b66093a175`,
  `media/MPL/2.0/index.txt`, byte for byte. The exact text and declaration are
  collected. The output now gives recipients the exact unmodified 0.36.1 crate
  source URL and SHA-256, which the collector verifies against Cargo's cached
  archive. This is an explicit source referral, not an SPDX-based substitution.

The [manifest](../../scripts/license-fallbacks/manifest.json) provides all exact
revisions, package paths, source texts and hashes. Inspect the upstream paths at
those commits when changing a record. Any dependency update requires new evidence;
do not relabel a blocked record merely to obtain a passing build.

## Current Evidence And Blockers

On 2026-09-21, Windows, Node.js 24.19.0 and Cargo 1.98.1, locked offline structured
metadata succeeded for all three targets (270 Windows and 264 reachable nodes for
each macOS target, including two workspace members).
This is resolution evidence, not native build or installation evidence.

The real inventory now finishes: 299 distinct package/version records (294 Cargo
and five npm). Target membership is 268 third-party Cargo packages for Windows,
262 for each macOS architecture, and five npm packages on every target.
The inventory is incomplete for distribution: 11 explicit blockers remain.
For the lockfiles inherited from `30056dd` and the branch after merging
`origin/main` at `69158c2`, the updated inventory is 3,009,040 bytes with SHA-256
`823da31db3ad1d69c7fcbc7a250e73c61af4eb2cd17c45cca75199b06804b5b0`.
All individual text hashes were recomputed and verified. Earlier September 15 and
16 artifacts are historical evidence, not the current collection.

The reachable Cargo declaration inventory uses `0BSD`, `Apache-2.0`,
`BSD-3-Clause`, `CC0-1.0`, `MIT`, `MIT-0`, `MPL-2.0`, `Unicode-3.0`,
`Unlicense`, `Zlib` and `LLVM-exception`. Current npm declarations additionally
use `ISC`. Compound expressions and legacy slash declarations are covered by
fixtures. The recognized set is not a comprehensive SPDX registry; a future
standard identifier outside it needs a parser update, not a legal-policy denial.

Collector evidence is now complete for `selectors@0.36.1` and
`webview2-com-sys@0.38.2`. The selectors record instructs recipients to obtain the
[versioned source archive](https://static.crates.io/crates/selectors/selectors-0.36.1.crate)
and verify SHA-256
`c5d9c0c92a92d33f08817311cf3f2c29a3538a8240e94a6a3c622ce652d7e00c`.
The WebView record retains the exact Microsoft.Web.WebView2 1.0.3650.58 LICENSE,
NOTICE and nuspec after byte-verifying all nine loader files. Actual resource
inspection and the chosen [Runtime deployment](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
remain pending; neither collector result is legal clearance.

1. `block2`, `dispatch2`, `objc2`, `objc2-encode`, `objc2-exception-helper`,
   `objc2-foundation`, `objc2-app-kit`, `objc2-core-foundation`,
   `objc2-core-graphics`, `objc2-io-surface`, and `objc2-web-kit`: full applicable
   upstream texts are now collected, but unresolved SDK-derived terms remain in the
   [pinned upstream evidence](https://github.com/madsmtm/objc2/blob/8852b424193ca41602281b3d7540d7c8ed51e49a/LICENSE.md).
   The referenced [relicensing issue #23](https://github.com/madsmtm/objc2/issues/23)
   remained open on September 21 with permissions outstanding. No attribution was
   removed and no license alternative was selected based on that proposal. This is
   a genuinely external legal/maintainer blocker, not missing collector machinery.

Strict collection and the notice packaging pre-build step deliberately fail.
No distributable notice artifact is claimed. Issue #17 is **not closed**.

The node:test fixtures cover production/scoped/nested/peer resolution,
development exclusion, target filtering and union, declared files, standard
compound and unsupported/custom identifiers, missing/empty/oversized text,
installed drift, private-path handling, preserved URLs, deterministic ordering,
incomplete graphs, subprocess bounds and CLI failure without an artifact.
The September 16 focused run on Windows with Node.js 24.19.0 passed all 29 tests:
`node --test scripts/notices.test.cjs`. This includes unlocked installed shadows,
incompatible resolutions, UNC paths and early aggregate-budget rejection.
Fallback regressions additionally cover exact bytes/hashes/provenance, mutable
revisions, identity drift, duplicate records, unsafe paths, size bounds, linked
directories, explicit ambiguous terms, complete target traversal, and refusal
to bundle unresolved/stale output. The real upstream corpus is validated offline
in fixtures. These fixtures do not constitute native installer verification.

The September 21 regressions cover exact source-offer URL/hash/instructions,
direct cached-archive verification, shipped and omitted repository-root
declarations, full multi-license applicability without choosing an alternative,
and the strict notice-packaging command. `node --test scripts/notices.test.cjs
scripts/release.test.cjs` passed all 43 tests. The real `--inventory` collection
succeeded with the evidence above; strict collection exited 1 for the 11 recorded
objc2 decisions and created no bundle notice artifact.

Earlier September 15/16 Windows checks: `node --test scripts/notices.test.cjs
scripts/release.test.cjs` (28 passed), `npm test` (118 passed), `npm run build`,
`node scripts/check-release.cjs`, and `git diff --check` passed. The Tauri command
above was exercised through its CLI: it reached `beforeBuildCommand`, rejected
the then-current 13 blockers and exited 1 before building an installer. No bundle notice file
was created. This verifies rejection only, not successful resource inclusion.
Rust tests/formatting/Clippy and browser/native application checks were not run
locally for this notice-only change; the required desktop CI remains applicable.

Legal/distribution review, adoption of the packaging overlay in the release
workflow, actual NSIS/DMG resource inspection and isolated installer lifecycle
verification remain pending. This tooling alone does not close the release gate.
