export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
}
export interface Settings {
  schemaVersion: number;
  workspaces: Workspace[];
  theme: string;
  maxDepth: number;
  maxEntries: number;
  excluded: string[];
  showHidden: boolean;
  editor: string;
  terminal?: string;
  autoRefresh?: boolean;
  onboardingCompleted?: boolean;
  repositoryAliases?: Record<string, string>;
}
export interface Change {
  path: string;
  originalPath: string | null;
  index: string;
  worktree: string;
}
export interface Repository {
  path: string;
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  remotes: string[];
  originUrl?: string | null;
  comparisonNotice?: string;
  changes: Change[];
}
export interface Entry {
  path: string;
  directory: boolean;
  repository: boolean;
  agentConfig: boolean;
  size: number;
  modifiedMs: number;
}
export interface Snapshot {
  entries: Entry[];
  warnings: string[];
  repositories: {
    relativePath: string;
    status: Repository | null;
    error: string | null;
  }[];
}
export type Preview =
  | { kind: "text"; content: string }
  | { kind: "binary"; size: number }
  | { kind: "tooLarge"; size: number; limit: number };
export interface ScanProgress {
  phase: "discovery" | "repositories";
  entries: Entry[];
  repository: Snapshot["repositories"][number] | null;
  entryCount: number;
  repositoryCount: number;
  inspectedCount: number;
}
export interface Backend {
  openTerminal(id: string, path: string): Promise<void>;
  openEditor(id: string, path: string): Promise<void>;
  remoteTarget(remote: string): Promise<string>;
  openRemote(url: string): Promise<void>;
  watch(id: string, onChange: (notice: { error: string | null }) => void, signal?: AbortSignal): Promise<() => void>;
  recoverSettings(): Promise<{ settings: Settings; backupPath: string }>;
  cancelScan(id: string): Promise<void>;
  gitFeatures(id: string, repository: string): Promise<{ hooks: string[]; lfsConfigured: boolean; lfsAttributes: string[]; warnings: string[] }>;
  gitConfig(id: string, repository: string): Promise<{ key: string; value: string; hidden: boolean }[]>;
  ignoreRule(id: string, repository: string, path: string): Promise<{ source: string; line: number; pattern: string; path: string } | null>;
  settings(): Promise<Settings>;
  addWorkspace(): Promise<Settings | null>;
  removeWorkspace(id: string): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;
  scan(id: string, onProgress?: (progress: ScanProgress) => void): Promise<Snapshot>;
  preview(id: string, path: string): Promise<Preview>;
  diff(
    id: string,
    repository: string,
    path: string,
    staged: boolean,
  ): Promise<string>;
  exportReport(id: string, format: "json" | "markdown"): Promise<boolean>;
}
