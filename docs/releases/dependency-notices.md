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
```

Use a new output filename. Existing files are never overwritten. Collection must
finish before writing starts; failures exit nonzero with path-free diagnostics.
An output write failure may leave a partial file, so downstream packaging MUST
require a successful generator exit in the same build, not merely file existence.
Do not reuse a stale artifact after a failed run.

The single UTF-8 JSON artifact contains exact names, versions, declared license
identifiers, target membership and package-relative filenames with original text
(including original line endings). Packages, files and target membership are
sorted; there are no timestamps, Cargo IDs, registry URLs or absolute locations.
Identical inputs produce identical bytes. Conflicting evidence for the same
ecosystem/name/version is an error. `npm run test:notices` runs in CI and
`npm run notices -- OUTPUT.json` invokes collection. Tauri resource integration
remains pending successful collection and review; CI fixture tests do not certify
that distributable notices were generated.

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
  guessed terms or downloads. A NOTICE alone does not replace license text.
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

## Current Evidence And Blocker

On Windows, Node.js 24.19.0 and Cargo 1.98.1, locked offline structured metadata
succeeded for all three targets (270 Windows and 264 nodes for each macOS target).
This is resolution evidence, not native build or installation evidence.

The reachable Cargo declaration inventory uses `0BSD`, `Apache-2.0`,
`BSD-3-Clause`, `CC0-1.0`, `MIT`, `MIT-0`, `MPL-2.0`, `Unicode-3.0`,
`Unlicense`, `Zlib` and `LLVM-exception`. Current npm declarations additionally
use `ISC`. Compound expressions and legacy slash declarations are covered by
fixtures. The recognized set is not a comprehensive SPDX registry; a future
standard identifier outside it needs a parser update, not a legal-policy denial.

Real collection fails closed at `webview2-com@0.38.2`: no license text was found
in the supported locations in the installed crate. No distributable artifact
was produced. A maintainer must establish the actual upstream license text and
its provenance, then add a reviewed, bounded discovery rule or dependency fix.
Do not insert generic text based only on the crate's declared identifier.
Later dependencies may reveal additional blockers after this one is resolved.

The node:test fixtures cover production/scoped/nested/peer resolution,
development exclusion, target filtering and union, declared files, standard
compound and unsupported/custom identifiers, missing/empty/oversized text,
installed drift, private-path handling, preserved URLs, deterministic ordering,
incomplete graphs, subprocess bounds and CLI failure without an artifact.
The focused run on Windows with Node.js 24.19.0 passed all 15 tests:
`node --test scripts/notices.test.cjs`. This includes unlocked installed shadows,
incompatible resolutions, UNC paths and early aggregate-budget rejection.
These fixtures do not constitute native installer verification.

Legal/distribution review, Tauri resource integration and real release artifact
verification remain pending. This tooling alone does not close the release gate.
