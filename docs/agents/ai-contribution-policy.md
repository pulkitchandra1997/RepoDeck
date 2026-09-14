# AI Contribution Policy

RepoDeck is developed with AI coding assistance under human maintainer direction.
This describes the development process, not a claim that every file was generated
by AI, independently audited, or produced by a particular model.

## Accountability and Provenance

- Humans remain accountable for accepted changes, security decisions and releases.
  Agent instructions do not confer repository access or merge authority.
- AI-assisted contributions are welcome under the same quality and MIT contribution
  terms as other contributions. Review generated code for correctness, dependency
  licenses and provenance; do not submit material you are not entitled to contribute.
- In each PR, disclose material AI assistance, the tool if known, the work it assisted
  with, and what was verified. Do not invent model versions, authors or review results.
- Do not add fabricated co-author identities or blanket generated-file headers.
  Attribute third-party code and assets where their licenses require it.
- Do not upload credentials, private checkouts or sensitive logs to an AI provider.
  Contributors choose tools according to their own data-sharing obligations.

## Work and Review

1. Establish a bounded task and acceptance criteria. Inspect the current code and
   relevant instructions before modifying it.
2. Implement on a topic branch. Preserve user data and unrelated changes; use
   isolated fixtures and scoped processes for testing.
3. Verify the actual revision. Include failures, exclusions and platform limitations
   in the PR template, not just successful checks.
4. Seek independent review for Git execution, credentials, settings recovery,
   IPC permissions and installer changes. A second agent is useful additional
   evidence, not a substitute for maintainer accountability or an OS sandbox.
5. Merge only with authorization and passing required checks. Release approval is
   separate and follows the release guide.

## Shared Instructions and Local Settings

`AGENTS.md` is the canonical shared guide. `CLAUDE.md` imports it; Copilot's
repository instructions point to it. Tool support varies: verify that your client
has loaded the instructions before relying on them.

No shared `.codex/config.toml`, Claude permission allowlist, executable hooks, MCP
server definitions or automatic agent jobs are needed for this documentation setup.
Such settings would change execution or data-access behavior and require a separate
review. Keep personal settings, credentials, sessions and auto-memory untracked.
Reviewed reusable rules or skills can be added later without copying the shared guide.

Instructions are guidance, not a security boundary. GitHub permissions, branch
protection and CI enforce repository policy; local sandbox and approval controls
remain the responsibility of each agent runtime. Do not disable them for convenience.

## Conventions

- [AGENTS.md](https://agents.md/) describes the cross-tool instruction convention.
- [Claude memory documentation](https://code.claude.com/docs/en/memory) describes
  `CLAUDE.md` and its file-import syntax.
- [GitHub repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions-in-your-ide/add-repository-instructions-in-your-ide)
  describes `.github/copilot-instructions.md`.

Keep this policy concise and versioned with the code. Durable technical knowledge
belongs in [the knowledge map](knowledge.md) and its linked documents, not in a
committed conversation history.
