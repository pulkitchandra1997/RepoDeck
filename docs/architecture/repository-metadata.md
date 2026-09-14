# Repository Identity and Status Presentation

## Local Metadata

Custom names are stored in the existing atomic `settings.json` file under `repositoryAliases`, a map from normalized absolute checkout path to alias. Windows drive and UNC paths are normalized for case and separators, including extended path prefixes. POSIX paths retain case. The same checkout included through overlapping workspace roots shares an alias; different clones and worktrees can have separate aliases.

The default Windows location is `%APPDATA%/org.repodeck.desktop/settings.json`; macOS uses the Tauri application configuration directory. The existing `REPODECK_DATA_DIR` override is used by isolated tests. No metadata is written into project folders, `.git/config`, or remote repositories. Old settings default to an empty alias map. Names are limited to 80 characters, with no control characters. Empty input clears the override. Failed saves retain the editing draft and leave the previous settings file unchanged.

Aliases survive removal/re-addition of a workspace on the same path. Moving a checkout to a different path does not automatically transfer its alias. This is local path identity, not a cloud/team repository identity. No cloud sync or shared `.repodeck/workspace.json` is implemented. Aliases are not currently included in exported reports.

Alias saves share the application's preference-saving state. Settings and automatic-refresh changes are disabled during an alias save, and alias controls are disabled during other preference writes. Failure releases the guard without discarding the alias draft. This UI guard does not provide cross-process concurrency control.

## Names and Badges

Unsaved alias drafts are kept in application memory by canonical checkout identity, so navigation and streaming scan updates do not discard them. Save or confirmed discard clears the draft. Restart does not retain unsaved drafts. Workspace add/remove now shares the preference-saving guard; the current selection is reconciled against the returned list after removal.

The original name is the final component of the redacted `origin` URL, falling back to the checkout folder name. Git has no universal repository-name setting. Custom names appear alongside the original name; the path appears below with an absolute-path tooltip. Filtering matches names and paths.

Language detection uses scanned manifest and source filenames only, never executes build tools, never downloads dependencies and never reads source contents. It recognizes manifests for Java, Python, TypeScript, Go, Rust, Ruby, PHP, Swift, Dart and .NET. A package.json indicates a JavaScript project unless TypeScript evidence exists. Source-only projects use the unique most frequent recognized source-file extension; ties remain unlabelled. Distinct build manifests can produce multiple labels. Gradle alone is deliberately not treated as proof of Java because Gradle can build other languages.

Nested repositories are separate detection boundaries. Common dependency/generated directories are ignored. Results are recomputed from each scan and are not saved as user preferences. Truncated scans or unusual layouts may leave badges absent or incomplete; these are project-type hints, not a complete language inventory.

Language dictionaries match only their own explicitly supported keys. Extensionless files such as `go` or `py` do not count as source evidence, and object-property-like filenames such as `constructor` or `__proto__` do not produce labels.

## Git Colors

- Green: added/copied or untracked files.
- Amber: modified, renamed or type-changed files.
- Red: deleted or conflicted files. All seven Git unmerged states are explicitly labelled Conflict.
- Neutral: unchanged/non-Git/unavailable states and ignored files.

Staged and unstaged labels remain explicit; color never substitutes for the text label. File-tree status is scoped to the nearest discovered repository, so a parent's status cannot override a nested checkout. Deleted files remain visible in the repository change list, not the on-disk file tree. Changed containing directories inside a repository inherit the most severe child status.

Diff additions are green and removals red, without coloring diff headers. Unmerged files open their working-file preview with conflict markers highlighted. Binary, deleted-in-conflict or unavailable previews retain their existing errors/classification; RepoDeck does not resolve or modify conflicts.

## Bounded File Previews

Text and unified diff previews render at most 1,000 lines at once. Larger previews expose first/previous/next/last page controls and an explicit Copy full content action, including failure feedback. Source numbering remains absolute; diff counters are reconstructed from preceding hunks when a page begins within a hunk. Changing content resets the displayed page. Line-number gutters do not wrap or enter copied text.

Paging does not increase the existing backend file-size limit or modify files. Full-content copying copies the content returned by the backend, not bytes omitted by backend limits. `npm run test:preview-performance` builds fresh production assets and checks synthetic 1,000-, 50,000- and 250,000-line files, bounded DOM rows, last-page numbering and narrow-window layout. Its timings are host-specific measurements, not performance guarantees.

## Verification

`npm test` covers naming fallback, path keys, aliases across reload, clearing and save failures, build/source detection, nested boundaries, status codes and diff colors. Rust settings/repository tests cover backward compatibility, atomic alias persistence, validation, project-folder non-modification and origin credential redaction. `npm run test:repository-metadata` checks names, badges, alias persistence/search and colored files/diffs at 1280, 800 and 600 pixels using fixture IPC. Native installer and macOS execution are separate release checks.
