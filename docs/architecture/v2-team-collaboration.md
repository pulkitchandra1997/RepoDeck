# V2 Cloud and Team Collaboration

Status: planned extension, not implemented. The local-first direction is agreed; the decisions below remain open for v2 discovery.

## Product Boundary

V1 works without an account or RepoDeck server. Connecting a private Git repository does not require joining a RepoDeck team. V2 may add organizations, teams, shared projects, comments, ownership, and agent activity without replacing local Git operations.

A user can belong to multiple teams. Each team can manage several application projects, and each project can reference several repositories from different Git hosts. Membership never grants Git-host access automatically.

## Structure to Preserve

```text
Desktop UI -> Application services -> Local Git/filesystem/persistence adapters
                                  -> Optional collaboration adapter (v2)
                                       -> Team API and authorization
                                       -> Shared metadata store

Organization -> Teams -> Shared projects -> Repository references
Device -> Local workspace -> Local checkouts and non-Git folders
Local workspace <-> Explicit shared-project binding
```

Keep Git and filesystem operations behind native interfaces. Keep identity, membership, authorization, synchronization, and hosted storage outside the local core. V1 should not acquire an unused server, account dependency, or remote-command mechanism merely to prepare for v2.

## Identity and Data Ownership

- Use stable local workspace and repository IDs, independent of folder names or absolute paths. A worktree or second clone is a distinct local checkout.
- Use separate shared project and repository-reference IDs. Mapping a local checkout to a shared reference requires explicit selection; matching remote URLs alone must not merge identities.
- Store bindings separately from local workspace records. Binding records include organization/team scope, shared-project ID, local-workspace ID, and schema version.
- Support several teams through separate bindings, not one global `teamId`. Sharing the same local workspace with another team requires a separate preview and consent.
- Device-local paths, credentials, Git configuration, source contents, diffs, untracked files, and agent instruction files remain local by default.
- Future status summaries carry device identity, observation time, revision, and stale state. Two developers' checkout states must not overwrite each other as a single repository truth.

The current implementation has stable workspace IDs. Stable repository IDs, binding records, and the collaboration adapter remain implementation work; this document is not evidence that they exist.

## Synchronization Contract

V2 should introduce versioned, allowlisted shared-data DTOs rather than upload local scan results. Repository names, branches, paths, and commit metadata can also be sensitive; metadata-only does not mean risk-free.

When synchronization is enabled, use an outbox with idempotency keys, bounded retries, schema versions, and per-binding cursors. Keep local scans and edits usable offline. Surface conflicts on shared edits using revision checks; do not silently overwrite concurrent changes. Represent deletions explicitly and define retention before enabling synchronization.

Local notifications are not automatically durable sync events. The v2 adapter must perform authorization, consent, and serialization checks before enqueueing data. An unavailable server must never block local scanning.

## Security Requirements

Authorize every server request against its organization, team, and resource. A client-provided team ID is routing information, not proof of access. Test cross-team reads, writes, search, exports, notifications, and attachment access.

Keep Git credentials in device credential storage; do not reuse them as RepoDeck collaboration credentials. Do not execute shared agent instructions or downloaded policies automatically. Remote execution is outside the initial collaboration scope.

Revocation stops future access and queued uploads. It cannot guarantee erasure of information already viewed or exported by a former member. Specify offline cache handling and deletion behavior before launch.

## Open Decisions

| ID | Decision | Proposed starting point | Required before |
| --- | --- | --- | --- |
| V2-01 | Managed cloud, self-hosting, or both? | Preserve a provider interface; choose one first deployment | Backend design approval |
| V2-02 | Membership and roles? | Organization/team/project scope; define owner, maintainer, member, viewer capabilities | Authorization implementation |
| V2-03 | Which information may be shared? | Opt-in status summaries and comments; no source uploads | Sync schema approval |
| V2-04 | Collaboration depth? | Asynchronous visibility and comments before presence or live editing | V2 scope approval |
| V2-05 | Shared agent settings and policies? | Proposed templates with explicit local application and review | Agent sharing implementation |
| V2-06 | Hosting cost and sustainability? | Keep local desktop free and open source; decide funding separately | Hosted-service commitment |
| V2-07 | Retention, encryption, residency, and cache policy? | Minimize shared data; make deletion behavior explicit | Security release review |

These are product decisions, not promises of a free hosted service or universal compatibility.

## Acceptance Gates

- V1 launches and core local features work with networking disabled and no account.
- Adding a collaboration adapter does not replace Git scanning or local file access.
- Local schema migrations preserve workspace IDs and settings; cloud binding can be removed without deleting local files.
- A member of two teams cannot accidentally publish one team's data into the other team's workspace.
- Server authorization rejects cross-tenant access even when IDs are manipulated directly.
- Offline changes, repeated delivery, concurrent shared edits, revocation, and reconnect have explicit integration tests.
- Sharing previews enumerate the actual fields transmitted, including potentially sensitive metadata.
- Shared agent configuration remains inert until a user explicitly reviews and applies it.

V2 implementation begins only after these open decisions are reviewed. V1 remains independently releasable.
