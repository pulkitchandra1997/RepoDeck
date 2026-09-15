# Contributing to RepoDeck

Start with the setup and checks in [the development guide](DEVELOPMENT.md). Product requirements and the verification ledger define v1 scope and unfinished work.

AI-assisted contributions follow [the AI contribution policy](docs/agents/ai-contribution-policy.md).
Coding agents should start with [AGENTS.md](AGENTS.md) and [the knowledge map](docs/agents/knowledge.md).
Use a topic branch and PR; `main` requires passing `Desktop verification`, including for the maintainer.

## Layout

- `crates/core`: filesystem, Git, settings, previews and report services, with real filesystem/Git tests.
- `src-tauri`: native window, OS dialogs, IPC commands and packaging configuration.
- `apps/desktop/src`: React UI, typed backend contract and interaction tests.
- `scripts`: icon generation and browser/native workflow checks.
- `docs`: product, design, architecture and verification decisions.

## Changes

Discuss substantial new features in an issue before implementation. For fixes, provide a reproducible case and a regression test. Keep changes focused and preserve existing user files and configuration. Git subprocesses must use argument arrays and must not execute repository scripts automatically.

Run the relevant unit/integration checks, frontend build and Rust formatting/lint checks. State which platforms you actually tested. Browser fixture tests do not replace native or installer testing. Never include repository credentials, private project content, access tokens or personal paths in test fixtures or issue attachments.

Open a pull request with the problem, resulting behavior, verification and remaining limitations. Contributions are under the project's MIT license. Maintainers review behavior, safety, accessibility and contributor readability. An issue tagged `good first issue` should include a bounded acceptance test and relevant file paths.

## Review Coverage

Installer, UX, accessibility, Git compatibility, security and performance reviews should be performed independently when possible. Record actual reviewer evidence; do not label a checklist as an independent review.
