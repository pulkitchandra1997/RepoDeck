# Installation Strategy

## Goal

Install RepoDeck on Windows and macOS with the least possible hurdles using free and open-source tooling.

## Recommended Packaging

Use Tauri's packaging system:

- Windows: NSIS `.exe` installer. Windows defaults to NSIS; do not distribute an MSI that bypasses the Git prerequisite hook.
- macOS: `.dmg` and `.app` bundle.
- Optional package managers:
  - Windows: Winget.
  - macOS: Homebrew Cask.

## Code Signing Reality

Completely frictionless installation on Windows and macOS usually requires paid code-signing certificates and Apple notarization. A fully free open-source project can still ship installers, but users may see OS warnings.

Recommended path:

### V1 Free Path

- Publish unsigned builds on GitHub Releases.
- Provide checksums.
- Document macOS Gatekeeper steps for unsigned apps.
- Document Windows SmartScreen warning expectations.
- Offer source builds for users who prefer to compile locally.

### V1 Better Open Source Path

- Apply for free or sponsored open-source code signing where available.
- Publish package manager manifests.
- Use GitHub Actions for reproducible builds.

### Future Mature Path

- Apple Developer Program for notarized macOS releases.
- Windows code-signing certificate.
- Automatic updates with signed update metadata.

## Compatibility Target

- Windows 10+.
- macOS 12+.
- x64 Windows.
- Apple Silicon and Intel macOS where CI/build resources allow.

## Installer Requirements

- No backend account required.
- No GitHub account required.
- Detect whether Git is installed.
- Offer user-approved Git installation if missing and recheck afterward.
- Store app data under OS-appropriate application data directories.

## Git Prerequisite Implementation

Windows NSIS uses `windows/git-prerequisite.nsh` before copying application files or registering shortcuts. It checks `git --version` through PATH and standard Git for Windows locations. When Git is absent, an interactive prompt offers Windows Package Manager's exact `Git.Git` package from the `winget` source in interactive mode. The prompt discloses network access and acceptance of source terms; Git setup retains its installation/license choices. RepoDeck does not disable hash verification, change credentials or remove Git during uninstall.

When winget is absent or installation fails/cancels, setup offers Git's official download page and a Retry check. Setup cannot continue until Git is detected. Silent setup with missing Git exits with code 2 without installing it. Administrators must provision Git before unattended deployment. Custom locations require PATH; standard machine/per-user locations also work with stale PATH values.

macOS `.dmg` files have no installer wizard. The first-launch check looks for actual Git executables on PATH, at Intel/Apple Silicon Homebrew locations and in standard Command Line Tools/Xcode locations. It avoids Apple's `/usr/bin/git` installation shim during detection. **Install Command Line Tools** explicitly invokes `/usr/bin/xcode-select --install`; Apple's dialog controls download, consent and licensing. Requesting installation is not treated as completion: finish Apple's installer, then choose **Check again**. A custom Xcode/toolchain location currently needs its real Git on PATH; automatic resolution of a nonstandard selected developer directory remains a follow-up.

Both platforms have a first-launch retry action. **Continue with files** permits local browsing without claiming Git is available. Repository operations use the same executable discovery as startup. Existing Git is not upgraded automatically. Detection validates a successful `git --version`, not every command/feature or a minimum-version policy.

Sources: [Tauri installer hooks](https://v2.tauri.app/distribute/windows-installer/), [WinGet installation options](https://learn.microsoft.com/en-us/windows/package-manager/winget/install), [Apple Command Line Tools installation](https://developer.apple.com/documentation/xcode/installing-the-command-line-tools).

Release gates: Git present/missing/broken, custom paths, cancellation, offline failures, missing winget, non-admin permissions, successful recheck, and normal Start menu launch. Windows installer lifecycle tests require a disposable VM or dedicated account. macOS Intel/Apple Silicon need real no-CLT, installed-CLT, Homebrew, pending-install and license/update failure tests. Browser fixtures and NSIS compilation do not prove OS-level installation success.

## Update Strategy

V1:

- Manual update from GitHub Releases.
- Optional in-app notification that a new version exists.

V2:

- Signed auto-update channel.
- Stable, beta, and nightly channels.
