# UX and Design Specification

## Product Feel

RepoDeck should feel like a calm engineering cockpit, not a marketing product. It should be dense enough for daily work, but clear enough that a new contributor can open a workspace and understand what is happening.

## Primary Navigation

Recommended layout:

- Left sidebar: workspaces and high-level sections.
- Main panel: dashboard, repository list, or file tree.
- Right inspector: selected repository, file, agent config, or warning details.
- Bottom status strip: scan state, Git availability, watcher status.

## Core Screens

### Workspace Dashboard

Purpose: show the entire application folder at a glance.

Expected elements:

- Workspace name and root path.
- Repository summary counts.
- Dirty repository list.
- Conflict warnings.
- Non-Git folder summary.
- Agent configuration summary.
- Scan and export actions.

### Repository Matrix

Purpose: compare many repositories quickly.

Columns:

- Repository.
- Path.
- Branch.
- Status.
- Staged.
- Unstaged.
- Untracked.
- Ignored.
- Ahead/behind.
- Remote.
- Last scanned.

### Repository Detail

Purpose: inspect one repository.

Areas:

- Header with branch, remote, and status.
- File status tabs: all, staged, unstaged, untracked, ignored, conflicts.
- Diff viewer for selected file.
- Git config panel.
- Agent config panel.

### File Explorer

Purpose: show Git and non-Git folder structure.

Features:

- Tree view with Git repository badges.
- Non-Git folder badges.
- Hidden/ignored toggle.
- Size and modified metadata.
- Open in editor and terminal actions.

### Agent Config Center

Purpose: inventory project instructions and agent settings.

Features:

- Config list grouped by provider.
- Folder/repository ownership.
- Validation status.
- Open file action.
- Future provider plugin hooks.

### Settings

Purpose: configure local behavior.

Sections:

- General.
- Workspaces.
- Git.
- Editor and terminal.
- Scanning.
- Privacy.
- Future cloud/team placeholder.

## Design System

Visual direction:

- Neutral base colors with clear semantic accents.
- Use status colors sparingly and consistently.
- Compact tables and lists.
- 8px or smaller radius for cards and panels.
- Strong keyboard focus states.
- Icons for common actions.

Status colors:

- Clean: green.
- Modified: amber.
- Conflict: red.
- Untracked: blue.
- Ignored: gray.
- Detached/unknown: purple or neutral warning.

## Key Interaction Rules

- Scanning should show progressive results.
- The user should never wait on a blank screen.
- High-risk actions need confirmation.
- Clicking a repository should not lose workspace context.
- The app should make hidden complexity visible without overwhelming the first view.

