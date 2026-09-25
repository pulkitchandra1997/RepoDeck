# Missing Git Silent Rejection: Review Proposal

Issue #18 follow-up based on PR66 `c6140e8`. Keep this branch local until PR66
merges; review this patch after the actual baseline lifecycle run. Do not dispatch
the separate manual-only workflow until the orchestrator approves it.

The target is exclusively a new GitHub-hosted Windows 2025 VM. The existing
hardware/account/dispatch guard runs before writes or environment/Git mutations.
There is no self-hosted or local override. Do not execute `missing-git.ps1` locally.

`git-prerequisite.nsh` checks SearchPath, then ProgramFiles64/Git/cmd/git.exe,
ProgramFiles32/Git/cmd/git.exe and LocalAppData/Programs/Git/cmd/git.exe. PATH-only
masking cannot establish absence. The proposal restricts the harness/child PATH
to System32 and uses an empty working/installer directory; it rejects git.exe in
the Windows/system search directories. Each existing absolute fallback executable
is temporarily moved to a unique adjacent filename after rejecting reparse points.
No Git installation is uninstalled, no broken stub is substituted, and no system
environment variable is persisted. All exact fallback paths must be absent and
`where.exe git.exe` must return the absence status before setup runs.

The published preview 3 installer is pinned to SHA-256
`afc549ac22a021959d5511efeed7049f80a1f7b0027f427cf13b998b5fefa5a5`.
It must exit 2 under `/S` within 60 seconds. The harness checks absence of the
selected/default app directories, both AppData product directories, app processes
and product uninstall registrations before and after. These assertions concern
app payload/registration/settings, not every temporary file NSIS might create.
Interactive winget/Git setup, dialogs, cancellation and retry remain PENDING;
passing this case does not close issue #18 or prove a complete user installation.

Recovery tokens are journaled before relocation. Finally restores every token in
reverse order even after relocation, absence-check, installer or restoration errors.
Restored executables must match their original hashes; collisions are never
overwritten. Any restoration failure fails the test and is individually recorded.
PATH and working directory are restored afterward. No app cleanup is attempted on
a failed negative case; discard the VM and inspect evidence. If permissions or
search locations cannot be controlled, fail as an environment constraint.

Structured evidence begins after the guard and output directory creation. Earlier
failures only have workflow logs. Download/hash/preflight and later failures retain
the last phase; transaction failures also retain restoration outcomes. Cancellation
or runner loss can interrupt finally: the disposable VM is the ultimate boundary,
and absence of a final passing result must never count as success.

Local safe checks: `pwsh -NoProfile -File scripts/windows/missing-git.test.ps1`
and the existing lifecycle test. Transaction tests use inert scriptblocks and
production entry-point parsing; they never execute the VM entry point or mutate
Git. Native setup, masking permissions, actual NSIS rejection and restoration are
UNTESTED until reviewed dispatch; a discrepancy must fail, not be waived.
