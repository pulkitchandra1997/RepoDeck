# Reusable Workspace Test Data

Generate from the project root with `npm run fixtures:create`. Git and Node are required; no account, network access, Rust toolchain or application dependencies from the sample projects are needed. Each run creates a fresh `.tools/test-workspaces/manual-<timestamp>/` directory. Generated contents are excluded from the RepoDeck source tree by `.gitignore`; the generator and tests are contributor-owned source files.

## Layout

Select the generated **workspace** directory using RepoDeck's Add workspace button, not its parent:

```text
manual-<timestamp>/
  manifest.json                       Expected branches, Git status and public revisions
  support/                            Backing repositories; keep with workspace
  workspace/                          Add THIS folder to RepoDeck
    START-HERE.md
    01-flat/
      frontend/                       Modified, staged rename, deletion, untracked, ignored
      api/                            Clean sibling repository
    02-deep/business/payments/services/worker/   Deeply nested repository
    03-nested/platform/               Independent parent repository
      plugins/independent/            Independent nested repository
    04-monorepo/product/              One Git repository, several applications
      apps/web/
      apps/mobile/
      packages/shared/
      .agents/workflows/
      .claude/settings.json
      AGENTS.md
    05-edge-cases/
      no-commits/                     Unborn branch with untracked README
      merge-conflict/                 Intentional unresolved conflict
    06-worktrees/feature-checkout/    Linked worktree; backing metadata in support
    07-submodules/application/        Superproject with dirty submodule
      vendor/library/                Detached checkout with modified README
    08-not-a-repository/              Ordinary folders, empty folder and binary file
      design/brief.md
      assets/
      .agents/plans/demo.md
      .claude/settings.json
      .hidden-note.txt
    09-public-projects/               Optional offline copies of existing fixtures
      express/
      flask/
      gitlab-cli/
```

There are **11 synthetic repositories**, plus up to three public repositories if their checkouts already exist in `.tools/fixtures`. The manifest records the actual count. The monorepo's applications are not separate Git repositories. The submodule and its superproject are two repositories. The independent nested child is ignored by its parent's Git but is still discoverable by RepoDeck.

## Manual Checklist

Use default depth 12 and entry limit 50,000; retain default heavy-directory exclusions. Wait for scanning to finish.

1. Compare the repository count and paths with `manifest.json`. With all three public projects present, expect 14 repositories.
2. Select `01-flat/frontend`: expect four non-ignored changes, including a staged rename and a filename containing spaces. Inspect diffs and the ignored-file entries. `local.secret` contains only a fake value. The Files scan excludes `node_modules` by default.
3. Select the deep worker and both nested repositories. Confirm that the nested parent remains clean despite the independent child.
4. Select the monorepo: its web/mobile/shared folders belong to one repository. Inspect `.agents`, `.claude` and `AGENTS.md` through the Agents tab.
5. Select `no-commits`: expect an untracked README, not an inspection error. Select `merge-conflict`: expect one conflict and a readable diff.
6. Select the linked worktree: expect `feature/agent-task`. Select the submodule: expect detached HEAD and one change. The parent also reports its modified submodule.
7. In Files, preview `08-not-a-repository/design/brief.md` and the binary fixture. Enable hidden files to reveal `.hidden-note.txt`; this is separate from heavy-folder exclusions.
8. Edit or add a disposable note externally, check automatic refresh, then pause refresh and try manual refresh.
9. Filter by nested paths, resize the window, export JSON/Markdown, and compare the export with the manifest.

The manifests describe the initial state. Your edits intentionally change it; generate a new fixture to restore a clean baseline. The generator refuses to reuse an existing destination. No recursive reset command is provided.

## Automated Verification

The generator asserts each initial Git status and branch before writing the manifest. Public projects are cloned locally without hard links; their origin URLs and exact commit IDs are recorded. No public project scripts or dependencies are run. Their original licenses remain in their checkouts.

For native core verification, set `REPODECK_FIXTURE_MANIFEST` to the absolute manifest path, then run:

```sh
cargo test -p repodeck-core --test manual_workspace -- --ignored --nocapture
```

For Windows installed-UI verification, also set `REPODECK_TEST_EXE` to the installed executable, then run `node scripts/verify-fixture-native.cjs`. This uses a separate generated test profile and checks repository count, conflict and detached-submodule diffs, agent settings and ordinary file preview. Run native UI scripts sequentially. A screenshot is written to `.tools/screenshots/manual-workspace.png`.

Do not install or uninstall a test copy in an account containing the user's RepoDeck installation. NSIS shares product registration and can terminate the application by executable name across directories. Installer lifecycle tests require a separate Windows account or disposable VM. A custom destination and isolated data profile do not provide that isolation.

Keep `support/` at its generated location: linked worktrees and local submodule URLs refer to it. To move or share test data across machines, share the generator and generate again, not a copied linked-worktree directory. Generated profiles and failed partial runs remain local for diagnosis and are not release artifacts.

Private hosting and authentication are NOT simulated by a private-looking URL here. These fixtures exercise local repository layouts and states; private HTTPS/SSH transport testing is separate.

## Verified Local Dataset

The first complete dataset is `.tools/test-workspaces/manual-1789223541034/workspace`. Git verification and the RepoDeck core test passed with 14 repositories and 2,559 entries. The installed Windows UI passed the workflow above and displayed 6 repositories with changes and 8 agent files. The screenshot was visually inspected. Existing-destination rejection was separately checked with the manifest bytes unchanged. An earlier incomplete generation remains in its own timestamped directory after the generator's filename-quoting assertion failed; do not use that partial directory as a complete dataset.

The temporary automation installation was uninstalled after verification; this dataset and its support directory remain for your manual testing. These results are Windows evidence, not macOS verification.
