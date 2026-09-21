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

The schema-v3 UTF-8 JSON artifact contains exact names, versions, declared license
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

`--inventory` writes a complete review candidate after visiting all three targets.
It exits zero when the evidence was collected successfully, including when a
separate distribution review remains pending. `collectionComplete` reports only
whether every reachable dependency has collected license text; `unresolved`
contains missing-text failures. `releaseGateComplete` additionally requires an
empty `pendingReview` list. Candidate output with `releaseGateComplete: false`
MUST NOT be bundled, but it can be inspected as a full notices artifact without
claiming that distribution was forbidden or approved. Malformed graphs,
unsupported declarations, invalid provenance, unreadable inputs and bounds errors
still abort without an artifact. Strict collection and `--bundle` reject both
unresolved notices and pending distribution review.

Cargo records expose `licenseTextAvailable` and, where applicable,
`reviewPending`. The former is a text-presence indicator; the latter records a
question outside notice collection. Neither is a semantic license audit. This
separation prevents a complete set of declared-license texts from being reported
as missing merely because package-content or distribution review remains open.

## Release Notice Packaging

[The notice-specific Tauri overlay](../../src-tauri/tauri.notices.conf.json) runs
strict collection before the frontend build and maps the fresh artifact to
`THIRD-PARTY-NOTICES.json` in the application resource directory. For example:

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

The `package:notices` command selects this overlay. Release CI uses it for all
three package targets after fetching the complete locked Cargo source union.
Windows CI extracts the NSIS archive with 7-Zip and macOS CI mounts each DMG;
both paths verify the exact generated notice hash without executing an installer
or application. Preview 2 did not contain this resource. A later candidate is
acceptable only after all three resource assertions pass. Never run
installer/uninstaller automation in the normal Windows account.

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
  The declaration must be included as evidence. If it ships in the crate, its
  crate-relative location and installed hash must match. A repository-root
  declaration omitted from the published crate is allowed only at the package's
  exact pinned repository and revision, with a root-safe source path and the
  published VCS metadata still matching the package record.
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
support 22 exact crate records. Eleven records include the accepted bounded
native-evidence review described below.

- `webview2-com@0.38.2`, `webview2-com-macros@0.8.1`, and
  `webview2-com-sys@0.38.2`: repository-root MIT text with Bill Avery's copyright.
  Published VCS revisions and workspace manifests bind it to those crates.
  The sys crate also collects Microsoft's SDK license/NOTICE after verifying every
  loader hash. Its collector gate is resolved; release CI requires exact packaged
  notice delivery. Separately deployed Runtime behavior remains outside the
  notice artifact. The SDK terms do not establish separately deployed Runtime
  terms.
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
  Zlib and Apache-2.0 texts to fix upstream issue #826. MIT-only crates collect
  the MIT text; declarations of
  `Zlib OR Apache-2.0 OR MIT` retain all three texts without selecting an
  alternative. The later files are recorded as the source of full terms, not
  represented as files shipped in the older crates. Together with each exact
  published-revision declaration, this completes text collection for the current
  declared licenses without inventing a licensing choice. Their bounded
  package-content review is recorded below.
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

## Current Evidence And Review

On 2026-09-21, Windows, Node.js 24.19.0 and Cargo 1.98.1, locked offline structured
metadata succeeded for all three targets (270 Windows and 264 reachable nodes for
each macOS target, including two workspace members).
This is resolution evidence, not native build or installation evidence.

