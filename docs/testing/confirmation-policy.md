# Action Confirmation Policy

## Implemented

- Workspace removal requires a named confirmation showing the absolute folder path. It only removes the saved workspace entry, never project files. Cancel and Escape do not call the backend. Duplicate removal requests are blocked, and failures preserve the entry.
- Closing modified settings, through the close button or Escape, requires Discard changes. Cancel keeps the draft. Unchanged settings close directly.
- Saving a changed editor application or scan scope requires Apply settings. The review shows the configured executable and the new scan limits, exclusions and hidden-folder choice. Editor validation remains in the backend; approval is at configuration time, not a new prompt on every launch.
- Git setup requires a second explicit action before opening the Windows download page or requesting Apple Command Line Tools. OS approval and licenses remain the user's responsibility.
- Existing preference recovery retains its backup-and-reset confirmation. Remote URL opening retains its destination review.
- Shared confirmation dialogs focus Cancel, trap Tab navigation, support Escape, make background content inert, and restore focus when its originating control still exists. Confirmations never offer a permanent bypass.

## Export Replacement

Exports use the native rfd save dialog. No additional duplicate browser prompt is added. Interactive replacement confirmation on Windows and macOS remains a required native verification case, not covered by browser mocks. Verify Cancel preserves the destination file byte-for-byte and approval replaces only the selected report.

## Future Feature Requirements

Before implementing destructive Git operations, review the exact repository, branch and affected files. Discard, hard reset and untracked-file deletion need explicit loss warnings and backup/stash options where available. Disk deletion is distinct from list removal and requires the repository name. Force push must identify the remote and branch.

Review configuration and agent-file diffs before writes. Agent/script execution must show the command, working directory and permissions. Bulk operations need a target review and per-repository results. Cloud uploads, invitations, permission changes and credential removal must show the data or access affected. These features are not implemented by this change.

Routine navigation, previews, filtering, refresh and launching the configured editor or terminal remain direct actions.

## Verification

Run `npm test`, `npm run test:git-setup` and `npm run build`. Unit coverage includes cancellation, confirmed removal, failure preservation, focus restoration, keyboard trapping, unsaved settings and installation consent. Git setup browser checks use mocked platform responses; no system installers execute. The normal installed application is not upgraded by these tests.
