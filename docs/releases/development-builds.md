# Development Installer Builds

These are **unsigned test builds, not a published release**. They have not passed
clean-machine install/upgrade/uninstall testing or signing/notarization review.
Do not replace a working installation merely to test them. Never disable OS
security controls to run a build.

The following artifacts came from the successful
[initial verification run](https://github.com/pulkitchandra1997/RepoDeck/actions/runs/34873459215)
at source commit `32bdf54bea0307c8c5a2a59e278b3d0848052e03`, version `0.1.0`.
They do not include later documentation and test-harness changes.

| Platform | CI artifact download |
| --- | --- |
| Apple Silicon Mac | [ARM64 archive](https://github.com/pulkitchandra1997/RepoDeck/actions/runs/34873459215/artifacts/10360860253) |
| Intel Mac | [x64 archive](https://github.com/pulkitchandra1997/RepoDeck/actions/runs/34873459215/artifacts/10360066758) |
| Windows x64 | [Setup archive](https://github.com/pulkitchandra1997/RepoDeck/actions/runs/34873459215/artifacts/10361090532) |

GitHub may require sign-in. Artifacts expire under the workflow retention policy;
these links are not a replacement for permanent GitHub Releases. Extract the ZIP
to find the installer. The checksums below are for the installer inside, not the ZIP.

| Installer | SHA-256 |
| --- | --- |
| `RepoDeck_0.1.0_aarch64.dmg` | `88326a347e47c547be29ce35759c36b4a0c93a1f85241c7139fc155b026f5293` |
| `RepoDeck_0.1.0_x64.dmg` | `8b0b1c8e623e38e3ad13fecb1baded7772c0455cf56a5d0885833aebe6ee6459` |
| `RepoDeck_0.1.0_x64-setup.exe` | `1fdea238634bb368c29226cae229bc5aeab2eeab1bb70a6e0b9cca4b644a6b1e` |

On macOS, inspect with `shasum -a 256 <installer.dmg>`. On Windows, use
`Get-FileHash -Algorithm SHA256 -LiteralPath <installer.exe>` in PowerShell.
Matching a checksum verifies the bytes, not the application's safety or provenance
independently of the source of this document.

Public release status and outstanding requirements are in the
[release guide](release-guide.md). No stable release or automatic updater exists.
