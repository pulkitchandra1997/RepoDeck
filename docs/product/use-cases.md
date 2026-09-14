# Use Cases

## UC-01: Open an Application Folder

As a developer, I want to open a parent application folder so that I can see every Git repository and non-Git folder inside it.

Acceptance criteria:

- The app scans the selected folder recursively.
- Nested Git repositories are detected.
- Non-Git folders are shown separately.
- The user can exclude folders from future scans.

## UC-02: View Multi-Repository Status

As a developer, I want one status dashboard across all repositories so that I know which areas need attention.

Acceptance criteria:

- The dashboard shows clean, modified, staged, untracked, conflicted, and ignored state.
- Each repository has branch and remote information.
- Repositories with conflicts or detached HEAD are highlighted.

## UC-03: Inspect Repository Changes

As a developer, I want to inspect changed files in a repository so that I can decide what to commit, ignore, or discard outside the app.

Acceptance criteria:

- The app shows staged, unstaged, untracked, and ignored files.
- File diffs are available for text files.
- Binary and large files are clearly labeled.
- V1 avoids destructive actions unless explicitly confirmed.

## UC-04: Inspect Non-Git Folders

As a developer, I want to see non-Git folder structure so that generated or unmanaged project assets do not disappear from my mental model.

Acceptance criteria:

- Non-Git folders appear in the workspace tree.
- Folder size, file count, and last modified time are visible.
- The app can recommend initializing Git only as an optional action.

## UC-05: Manage Ignore Rules

As a developer, I want to understand why files are ignored so that I can fix bad ignore rules.

Acceptance criteria:

- The app identifies whether a file is ignored by `.gitignore`, `.git/info/exclude`, or global gitignore when Git can report it.
- The app can open ignore files for editing.
- The app warns before changing ignore rules.

## UC-06: Manage Agent Configuration

As a developer, I want to see agent configuration files across the workspace so that parallel agents follow the right project instructions.

Acceptance criteria:

- The app detects known agent instruction files and folders.
- The app shows which repository or folder each config belongs to.
- The app can open config files in the user's editor.
- Provider-specific behavior remains pluggable.

## UC-07: Prepare for Handoff

As a developer, I want to quickly identify changed repositories before handing work to another person or agent.

Acceptance criteria:

- The app shows dirty repositories, untracked files, branch divergence, and conflicts.
- The user can export a workspace status report.
- V2 can sync this report to a team workspace.

## UC-08: Open Source Contributor Onboarding

As a new contributor, I want the codebase and product direction to be easy to understand so that I can contribute safely.

Acceptance criteria:

- The repo includes architecture docs.
- Setup instructions work on Windows and macOS.
- Tests can run locally.
- Issues and contribution labels guide new contributors.

