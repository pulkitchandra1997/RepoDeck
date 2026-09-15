# Development and Verification

Local workspace manager for Git repositories, ordinary project folders and agent configuration. V1 is under development; installers are not yet release-ready.

Public home: [pulkitchandra1997/RepoDeck](https://github.com/pulkitchandra1997/RepoDeck), maintained under the author's personal GitHub account. Source publication does not imply that installers are production-ready; see the release gates below.

## Develop

RepoDeck is developed with AI coding assistance under human maintainer direction.
See [the AI contribution policy](docs/agents/ai-contribution-policy.md) for disclosure
and review expectations. Agents start with [AGENTS.md](AGENTS.md); contributors
start with [CONTRIBUTING.md](CONTRIBUTING.md).

Install Node.js 22.22.2+, 24.15.0+, or 26+ and Rust stable. Node 23/25 are unsupported by the test dependencies; CI uses Node 24. Windows development requires the Visual Studio C++ build tools and WebView2. macOS requires Xcode command-line tools. Install Git with the HTTPS/SSH support and credential helpers you use for your repositories.

Git must accept `git --no-lazy-fetch --version`. RepoDeck requires this capability for offline inspection and refuses older Git builds that lack it. Upgrade Git instead of bypassing the check. The Windows installer and macOS/Windows runtime checks use the same capability probe.

```sh
npm ci
npm run desktop
```

The application opens a native window. Add a workspace with the folder button in the sidebar. Repository status, file previews, agent inventories, settings and local report exports are currently wired to native services.

Settings saves validate editor application syntax and known terminal presets before writing. Older launcher values remain loadable so they can be repaired in Settings without resetting workspace records. This does not verify that a named editor is installed, and terminal support still depends on the operating system.

The browser development server at `http://localhost:1420` is for frontend development; native file operations require the desktop shell. `REPODECK_DATA_DIR` can select an absolute directory for an isolated profile or portable preferences; by default settings live in the OS application configuration directory.

## Verify

For reusable hands-on test data, run `npm run fixtures:create` and add the printed workspace folder in RepoDeck. See [the fixture layout and checklist](docs/testing/manual-workspace.md). The generator creates separate local repositories with known states and optionally copies existing public checkouts without downloading or executing project code.

The core suite includes a real local submodule fixture covering parent/child discovery, detached HEAD, modified and untracked files, diff/preview, external metadata notifications, and deinitialization. Its file-protocol permission is limited to the fixture's Git command; global Git settings are not changed.

Content-filter comparisons, including LFS, currently stop with an explicit limitation message instead of executing filters or claiming a clean status. Parent repositories show submodule commit changes but not submodule working-file dirtiness; inspect the separately discovered submodule entry. This mitigation assumes trusted local metadata and does not protect against concurrent malicious metadata changes. See [security boundaries](SECURITY.md).

```sh
cargo test -p repodeck-core
npm test
npm run build
cargo check -p repodeck-desktop
```

On Windows with Edge installed, `npm run dev` followed by `npm run test:ui` runs browser layout/workflow tests using explicit fixture IPC responses. This does not test native filesystem access.

`npm run test:contrast` uses Edge to resolve the actual stylesheet colors across explicit/system light and dark themes. It checks six text roles against three backgrounds at 4.5:1 and writes `.tools/contrast-results.json`. It is a focused color regression check, not a complete accessibility audit; it does not evaluate every control, hover/filter effect, placeholder, forced-colors mode or screen-reader workflow.

`npm run test:private-git` creates a disposable, credential-protected Git remote on loopback using static HTTP transport. It verifies rejection of anonymous and incorrect credentials, clones through an ephemeral Git credential helper, stops the server, then tests real RepoDeck core status, diff, scanning and untracked-file preview offline. It uses isolated Git configuration and deletes the temporary fixture. Git, Node and Cargo must be on PATH. This is not an installed-UI test or evidence of private GitHub/GitLab HTTPS, SSH, smart HTTP or platform credential-manager compatibility.

Set `REPODECK_TEST_TLS=1` to run that fixture over HTTPS. It requires PowerShell 7.4+ (`pwsh`) and Git's OpenSSL backend. The test generates temporary certificates without installing them into an OS trust store, requires rejection of an untrusted chain and a mismatched hostname, then supplies a process-local CA file with verification enabled. Credentials and TLS overrides must not persist in the checkout. This tests synthetic loopback HTTPS, not an actual private hosting provider or Windows Schannel.

Also set `REPODECK_TEST_EXE` to an installed Windows executable to continue into real desktop verification after the fixture server shuts down. The isolated app checks repository status, remote display, diff, untracked-file preview and file-tree access, plus unchanged Git index/config and preferences. Run separately from other native scripts. This tests inspecting an authenticated checkout, not cloning through the UI. Temporary profile cleanup retries brief WebView2 lock contention and still reports failure if locks remain.

For the real native smoke test, clone Express, Flask and GitLab CLI into `.tools/fixtures/express`, `.tools/fixtures/flask` and `.tools/fixtures/gitlab-cli` respectively. Run `cargo build -p repodeck-desktop`, start the development server, then run `npm run test:native`. It launches the debug Windows binary with an isolated profile and checks real Git scans, cancellation/restart, workspace switching, file previews, Git settings, hook/LFS inventory, ignore rules and preference persistence through WebView2. Set `REPODECK_TEST_EXE` to an installed executable to run the same checks against bundled assets; that mode rejects the development URL. Native file-picker, clean-machine and interactive installer testing are separate outstanding checks.

After a successful native smoke run, set `REPODECK_REUSE_PROFILE=1` to verify that restart or reinstall retains the prior dark theme and workspace records without reseeding the isolated profile.

The native smoke also uses a separate non-Git scratch workspace to verify automatic refresh after file creation, editing and deletion, plus pause/resume. Downloaded public-project checkouts are not modified by this watcher test.

Set `REPODECK_TEST_JUNCTION=1` for an additional Windows junction check in that smoke test. It creates a link from the scratch workspace to a separate temporary folder, verifies the skipped-link warning and absence of the external file in the tree, then removes the link and fixture. Scans list linked entries but do not follow their contents; warnings make this incompleteness explicit.

Set `REPODECK_TEST_WORKTREE=1` to test discovery of a newly added worktree and automatic branch refresh after its external HEAD changes. The watcher resolves metadata for discovered Git-file checkouts using Git, registers their metadata directories and existing shared refs/reftable directories, and rebuilds registrations when scan settings or the completed repository list changes. Repointing an existing `.git` file without changing that list, metadata-directory replacement and network-drive behavior still require further coverage; pause/resume can rebuild registrations.

Set `REPODECK_TEST_SUBMODULE=1` for a native detached-submodule workflow. It creates isolated source/superproject repositories, modifies a detached submodule, then checks the visible detached state, change count, real diff and file preview before removing its fixture. The file-protocol permission applies only to the fixture setup command.

`node scripts/verify-recovery.cjs` launches Windows with a separate corrupt profile and verifies canceled reset, explicit recovery, byte-preserving backup and reloading persisted defaults. It also accepts `REPODECK_TEST_EXE` for installed-app checks.

Run the native UI scripts sequentially. Concurrent instances can share WebView2 runtime state and prevent a second debugging endpoint from opening.

If settings cannot load, RepoDeck offers Retry and Reset preferences. Reset requires confirmation, backs up the original as `settings.backup-<UUID>.json` beside the settings file, and clears the saved workspace list and preferences without changing project files. Automatic recovery refuses valid settings, linked/non-file paths and files larger than 16 MiB. Backup failure leaves the original untouched. For a newer settings schema, upgrade RepoDeck or retain the backup before choosing reset.

## Large Workspaces

For the opt-in large-workspace check, run `npm run bench:workspace`. It creates and removes a temporary mixed workspace with 20 repositories and 20,000 source files, verifies complete streamed results and cancellation at progress callbacks, and prints three optimized-build timing samples. Fixture setup and cleanup are outside the reported scan times. This can take several minutes and is not part of the default unit suite. It does not measure desktop rendering, peak memory, cold storage or network-drive performance.

On Windows, set `REPODECK_TEST_EXE` to an installed RepoDeck executable and run `npm run test:large-native` for the corresponding desktop workflow. This creates a separate temporary workspace/profile, exercises real scans, filtering, file previews, tree pagination, a 1,000-file repository change list and cancellation through WebView2, then removes its fixture. It requires Git and Edge/WebView2; run it separately from other native UI scripts. A 50ms event-loop sampler reports observed gaps and rejects gaps over two seconds during the measured workflow. It does not measure startup, cold-storage performance or prove responsiveness on other machines. Screenshots remain in `.tools/screenshots`.

## Package

Source is licensed under [MIT](LICENSE). Versioned `.exe` and `.dmg` downloads belong in GitHub Releases, not source history. The tag workflow builds all three desktop targets and creates a draft prerelease with checksums. See the [release guide](docs/releases/release-guide.md) for versioning, publication, signing and outstanding release gates. No stable release or automatic updater is currently available.

```sh
npm run package
```

Windows packaging defaults to NSIS with a Git prerequisite check and a user-approved Git for Windows installation path. Missing Git stops silent installation. macOS packaging must be built and tested on macOS; its first-launch setup can request Apple's Command Line Tools installation, then recheck Git. Both platforms offer an explicit files-only option at first launch. Unsigned builds can trigger OS warnings. See [installation strategy](docs/architecture/installation-strategy.md).

## Product and Architecture

The optional public integration suite requires Express, Flask and GitLab CLI checkouts under `.tools/fixtures`. Clone commands and verified revisions are in the verification ledger. These tests include an isolated mixed workspace and do not modify the original downloaded checkouts.

- [Product requirements](docs/product/requirements.md)
- [Architecture](docs/architecture/architecture.md)
- [Verification ledger and remaining work](docs/planning/v1-verification.md)

Local functionality remains independent of the planned optional v2 team/cloud features. Private Git hosting uses the user's Git authentication setup; authenticated provider testing is still outstanding.
