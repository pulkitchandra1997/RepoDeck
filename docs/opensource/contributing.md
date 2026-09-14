# Contributing to RepoDeck

Thanks for helping build RepoDeck.

## Development Principles

- Keep v1 local-first.
- Do not add required backend dependencies.
- Keep private repository information private.
- Prefer safe read-only behavior unless a user explicitly asks for a write action.
- Keep platform behavior clear for Windows and macOS.

## Local Setup

The planned stack is:

- Tauri.
- Rust.
- React.
- TypeScript.
- SQLite.

Setup instructions will be finalized once the codebase is scaffolded.

## Pull Request Expectations

- Explain the user-facing behavior.
- Include tests for domain logic.
- Include screenshots for meaningful UI changes.
- Avoid unrelated refactors.
- Update docs when behavior changes.

## Issue Labels

Recommended labels:

- `good first issue`
- `help wanted`
- `area:git`
- `area:scanner`
- `area:ui`
- `area:installer`
- `area:docs`
- `area:agent-config`
- `v2-cloud`

## Security

Do not file public issues for vulnerabilities involving credentials, private repository data, or unsafe Git command execution. A `SECURITY.md` file should be added before public launch.

