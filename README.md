# RepoDeck

**One place to see the Git repositories, files and agent configuration across your projects.**

RepoDeck is a local-first desktop app for developers working across multiple
projects and AI coding agents. Add a folder to discover its repositories, or add
a single checkout. Your projects stay on your machine.

[Downloads](#downloads-and-version) |
[Getting Started](#getting-started) |
[Contributing](CONTRIBUTING.md) |
[Development Guide](DEVELOPMENT.md)

## Downloads and Version

**[v0.1.0 unsigned development preview](https://github.com/pulkitchandra1997/RepoDeck/releases/tag/v0.1.0) is available.**
This is an experimental prerelease, not a stable release or installation certification.

| Your computer | Download installer |
| --- | --- |
| Windows x64 (Intel / AMD) | [Windows setup (.exe)](https://github.com/pulkitchandra1997/RepoDeck/releases/download/v0.1.0/RepoDeck_0.1.0_windows_x64-setup.exe) |
| macOS Apple Silicon (M-series) | [Apple Silicon (.dmg)](https://github.com/pulkitchandra1997/RepoDeck/releases/download/v0.1.0/RepoDeck_0.1.0_macos_arm64.dmg) |
| macOS Intel | [Intel Mac (.dmg)](https://github.com/pulkitchandra1997/RepoDeck/releases/download/v0.1.0/RepoDeck_0.1.0_macos_x64.dmg) |

**Installers are unsigned; macOS builds are not notarized.** Windows may show a
security warning and macOS may block launch. Do not disable operating-system
security controls. On a Mac, use Apple menu > About This Mac to check the processor.

Choose the installer for your platform. The release's `.sha256` checksums and
`.json` build records are optional verification files. GitHub's source-code archives
are for developers, not application installation. Git is required for repository
inspection; there is no automatic updater.

The source version is also `0.1.0`, but a source checkout can contain changes absent
from that published preview. The release records source
[`30056dd`](https://github.com/pulkitchandra1997/RepoDeck/commit/30056ddbaae3e59ad893306b3e7800991e95050f)
and installers from successful main [CI run 34944670054](https://github.com/pulkitchandra1997/RepoDeck/actions/runs/34944670054).
All three build targets passed. These are distribution targets, not a verified
OS-version support matrix: clean-machine installation, upgrade/uninstall and native
Mac application workflows remain unverified for this preview. The later tag
[run 34998022414](https://github.com/pulkitchandra1997/RepoDeck/actions/runs/34998022414)
failed release readiness; it is not successful build or publication evidence.
See the [current verification summary](docs/planning/v1-verification.md#current-summary-2026-09-15)
for evidence and outstanding gates, including incomplete third-party notices.

![RepoDeck file browser showing Git status colors and a numbered conflict preview](docs/images/files-and-conflicts.png)

*Actual RepoDeck UI with synthetic demo data. Screenshot uses browser fixture IPC;
it is not evidence of native installer testing.*

## What You Can Do

- **See multiple repositories together:** branches, changed files, conflicts and
  nested checkouts in one workspace.
- **Browse all project files:** Git repositories and ordinary folders, with
  numbered text previews and color-coded changes.
- **Find the right project:** workspace/repository search, custom aliases and
  language hints from project files.
- **Inspect agent configuration:** discover agent files alongside the code they describe.
- **Review Git settings:** inspect configuration, hooks, LFS and ignore rules.
- **Keep a local record:** export workspace reports as Markdown or JSON.

RepoDeck is an inspection and organization tool, not a replacement for every Git
command. It does not execute discovered agent instructions or resolve conflicts for you.

## Getting Started

1. Choose your platform's [preview download](#downloads-and-version) and review its warnings, or build from source with the [development guide](DEVELOPMENT.md).
2. Use the folder button beside **Workspaces** to select a project folder or Git checkout.
3. Switch between **Repositories**, **Files** and **Agents** to inspect the workspace.

Want safe sample projects? Run `npm run fixtures:create` from a development checkout.
See [the test workspace guide](docs/testing/manual-workspace.md) for the generated layout.

## Privacy and Limitations

Core functionality runs locally without a RepoDeck cloud account. Custom names and
preferences are saved in local application settings, not inside your repositories.
Public and private checkouts are inspected using your installed Git; authentication
remains managed by Git and its credential helpers.

Open trusted local repositories only. Git must support `git --no-lazy-fetch --version`.
Comparisons requiring content filters, including LFS, are currently blocked rather
than executed. Inspect submodule working-file changes in the submodule's own entry.
See [security boundaries](SECURITY.md) and [known verification gaps](docs/planning/v1-verification.md).

Optional team/cloud collaboration is planned for v2; it is not available today.

## Contribute

RepoDeck is AI-assisted and human-maintained. Bug reports, reproducible test cases,
documentation and focused pull requests are welcome.

- [Contributor guide](CONTRIBUTING.md)
- [Agent instructions](AGENTS.md) and [AI contribution policy](docs/agents/ai-contribution-policy.md)
- [Product requirements](docs/product/requirements.md) and [architecture](docs/architecture/architecture.md)
- [Release process](docs/releases/release-guide.md)

Source code is licensed under [MIT](LICENSE). Third-party dependencies retain their own licenses.
