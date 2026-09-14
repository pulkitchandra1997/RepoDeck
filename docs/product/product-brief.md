# Product Brief

## Working Name

RepoDeck

## Product Vision

RepoDeck is a GitHub Desktop-inspired application for developers who work across many applications, many repositories, and many coding agents at the same time. It gives one calm, consolidated operating view of an application folder: Git repositories, non-Git folders, file structures, changed files, untracked files, ignored files, agent settings, Git settings, and project health.

## Problem

Modern AI-assisted software development often creates more parallel work:

- One application may contain many repositories.
- Multiple agents may edit different areas at the same time.
- Some folders are Git repositories, while others are local workspaces, generated artifacts, logs, prototypes, or vendor code.
- Developers need to understand what changed, what is ignored, what is untracked, and which agent or workflow owns which area.
- GitHub Desktop works well for one repository at a time, but it does not give a project-level operating view across nested or sibling repositories.

## Target Users

- Solo developers using AI coding agents.
- Open-source maintainers managing many repos locally.
- Startup teams working in monorepos, polyrepos, and generated workspaces.
- Engineering leads who want a local-first overview of project state.
- Contributors who need a simpler way to understand unfamiliar multi-repo projects.

## Core Promise

Open an application folder and immediately understand:

- Which folders are Git repositories.
- Which folders are not Git repositories.
- What changed in each repository.
- Which files are untracked, ignored, modified, staged, conflicted, or clean.
- Which agent configuration files exist, including `.agents`, `.claude`, and future provider folders.
- Which repositories need attention before a commit, pull, merge, handoff, or release.

## Version Strategy

### V1: Local-First Desktop

V1 has no required backend. It scans local folders, reads Git state, manages local configuration, and launches installed tools. It should work on Windows and macOS with the least possible installation friction.

### V2: Optional Cloud and Team Collaboration

V2 may add signed-in teams, shared workspace metadata, repository ownership, cloud-synced settings, team dashboards, comments, role-based access, and agent run history. V1 architecture should keep these extension points open without requiring cloud services.

## Success Criteria

- A developer can add one application folder and see all nested Git repos and non-Git folders.
- The app can show status across many repositories without requiring every repository to be opened separately.
- Private repositories remain private because credentials and file content stay local in V1.
- The installer is free and open-source friendly.
- The codebase is approachable for contributors.

