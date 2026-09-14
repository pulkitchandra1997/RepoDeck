# RepoDeck Product Design

## Status

Approved product direction: local-first desktop application for v1, with explicit extension points for v2 cloud and team collaboration.

## Summary

RepoDeck is a GitHub Desktop-inspired workspace manager for modern AI-assisted development. It focuses on application folders that may contain many Git repositories, non-Git folders, generated assets, and agent configuration files. The app gives developers one consolidated view of repository state, file structure, ignored and untracked files, Git configuration, and agent settings.

## V1 Scope

V1 is local-first and requires no backend account. It scans local folders, detects repositories and non-Git folders, reads Git status, displays file changes, inventories agent configuration, and exports local reports. It should work with public and private repositories because credentials and repository contents stay on the user's machine.

## V2 Open Point

V2 may add cloud and team collaboration, but only as an optional layer. The v1 architecture keeps stable workspace and repository IDs, domain events, and sync-adapter boundaries so team features can be added without rewriting core local behavior.

V2 candidates include team workspaces, shared metadata sync, comments, role-based access, agent activity timelines, and organization policies.

## Architecture Decision

Recommended stack:

- Tauri for desktop packaging.
- Rust for filesystem, Git, and native services.
- React and TypeScript for UI.
- SQLite for local persistence.

This balances installer size, performance, open-source contribution ergonomics, and long-term extensibility.

## Core Product Areas

- Workspace dashboard.
- Repository matrix.
- Repository detail and diff inspection.
- File explorer for Git and non-Git folders.
- Agent configuration center.
- Git and ignore-rule inspection.
- Settings.
- Exportable workspace reports.

## Installation Strategy

V1 should use free and open-source distribution paths:

- GitHub Releases.
- Windows `.msi` or `.exe`.
- macOS `.dmg` or `.app`.
- Checksums.
- Optional Winget and Homebrew Cask manifests.

Unsigned builds may trigger Windows SmartScreen or macOS Gatekeeper warnings. A mature release path can later add paid signing and notarization.

## Documentation Pack

The full product package is split across:

- `docs/product`
- `docs/architecture`
- `docs/design`
- `docs/opensource`
- `docs/planning`

## Self-Review

- No backend is required for v1.
- V2 cloud/team collaboration is preserved as an explicit extension point.
- Private repository handling is local and privacy-preserving.
- Installer limitations are stated honestly.
- The scope is large enough to require phased implementation.

