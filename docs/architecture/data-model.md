# Data Model

## Workspace

```ts
type Workspace = {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
  scanSettings: WorkspaceScanSettings;
  cloudSync?: CloudSyncState;
};
```

## WorkspaceScanSettings

```ts
type WorkspaceScanSettings = {
  maxDepth: number;
  excludedGlobs: string[];
  includeIgnoredFiles: boolean;
  includeHiddenFolders: boolean;
};
```

## Repository

```ts
type Repository = {
  id: string;
  workspaceId: string;
  name: string;
  path: string;
  relativePath: string;
  branch?: string;
  headSha?: string;
  remoteUrls: string[];
  upstream?: string;
  ahead: number;
  behind: number;
  status: RepositoryStatus;
  lastScannedAt: string;
};
```

## RepositoryStatus

```ts
type RepositoryStatus = {
  state: "clean" | "dirty" | "conflicted" | "detached" | "unknown";
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  ignoredCount: number;
  conflictedCount: number;
};
```

## FileEntry

```ts
type FileEntry = {
  id: string;
  workspaceId: string;
  repositoryId?: string;
  path: string;
  relativePath: string;
  kind: "file" | "folder" | "symlink" | "unknown";
  gitStatus?: GitFileStatus;
  sizeBytes?: number;
  modifiedAt?: string;
  isIgnored?: boolean;
  ignoreSource?: "gitignore" | "info_exclude" | "global_gitignore" | "unknown";
};
```

## AgentConfig

```ts
type AgentConfig = {
  id: string;
  workspaceId: string;
  repositoryId?: string;
  path: string;
  provider: "codex" | "claude" | "gemini" | "generic" | "unknown";
  kind: "file" | "folder";
  detectedAt: string;
  validationStatus: "not_checked" | "valid" | "warning" | "error";
};
```

## Future Cloud Types

The shape below is illustrative, not the final multi-team schema. V2 should use separate binding records to support multiple teams without embedding one global team identity in local workspace data. See [V2 Cloud and Team Collaboration](v2-team-collaboration.md).

```ts
type CloudSyncState = {
  provider: "repodeck_cloud" | "self_hosted";
  teamId: string;
  remoteWorkspaceId: string;
  enabled: boolean;
  lastSyncedAt?: string;
};
```

V1 does not need to persist unused cloud fields. Preserve stable local IDs and versioned migrations; add independently scoped binding records when v2 is implemented.
