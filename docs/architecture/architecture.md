# Architecture

## Recommended Stack

RepoDeck should use **Tauri** for the desktop shell, **Rust** for native filesystem and Git operations, and **React + TypeScript** for the UI.

Why this stack:

- Tauri produces smaller installers than Electron.
- Rust is strong for filesystem scanning, concurrency, and native integrations.
- React and TypeScript are familiar to many open-source contributors.
- The architecture can stay local-first while leaving clean API boundaries for V2 cloud features.

Alternative:

- Electron is easier for some contributors and has mature GitHub Desktop precedent, but it usually creates larger applications and higher memory usage.

## High-Level Components

```text
RepoDeck Desktop App
  UI Layer
    Workspace Dashboard
    Repository Detail
    File Explorer
    Agent Config Center
    Settings

  Application Layer
    Workspace Service
    Repository Service
    File Index Service
    Agent Config Service
    Report Service
    Settings Service

  Native Layer
    Git Adapter
    Filesystem Scanner
    File Watcher
    OS Integration
    Secure Storage Adapter

  Local Persistence
    SQLite
    Local JSON Config
    OS Keychain references only

  Future V2 Boundary
    Sync Adapter
    Team API Client
    Auth Provider
```

## Architectural Principles

- Keep UI independent from Git implementation details.
- Treat local scan results as a local index, not as authoritative truth forever.
- Never require cloud services for core v1 features.
- Put all future sync behavior behind a `SyncAdapter` interface.
- Keep destructive Git actions isolated, audited, and confirmable.

## Data Flow

1. User adds a workspace folder.
2. Workspace Service asks Filesystem Scanner to discover folders.
3. Scanner streams repository and folder candidates.
4. Repository Service asks Git Adapter for status per repository.
5. File Index Service records lightweight metadata in SQLite.
6. UI receives progressive updates.
7. File Watcher schedules incremental rescans.
8. Report Service exports workspace state on demand.

## Local-First to Cloud-Ready Boundary

V1 local services should expose internal domain events:

- `workspace.added`
- `workspace.scanned`
- `repository.status_changed`
- `agent_config.detected`
- `report.generated`

In V1, these events only update local state. In V2, a Sync Adapter can subscribe to selected events and sync safe metadata to team workspaces.

## Suggested Module Layout

```text
apps/desktop/
  src/
    app/
    features/
      workspace/
      repositories/
      file-tree/
      agent-configs/
      settings/
    shared/
      components/
      hooks/
      styles/

crates/
  core/
    src/
      domain/
      services/
      ports/
  git/
    src/
  scanner/
    src/
  persistence/
    src/
  tauri-commands/
    src/

docs/
```

## V2 Team Collaboration Extension

See [V2 Cloud and Team Collaboration](v2-team-collaboration.md) for identity boundaries, multi-team bindings, privacy requirements, acceptance gates, and open decisions. This is planned architecture, not a claim that synchronization exists in v1.

The future cloud layer should not replace local functionality. It should add:

- Workspace membership.
- Shared metadata sync.
- Team comments.
- Assignment and ownership markers.
- Agent activity timelines.
- Optional encrypted snapshots.

The v1 local model should include stable IDs for workspaces and repositories so v2 can map local entities to team entities later.
