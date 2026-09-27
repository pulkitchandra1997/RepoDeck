# Disposable Windows Installer Lifecycle Proposal

Issue #18: run the manually dispatched `Isolated Windows installer lifecycle`
workflow only after maintainer/orchestrator review. This PR does not dispatch it.
It uses a fresh GitHub-hosted Windows 2025 VM with Git already present. There is
no local VM or self-hosted runner override. Windows Server runner results do not
establish Windows 10/11 desktop compatibility.

The fixed input is published preview 3, source
`bbf7490b518139d138f5656291724f51b9a97550`, installer SHA-256
`afc549ac22a021959d5511efeed7049f80a1f7b0027f427cf13b998b5fefa5a5`.
The harness verifies bytes before execution and records its own commit/run ID.

Before downloading or installing, the harness requires GitHub-hosted dispatch
metadata, runneradmin, the Windows image marker and Microsoft VM hardware. It
rejects existing app processes, standard install/profile directories and uninstall
registrations. Environment checks are accident guards, not cryptographic VM
attestation: the reviewed workflow's fixed hosted runner is the isolation boundary.
Never spoof these markers or execute the harness on a normal user account.

The repository NSIS hook probes Git on PATH and three standard installation paths.
Silent setup aborts with exit 2 when none works; interactive setup can invoke
winget or open a browser. Neither missing-Git simulation nor prerequisite mutation
is included here. The shared installation policy records NSIS process-name
termination; consequently the guard rejects any existing RepoDeck process.
Existing `verify-native.cjs` uses WebView2 debugging and prepared workspace fixtures;
this smaller harness instead records native window creation for its own PID.

Proposed assertions: silent install, owned app launch with native window, bounded
owned-process shutdown, seeded normal AppData settings, silent uninstall without
data removal, byte-preserved settings, reinstall, and owned relaunch. The uninstaller
uses `_?=` to avoid a temporary-process handoff. The VM is discarded afterward;
there is no broad process kill or host installation cleanup.

`result.json` begins only after isolation/state/Git preflight, download and hash
verification succeed. Failures before that point appear in workflow logs; no
structured result is promised for them. Subsequent lifecycle failures retain
completed stages and cleanup status. App shutdown waits up to 10 seconds after
requesting close, then up to 10 seconds after killing only the owned process.
A post-kill timeout records `kill-timeout` and fails the run with cleanup incomplete;
a forced exit records `killed` and the graceful-close timeout explicitly.
A native window does not
prove rendered UI, repository interaction, settings consumption or onboarding.
Retention proves seeded file bytes survive; it does not prove a GUI settings edit.
Interactive setup, Start-menu launch, SmartScreen, missing Git, upgrade across
versions, Windows client OS coverage and macOS remain pending. A headless runner
without a native window fails the launch assertion rather than claiming coverage.

Locally safe verification: `pwsh -File scripts/windows/installer-lifecycle.test.ps1`.
Only function definitions load in this mode; cleanup tests use inert process doubles.
Installer lifecycle execution and its
results remain untested until the reviewed workflow is deliberately dispatched.
