# Business Domains

## Workspace Management

The application-level folder is the primary domain object. A workspace may contain many repositories, non-Git folders, generated outputs, documentation folders, agent worktrees, and temporary folders.

Key concerns:

- Workspace discovery.
- Folder inclusion and exclusion.
- Workspace metadata.
- Local-only workspace preferences.
- Future cloud/team workspace sync.

## Repository Management

RepoDeck tracks each Git repository independently while also aggregating status at the workspace level.

Key concerns:

- Git status.
- Branch, remote, upstream, and divergence.
- Staged and unstaged changes.
- Untracked and ignored files.
- Conflicts.
- Commit history summary.
- Repository-specific Git config.

## Non-Git Folder Management

Non-Git folders matter because agentic workflows often produce prototypes, generated files, research, model outputs, scripts, and documentation outside repositories.

Key concerns:

- File tree browsing.
- Size and freshness signals.
- Conversion to Git repository.
- Ignore/exclude rules.
- Risk markers for large generated or secret-looking files.

## Agent Configuration Management

Agent settings are first-class project assets. RepoDeck should identify, inspect, and help manage common agent folders and files.

Examples:

- `.agents`
- `.claude`
- `.codex`
- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- Tool-specific workflow files.

Key concerns:

- Discover agent configuration.
- Show which repos or folders have agent instructions.
- Validate common configuration mistakes.
- Preserve provider neutrality.

## Git Configuration and Ignore Rules

Developers need to understand both repository-level and workspace-level ignore behavior.

Key concerns:

- `.gitignore`.
- `.git/info/exclude`.
- Global gitignore.
- Git user identity.
- Remotes and credentials.
- LFS usage.
- Hooks.
- Safe directory configuration.

## Installation and Distribution

The app must be easy to install on Windows and macOS using free and open-source tooling.

Key concerns:

- Cross-platform packaging.
- Code signing strategy.
- Auto-update strategy.
- Offline-friendly usage.
- Minimal setup steps.

## Open Source Governance

RepoDeck itself should be built as a contributor-friendly open-source project.

Key concerns:

- License.
- Contribution guide.
- Issue templates.
- Roadmap.
- Architecture documentation.
- Good first issues.
- Automated tests.

## Future Team Collaboration

V2 may introduce shared workspaces and cloud collaboration.

Key concerns:

- Accounts and identity.
- Team membership.
- Shared workspace metadata.
- Repository visibility.
- Comments and reviews.
- Agent activity timelines.
- Audit logs.

