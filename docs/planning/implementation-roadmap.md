# Implementation Roadmap

## Phase 0: Product Foundation

- Finalize product requirements.
- Finalize architecture.
- Create Figma mockups.
- Create project pitch deck.
- Choose license.
- Create public roadmap.

## Phase 1: App Scaffold

- Create Tauri desktop app.
- Set up React and TypeScript.
- Set up Rust workspace crates.
- Add CI for Windows and macOS.
- Add formatting and linting.

## Phase 2: Workspace Discovery

- Add workspace picker.
- Implement recursive scanner.
- Detect Git repositories.
- Detect non-Git folders.
- Add scan exclusions.
- Stream scan progress to UI.

## Phase 3: Git Status

- Implement Git Adapter.
- Read branch, remote, status, ahead/behind.
- Show repository matrix.
- Show file status groups.
- Add diff viewer.

## Phase 4: Agent Configuration Center

- Detect `.agents`, `.claude`, `.codex`, `AGENTS.md`, `CLAUDE.md`, and related files.
- Show config inventory.
- Open configs in editor.
- Add validation extension points.

## Phase 5: Settings and Reports

- Add local settings.
- Add workspace status export as Markdown and JSON.
- Add privacy controls.
- Add editor and terminal integration.

## Phase 6: Packaging

- Build Windows installer.
- Build macOS app and DMG.
- Publish GitHub Releases.
- Add checksums.
- Add install documentation.
- Explore Winget and Homebrew Cask distribution.

## Phase 7: Public Open Source Launch

- Add contribution guide.
- Add code of conduct.
- Add security policy.
- Add issue and PR templates.
- Add project board.
- Seed good first issues.

## V2 Candidate Roadmap

Scope remains open. Resolve the decisions and acceptance gates in [V2 Cloud and Team Collaboration](../architecture/v2-team-collaboration.md) before committing to implementation or hosted-service costs.

- Optional user accounts.
- Team workspaces.
- Metadata-only cloud sync.
- Shared comments.
- Agent activity timeline.
- Team policies.
- Enterprise installation support.
