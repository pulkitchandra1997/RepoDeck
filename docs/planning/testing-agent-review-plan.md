# Testing and Agent Review Plan

## Testing Philosophy

RepoDeck must be tested like a local developer tool that touches real files. The highest-risk areas are filesystem scanning, Git status correctness, ignored file handling, platform differences, and accidental destructive behavior.

## Automated Testing

### Unit Tests

- Git status parsing.
- Repository discovery.
- Ignore rule interpretation.
- Agent config detection.
- Settings validation.
- Report generation.

### Integration Tests

- Temporary multi-repo workspaces.
- Nested Git repositories.
- Non-Git folders.
- Conflicted repositories.
- Detached HEAD.
- Large ignored folders.
- Symlinks.

### UI Tests

- Workspace add flow.
- Dashboard rendering.
- Repository matrix filtering.
- File status tabs.
- Settings changes.
- Export report flow.

### Platform Tests

- Windows path handling.
- macOS path handling.
- Unicode paths.
- Long paths.
- Permission-denied folders.
- Missing Git installation.

## Agent Review Roles

Use separate agent review perspectives before implementation milestones:

- Product agent: validates workflows and user value.
- Architecture agent: validates boundaries, extensibility, and v2 readiness.
- Security agent: reviews credential, filesystem, and Git command risks.
- Installer agent: reviews Windows and macOS packaging friction.
- UX agent: reviews clarity, accessibility, and daily usability.
- Open-source agent: reviews contributor experience and governance.
- QA agent: builds edge-case test scenarios.

## Manual Acceptance Scenarios

1. Open a folder with three Git repos and two non-Git folders.
2. Modify files in multiple repos and confirm dashboard counts.
3. Add ignored files and confirm ignored state is visible when enabled.
4. Add `.agents` and `.claude` configs and confirm detection.
5. Open a private repository and confirm no cloud upload occurs.
6. Export a workspace report.
7. Install app on Windows from release artifact.
8. Install app on macOS from release artifact.

## Release Gates

- No known destructive Git bugs.
- No required network dependency for v1 core flows.
- Install docs verified on Windows and macOS.
- Workspace scan handles permission errors gracefully.
- UI remains responsive during large scans.

