# Requirements

## Product Principles

- Local-first by default.
- No required backend in V1.
- Provider-neutral Git support.
- Works with public and private repositories.
- Safe by default for file and Git operations.
- Fast enough for large workspaces.
- Clear extension points for V2 cloud and team collaboration.

## Functional Requirements

### Workspace

- Add, remove, and rescan application folders.
- Recursively discover Git repositories.
- Detect non-Git folders.
- Allow users to exclude folders from scanning.
- Persist local workspace preferences.

### Git

- Show repository status.
- Show active branch, remote, upstream, ahead/behind state, and detached HEAD.
- Show staged, unstaged, untracked, ignored, conflicted, renamed, and deleted files.
- Show text diffs.
- Open repositories in terminal or editor.
- Open repository remote URL in browser.
- Read repository Git config.
- Detect hooks and LFS usage.

### File Tree

- Show Git and non-Git folder hierarchy.
- Display file counts, sizes, and last modified times.
- Hide heavy folders by default, such as `node_modules`, `.git`, build outputs, and virtual environments.
- Let users reveal hidden and ignored files.

### Agent Settings

- Detect common agent configuration files and folders.
- Show agent configuration inventory by workspace, repository, and folder.
- Open configs in editor.
- Provide validation hooks for future provider-specific checks.

### Reports

- Export local workspace status as Markdown and JSON.
- Include repository status, non-Git folders, agent configs, and warnings.
- Avoid exporting secrets by default.

### Settings

- Manage scan depth, excluded folders, editor command, terminal command, and performance settings.
- Read-only display for sensitive Git credential information.
- Support light and dark themes.

## Non-Functional Requirements

### Compatibility

- Windows 10 and newer.
- macOS 12 Monterey and newer as the practical baseline.
- Apple Silicon and Intel macOS builds when packaging allows.

The phrase "any versions" is not technically realistic for desktop software. The goal should be broad compatibility with actively supported OS versions and graceful failure on older systems.

### Performance

- Initial scan should stream results progressively.
- File watchers should debounce changes.
- Large folders should not freeze the UI.
- Git operations should run in worker processes.

### Security

- V1 should not upload repository contents.
- Private repo credentials remain managed by Git, OS credential helpers, or the user's existing tools.
- Destructive operations require explicit confirmation.
- The app should avoid executing repository scripts automatically.

### Accessibility

- Keyboard navigable.
- Screen-reader friendly labels.
- High contrast support.
- Clear focus states.

## V2 Open Points

- Team accounts and identity.
- Shared workspace metadata.
- Cloud-synced workspace status.
- Comments and annotations.
- Role-based access controls.
- Agent run history.
- Organization-level policies.
- Hosted update channels and enterprise deployment.

