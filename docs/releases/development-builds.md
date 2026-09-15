# Development Installer Builds

These are **unsigned test builds, not a published release**. They have not passed
clean-machine install/upgrade/uninstall testing or signing/notarization review.
Do not replace a working installation merely to test them. Never disable OS
security controls to run a build.

The following artifacts came from the successful
[dependency integration verification run](https://github.com/pulkitchandra1997/RepoDeck/actions/runs/34935360028)
at source commit `55594d0c223e4088f52a5059b9fa945f2e065e7c`, version `0.1.0`.
These include the updates integrated by PR #15. The subsequent main run
`34936270309` failed an Intel Mac frontend readiness test; these successful PR
artifacts do not prove the newer main verification is green or clear release gates.

| Platform | CI artifact download |
| --- | --- |
| Apple Silicon Mac | [ARM64 archive](https://github.com/pulkitchandra1997/RepoDeck/actions/runs/34935360028/artifacts/10383291995) |
| Intel Mac | [x64 archive](https://github.com/pulkitchandra1997/RepoDeck/actions/runs/34935360028/artifacts/10382469333) |
| Windows x64 | [Setup archive](https://github.com/pulkitchandra1997/RepoDeck/actions/runs/34935360028/artifacts/10382628819) |

GitHub may require sign-in. Artifacts expire under the workflow retention policy;
these links are not a replacement for permanent GitHub Releases. Extract the ZIP
to find the installer. The checksums below are for the installer inside, not the ZIP.

| Installer | SHA-256 |
| --- | --- |
| `RepoDeck_0.1.0_aarch64.dmg` | `cbac72ac28d66f332c6becd014adc1987a22ff72750111126dafdb637fc4eec4` |
| `RepoDeck_0.1.0_x64.dmg` | `2a8a5b751e5eb94c4b08d6e5d4c00450f5eea3360aa244b30b1c6bbc00e3d6a0` |
| `RepoDeck_0.1.0_x64-setup.exe` | `9b335d3da240f97a8624381412898ae54f3324bca65f1338d9ab5f5c434997cc` |

On macOS, inspect with `shasum -a 256 <installer.dmg>`. On Windows, use
`Get-FileHash -Algorithm SHA256 -LiteralPath <installer.exe>` in PowerShell.
Matching a checksum verifies the bytes, not the application's safety or provenance
independently of the source of this document.

Public release status and outstanding requirements are in the
[release guide](release-guide.md). No stable release or automatic updater exists.
