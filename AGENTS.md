# Local Installation Safety

The user has a real RepoDeck installation in their normal Windows account.

- Do not run RepoDeck installer or uninstaller automation in this Windows account. A different installation directory does NOT isolate the product registration, shortcuts, AppUserModelId or process-name termination.
- NSIS silent installation/uninstallation can terminate any running `repodeck-desktop.exe` belonging to the account, even from another directory. Never use it as test cleanup here.
- Run installer lifecycle tests only in a disposable VM or separate dedicated Windows account. Check isolation before executing them. An explicit user-requested install or repair is separate from test automation.
- Do not remove, replace, stop or uninstall the user's installation as part of development. Do not kill processes by name. Test harnesses must track only the processes they created.
- Isolated settings via `REPODECK_DATA_DIR` protect preferences only; they do not isolate Windows installation state.
- Building installer artifacts is allowed. Existing core and browser tests do not need installation. Keep real-user installer lifecycle coverage marked pending when an isolated environment is unavailable.

These rules follow an incident where same-account test installation/uninstallation removed the user's Start menu registration and could close their running application. The user's original installation was repaired afterward. Do not repeat that workflow.
