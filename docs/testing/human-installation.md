# Human Installation and Onboarding Verification

Use the normal Windows desktop environment and the visible installer, not a child process with Codex's augmented PATH. Preserve project files and application settings. Do not remove Git from the user's machine merely to create an absent-Git scenario. Prefer a disposable VM for destructive/repeated lifecycle testing.

The user explicitly requested a hands-on uninstall/reinstall in this session. Computer Use rejected launching the installed uninstaller with `product policy blocks this app`. Do not bypass that restriction via shell commands or another launch surface. The user was asked to uninstall manually while leaving deletion of application data unchecked. No uninstall/reinstall completion is claimed.

## Scenarios

| Scenario | Setup and action | Expected result | Current evidence |
| --- | --- | --- | --- |
| Without Git | On a genuine no-Git Windows environment, open the NSIS setup interactively | Explicit Git-install offer; cancellation does not report success; accepted setup requests Git installation and rechecks it | Hook compiled; actual installer flow pending |
| With Git | After Git works from a normal Windows session, run setup again interactively | Existing Git detected; no redundant download; launch from Start succeeds | Core Git detection and UI mocks pass; normal interactive install pending |
| Several repositories | Add `.tools/test-workspaces/manual-1789223541034/workspace` through the folder dialog | 14 repositories, including nested repo, worktree, submodule and public projects; initially 6 with changes | Prior installed fixture test passed; repeat after new install pending |
| One repository | Add that workspace's `09-public-projects/express` folder separately | One clean root repository, branch visible, package.json preview works | Prior Express installed tests passed; interactive single-folder addition after new install pending |
| First launch | Use a profile without `onboardingCompleted`, or a fresh dedicated profile | Three image-based steps, Back/Next, Skip, final Add a workspace action | Frontend and browser fixtures pass |
| Later launch | Finish/skip tour, close and reopen | Tour stays dismissed; Show tour opens it again | Persistence core/frontend/browser checks pass; normal Start launch pending |
| Git prerequisite failure | Git missing/broken at launch | Setup screen; no false claim Git is available; files-only option is explicit | Automated setup-state checks pass |

Git installation, OS license prompts and destructive GUI actions require action-time confirmation or user handoff. If the machine already has Git, perform the no-Git scenario on a clean VM; changing only PATH is an environment simulation, not equivalent to a clean machine.

## Desktop Retest, 2026-09-12

- Retried the explicitly requested visible uninstaller launch through Computer Use. It again returned `product policy blocks this app`; no alternate launch method, uninstall, Git removal or installation was performed.
- Activated the existing installed RepoDeck window. It still reports Git unavailable. This is the older installed build, not the newly built installer with Git setup and onboarding.
- Used real mouse clicks and the native folder picker to add the prepared `manual-1789223541034/workspace` folder. Observed 14 repositories, 8 agent files and 2,559 indexed entries. All 14 Git statuses remain unavailable in this normal desktop process.
- Added `09-public-projects/express` separately through the same native dialog. Observed one repository and 269 indexed entries, then clicked `package.json` and verified its contents appeared in the inspector. The existing `.tools` workspace was preserved.
- Computer Use accessibility focus was stale and `set_value` failed with a CacheRequest error. Selecting the actual full-size dialog screenshot (not its 15x15 auxiliary capture), clicking the Folder field, inspecting its focus, then typing worked. No application code change was needed for this tool issue.
- Fresh automated verification passed: 57 frontend tests; all non-ignored workspace Rust tests; the explicitly enabled 14-repository fixture test; onboarding browser checks at 1280/800/600 widths; Windows/macOS Git-setup UI fixtures at 800/1280 widths. Git-setup browser results are mocked and do not execute installers.
- Remaining release gates: visible uninstall/reinstall, actual prerequisite installation with and without existing Git, first launch from the newly installed build, and real macOS execution. Adding folders and file previews pass in the older installed app; successful Git status inspection there is not claimed.

## Onboarding Details

The tour uses actual RepoDeck UI captures with inert sample data. Generate them with `node scripts/create-onboarding-images.cjs` while the dev server is running. Assets are bundled locally under `apps/desktop/src/assets/onboarding`; the tour makes no network requests for images.

`onboardingCompleted` defaults to false for old/missing preference fields and persists after completion or Skip. The sidebar's Show tour button reopens it without clearing preferences. A failed preference save keeps the tour open with an error, rather than falsely reporting completion. The final first-run button opens the normal Add workspace folder dialog after saving completion. Canceling the picker leaves the usable app open.

Verification commands: `npm test`, `npm run test:onboarding`, `npm run test:ui`, and `cargo test -p repodeck-core --test settings`. Browser tests cover all three images at 1280x820, 800x600 and 600x800, no horizontal overflow, navigation, a single picker request, persisted completion and replay. These use fixture IPC and are not a substitute for the installer scenarios above.