The real inventory now finishes: 299 distinct package/version records (294 Cargo
and five npm). Target membership is 268 third-party Cargo packages for Windows,
262 for each macOS architecture, and five npm packages on every target.
The schema-v3 candidate reports `collectionComplete: true`, zero `unresolved`
notice entries, zero `pendingReview` entries, and `releaseGateComplete: true`.
For the lockfiles inherited from `30056dd` and the branch after normal-merging
`origin/main` through `ce52ead` (`0.1.1-preview.2`), the reviewed strict artifact
is 3,001,441 bytes with SHA-256
`27828632b0be324fa1eb8df17eedfd8c736c5e86ec5b5c5b465fa0616f988b87`.
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
NOTICE and nuspec after byte-verifying all nine loader files. The chosen
[Runtime deployment](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
remains separate release behavior; neither collector result is legal clearance.

The 11 reviewed records are `block2`, `dispatch2`, `objc2`, `objc2-encode`,
`objc2-exception-helper`, `objc2-foundation`, `objc2-app-kit`,
`objc2-core-foundation`, `objc2-core-graphics`, `objc2-io-surface`, and
`objc2-web-kit`. All texts for their declared licenses are collected. The
[pinned upstream declaration](https://github.com/madsmtm/objc2/blob/8852b424193ca41602281b3d7540d7c8ed51e49a/LICENSE.md)
says that `block2`, `objc2`, `objc2-foundation`, and `objc2-encode` are MIT;
the other seven are `Zlib OR Apache-2.0 OR MIT` at the recipient's option. The
candidate retains all three alternatives for those seven and explicitly makes no
selection. Its reference to [issue #23](https://github.com/madsmtm/objc2/issues/23)
concerns prospective relicensing and a copyright-notice change. Closing that
issue is not a prerequisite to use the declared licenses, and this gate does not
treat it as one.

### Exact Published-Package Evidence

The locally cached `.crate` archives byte-match the SHA-256 checksums in
`Cargo.lock`. Their `.cargo_vcs_info.json` files bind each archive to these
published revisions; no historical reconstruction is required for collection:

| Package | Archive SHA-256 | Published revision |
| --- | --- | --- |
| `block2@0.6.2` | `cdeb9d870516001442e364c5220d3574d2da8dc765554b4a617230d33fa58ef5` | `b4167b582b2f75f9a1be75495c41b765344fd03c` |
| `dispatch2@0.3.1` | `1e0e367e4e7da84520dedcac1901e4da967309406d1e51017ae1abfb97adbd38` | `8852b424193ca41602281b3d7540d7c8ed51e49a` |
| `objc2@0.6.4` | `3a12a8ed07aefc768292f076dc3ac8c48f3781c8f2d5851dd3d98950e8c5a89f` | `8852b424193ca41602281b3d7540d7c8ed51e49a` |
| `objc2-app-kit@0.3.2` | `d49e936b501e5c5bf01fda3a9452ff86dc3ea98ad5f283e1455153142d97518c` | `7b1abfd750a2cacaea71d6a56ecfb83cb7de560b` |
| `objc2-core-foundation@0.3.2` | `2a180dd8642fa45cdb7dd721cd4c11b1cadd4929ce112ebd8b9f5803cc79d536` | `7b1abfd750a2cacaea71d6a56ecfb83cb7de560b` |
| `objc2-core-graphics@0.3.2` | `e022c9d066895efa1345f8e33e584b9f958da2fd4cd116792e15e07e4720a807` | `7b1abfd750a2cacaea71d6a56ecfb83cb7de560b` |
| `objc2-encode@4.1.0` | `ef25abbcd74fb2609453eb695bd2f860d389e457f67dc17cafc8b8cbc89d0c33` | `8d214f5477365ffcbcbb7de058c86ed9a518efb7` |
| `objc2-exception-helper@0.1.1` | `c7a1c5fbb72d7735b076bb47b578523aedc40f3c439bea6dfd595c089d79d98a` | `8d214f5477365ffcbcbb7de058c86ed9a518efb7` |
| `objc2-foundation@0.3.2` | `e3e0adef53c21f888deb4fa59fc59f7eb17404926ee8a6f59f5df0fd7f9f3272` | `7b1abfd750a2cacaea71d6a56ecfb83cb7de560b` |
| `objc2-io-surface@0.3.2` | `180788110936d59bab6bd83b6060ffdfffb3b922ba1396b312ae795e1de9d81d` | `7b1abfd750a2cacaea71d6a56ecfb83cb7de560b` |
| `objc2-web-kit@0.3.2` | `b2e5aaab980c433cf470df9d7af96a7b46a9d892d521a2cbbb2f8a4c16751e7f` | `7b1abfd750a2cacaea71d6a56ecfb83cb7de560b` |

None of the 11 archives contains a `LICENSE`, `LICENCE`, `COPYING`, `NOTICE`, or
`COPYRIGHT` file. The four pinned repository revisions carry the same root
`LICENSE.md` bytes (SHA-256
`7f976f7e9cb2d87df7230606feb932c3f21ac0e664045a775b600046ff850c54`),
which is why the collector records that exact declaration plus immutable full
term sources. Inspection found generated Rust interfaces, Rust/C/Objective-C
implementation files, Cargo metadata, and documentation; it found no standalone
Apple SDK headers, libraries, `.tbd` linker stubs, or Apple copyright notices.
That is package-content evidence, not a conclusion about whether generated API
declarations or copied header documentation are protectable or distributable.

### objc2 Review Boundary

The same pinned declaration separately says the crates are derived from Apple
SDKs and raises a distribution question. The current
[Xcode and Apple SDKs Agreement](https://www.apple.com/legal/sla/docs/xcode.pdf)
(EA2002, dated 2026-06-08) defines Apple SDKs to include headers, APIs, libraries,
and source/object code; permits compliant macOS applications and libraries to be
distributed; and restricts copying, redistribution, modification, and derivative
works of Apple Software in Sections 2.4, 2.5, and 2.7. Those clauses do not by
themselves establish the contents or generation history of these pinned crates.

The published source identifies the relevant transformation more narrowly than
the earlier gate did. The pinned objc2
[generated-interface documentation](https://github.com/madsmtm/objc2/blob/8852b424193ca41602281b3d7540d7c8ed51e49a/crates/objc2/src/topics/about_generated/README.md)
states that the framework crates are mostly generated interfaces and contain some
documentation from headers. Their Rust declarations link to system frameworks
such as `AppKit`, `Foundation`, `CoreFoundation`, `CoreGraphics`, `IOSurface`,
and `WebKit`. The source crates are build inputs; neither Tauri configuration
copies Cargo registry source nor the SDK into the application. The normal bundle
has no configured resources. The notice overlay adds only
`THIRD-PARTY-NOTICES.json`.

### Preview-2 Native Evidence

The exact `0.1.1-preview.2` evidence retained by the issue #56 workflow contains
one record for each architecture:

| Architecture | DMG SHA-256 | Evidence-file SHA-256 |
| --- | --- | --- |
| [arm64](evidence/0.1.1-preview.2-macos-arm64.json) | `cba596d36e73af2a03c256cabffce82f41d919b30472d75842b969c64b661fc9` | `0b098b6c51422c1c74aaf9d7f4c7313bcef6a1dd17d7d706feddeac2ce6f2623` |
| [x86_64](evidence/0.1.1-preview.2-macos-x86_64.json) | `14208190b5a1cb0c1996ebd4e01736a030ad58a9f0954cc7c21be299db3969c8` | `ecf5eae02343ebd1bbbfb00d0214900018b5ffc2d79a1cd81be397f3b6884fec` |

Both sorted application inventories contain only `Contents/Info.plist`, the
`Contents/MacOS/repodeck-desktop` executable, and
`Contents/_CodeSignature/CodeResources`, plus their parent directories. The only
Mach-O file is the RepoDeck executable. Every `otool -L` import is under
`/System/Library` or `/usr/lib`; there is no bundled SDK header, library, linker
stub, crate source, or other SDK payload. Preview 2 also has no notice resource,
which is why packaging the reviewed artifact remains required.

### AI-Assisted Engineering Review

The pinned package declarations and collected texts establish MIT for `block2`,
`objc2`, `objc2-foundation`, and `objc2-encode`, and retain every declared
alternative for the other seven records without making a licensing choice. The
published crate inspection and exact compiled-application inventories identify
no concrete conflicting notice or source-delivery obligation for the artifacts
being packaged. On that bounded engineering evidence, all 11 records are
`text-reviewed` and strict notice generation may proceed. This conclusion was
produced with AI assistance and accepted as a bounded engineering record; it is
not represented as professional legal review.

This records an engineering release decision, not legal clearance. It does not
decide hypothetical treatment of material absent from the package, and it does
not require unavailable historical generator tracing. Re-review is required if
the dependency versions, upstream declarations, linked libraries, generated
content, or bundle inventory change, or if a reviewer identifies a specific
retained file and a concrete conflicting obligation.

### Packaging Acceptance

Issue #17 remains open until the strict artifact is bundled and verified on all
three targets. Each matrix runner must fetch the three locked target closures
and the unfiltered locked dependency set before offline generation; Cargo's
targeted fetch alone can omit packages still visited by filtered offline
metadata. Packaging must use `src-tauri/tauri.notices.conf.json`. Windows CI
extracts the NSIS archive with 7-Zip without executing it and verifies the root
`THIRD-PARTY-NOTICES.json`
against the generated SHA-256 and release-complete schema. macOS CI passes that
same generated hash to the native DMG validator and requires the exact file at
`Contents/Resources/THIRD-PARTY-NOTICES.json`. Missing, linked, altered,
incomplete, or pending-review resources fail the build.

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
to bundle unresolved, pending-review, or stale output. The real upstream corpus
is validated offline in fixtures. These fixtures do not constitute native
installer verification.

### Historical Pre-Review Runs

The following runs document the collector's earlier fail-closed state before the
preview-2 native evidence was accepted. They are retained as regression history,
not current blockers.

The September 21 post-merge Windows run, after normal-merging `origin/main` at
`a363fe7` and preserving `0.1.1-preview.2`, passed `npm run test:notices`
(32 tests), `npm run test:release` (13 tests), `npm test` (131 tests),
`npm run build` (1,884 modules),
`npm run check:release`, `cargo test --locked -p repodeck-core` (eight ignored
environment/manual fixtures), `cargo fmt --all --check`,
`cargo clippy --workspace --all-targets -- -D warnings`, the local relative-link
check, and `git diff --check`. The then-current schema-v3 inventory produced
3,019,713 bytes with zero unresolved notices and 11 pending reviews. Strict
collection exited 1 and wrote no artifact. No installer or application was run.

The September 21 regressions cover exact source-offer URL/hash/instructions,
direct cached-archive verification, shipped and omitted repository-root
declarations, full multi-license applicability without choosing an alternative,
and the strict notice-packaging command. `node --test scripts/notices.test.cjs
scripts/release.test.cjs` passed all 45 tests. The historical `--inventory`
collection succeeded; strict collection exited 1 for the 11 then-recorded
objc2 distribution reviews and created no bundle notice artifact.

The earlier September 21 baseline also passed `npm test` (131 tests), `npm run build`,
`node scripts/check-release.cjs`, `cargo test --locked -p repodeck-core` (seven
ignored environment/manual suites), `cargo fmt --all --check`,
`cargo clippy --workspace --all-targets -- -D warnings`, the local documentation
link check, and `git diff --check`. Browser/native application checks and installer
lifecycle tests were not run locally. Hosted workflow run 35584015219 passed all
three desktop targets and supplies the bounded DMG evidence above for commit
`803fd1d`. Hosted workflow run 35592289396 passed all three desktop targets for
commit `13e9ba8`; the pull request check remains authoritative for each later
revision.

Earlier September 15/16 Windows checks: `node --test scripts/notices.test.cjs
scripts/release.test.cjs` (28 passed), `npm test` (118 passed), `npm run build`,
`node scripts/check-release.cjs`, and `git diff --check` passed. The Tauri command
above was exercised through its CLI: it reached `beforeBuildCommand`, rejected
the then-current 13 blockers and exited 1 before building an installer. No bundle notice file
was created. This verifies rejection only, not successful resource inclusion.
Rust tests/formatting/Clippy and browser/native application checks were not run
locally for this notice-only change; the required desktop CI remains applicable.

The current strict-generation proof and packaging acceptance section supersede
those historical pending-review results. The remaining issue #17 engineering
gate is a successful all-target CI run proving exact notice-resource inclusion.
Isolated installer lifecycle verification remains separate because archive and
DMG resource inspection do not establish installability. This record does not
claim legal clearance.
