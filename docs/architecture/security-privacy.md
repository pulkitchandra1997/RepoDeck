# Security and Privacy

## V1 Security Position

RepoDeck v1 is local-first. It should not upload source code, file contents, Git credentials, repository names, or workspace paths to any service.

## Credential Handling

- Use the user's existing Git credential helper.
- Do not store Git passwords or tokens.
- If secure storage is needed later, use OS keychain APIs through Tauri plugins.
- Display remote URLs carefully because they may contain embedded credentials.

## Filesystem Safety

- Do not execute repository scripts during scanning.
- Do not follow symlinks outside the workspace unless the user enables it.
- Avoid indexing large binary file contents.
- Detect likely secret files only through filenames and metadata in v1, unless the user explicitly runs a scanner.

## Git Safety

- Read-only Git operations should be the default.
- Destructive actions, such as discard changes, clean untracked files, reset branch, or delete branch, should require explicit confirmation.
- High-risk commands should show exact repository path and affected files before execution.

## Future V2 Cloud Safety

V2 cloud sync should default to metadata-only sync:

- Repository name.
- Relative path.
- branch.
- status counts.
- agent config presence.
- timestamps.

Source file contents, diffs, secrets, and private remote URLs should not sync unless explicitly enabled by an administrator or workspace owner.

