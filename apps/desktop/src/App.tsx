import { useEffect, useMemo, useRef, useState } from "react";
import {
  FolderGit2,
  FolderPlus,
  Settings as SettingsIcon,
  RefreshCw,
  GitBranch,
  FileText,
  Folder,
  Bot,
  Download,
  X,
  Search,
  Circle,
  Check,
  AlertTriangle,
  Pause,
  Play,
  Code2,
  Terminal,
  CircleHelp,
} from "lucide-react";
import type { Backend, Settings, Snapshot, Change, ScanProgress } from "./types";
import FileTree from "./FileTree";
import { repositoryStatus } from "./repositoryStatus";
import RepositoryTools from "./RepositoryTools";
import useWorkspaceWatch from "./useWorkspaceWatch";
import RemoteLink from "./RemoteLink";
import Onboarding from './Onboarding';
import useConfirmation from './useConfirmation';
import RepositoryAlias from './RepositoryAlias';
import { aliasKey, repositoryName, projectTypes, fileStatuses, changeStyle } from './repositoryPresentation';
import ContentPreview from './ContentPreview';

const empty: Snapshot = { entries: [], repositories: [], warnings: [] };
const views = ["Repositories", "Files", "Agents"];
type PreviewTarget = { id: string; path: string; kind: "file" } | { id: string; path: string; kind: "diff"; repository: string; staged: boolean };
export default function App({ backend }: { backend: Backend }) {
  const { confirm, confirmation } = useConfirmation();
  const removalPending = useRef(false);
  const closeDraft = useRef<() => void>(() => {});
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [active, setActive] = useState("");
  const [snapshot, setSnapshot] = useState(empty);
  const committedSnapshot = useRef<Snapshot>(empty);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [tab, setTab] = useState("Repositories");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const [workspaceQuery, setWorkspaceQuery] = useState('');
  const workspaceSearch = useRef<HTMLInputElement>(null);
  const listSearch = useRef<HTMLInputElement>(null);
  const [previewMode, setPreviewMode] = useState<'text' | 'diff' | 'message'>('message');
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState("");
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const autoRefresh = settings?.autoRefresh ?? true;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<Settings | null>(null);
  const [draftError, setDraftError] = useState("");
  const [saving, setSaving] = useState(false);
  // Memory-only drafts survive inspector unmounts, but not application restarts.
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>({});
  const [openingEditor, setOpeningEditor] = useState(false);
  const [openingTerminal, setOpeningTerminal] = useState(false);
  const [startupBusy, setStartupBusy] = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const dialogOpen = draft !== null;
  useEffect(() => {
    const element = dialog.current;
    if (!dialogOpen || !element) return;
    const previous = document.activeElement as HTMLElement | null;
    const background = [...element.closest('.app')!.children].filter(child => !child.contains(element));
    background.forEach(child => child.setAttribute('inert', ''));
    const controls = () => [...element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')];
    controls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (element.getAttribute('aria-busy') !== 'true') closeDraft.current();
      }
      if (event.key !== 'Tab') return;
      const items = controls();
      if (!items.length) { event.preventDefault(); element.focus(); return; }
      const target = event.shiftKey ? items.at(-1) : items[0];
      if (document.activeElement === element || document.activeElement === (event.shiftKey ? items[0] : items.at(-1))) {
        event.preventDefault(); target?.focus();
      }
    };
    element.addEventListener('keydown', keydown);
    return () => {
      element.removeEventListener('keydown', keydown);
      background.forEach(child => child.removeAttribute('inert'));
      previous?.focus();
    };
  }, [dialogOpen]);
  useEffect(() => {
    if (dialogOpen && saving) dialog.current?.focus();
  }, [dialogOpen, saving]);
  const generation = useRef(0);
  const pendingScan = useRef<{ id: string; token: number } | null>(null);
  const previewGeneration = useRef(0);
  const previewTarget = useRef<PreviewTarget | null>(null);
  const workspace = settings?.workspaces.find((w) => w.id === active);
  const repo = snapshot.repositories.find((r) => r.relativePath === selected);
  const checkoutKey = workspace && repo ? aliasKey(workspace.rootPath, repo.relativePath) : '';
  const languages = useMemo(() => projectTypes(snapshot.entries), [snapshot.entries]);
  const statuses = useMemo(() => fileStatuses(snapshot.repositories), [snapshot.repositories]);
  function nameFor(value: Snapshot['repositories'][number]) {
    const original = repositoryName(value, workspace?.name ?? '.');
    const alias = settings?.repositoryAliases?.[aliasKey(workspace?.rootPath ?? '', value.relativePath)];
    return alias && alias !== original ? `${alias} · ${original}` : original;
  }
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  const watchRevision = JSON.stringify([settings?.excluded, settings?.maxDepth, settings?.maxEntries, settings?.showHidden,
    committedSnapshot.current.repositories.map(repo => repo.relativePath).sort()]);
  const watchStatus = useWorkspaceWatch(backend, active, busy || dialogOpen, autoRefresh, watchRevision, () => { void scan(active, true); });

  useEffect(() => {
    void loadSettings();
  }, [backend]);
  useEffect(() => {
    document.documentElement.dataset.theme = settings?.theme ?? "system";
  }, [settings?.theme]);
  useEffect(() => {
    setSnapshot(empty);
    committedSnapshot.current = empty;
    setSelected("");
    setFilename("");
    setContent("");
    setQuery("");
    previewGeneration.current++;
    previewTarget.current = null;
    if (active) void scan(active);
    else {
      generation.current++;
      setBusy(false);
    }
    return () => {
      generation.current++;
      previewGeneration.current++;
      const pending = pendingScan.current;
      if (pending?.id === active) {
        pendingScan.current = null;
        void backend.cancelScan(pending.id).catch(() => {});
      }
    };
  }, [active]);

  async function scan(id = active, background = false) {
    const token = ++generation.current;
    pendingScan.current = { id, token };
    const previous = committedSnapshot.current;
    let receiving = true;
    let partial: Snapshot = { entries: [], repositories: [], warnings: [] };
    setBusy(true);
    setProgress(null);
    if (!background) {
      setNotice('');
      setError("");
    }
    try {
      const value = await backend.scan(id, (update) => {
        if (!receiving || token !== generation.current) return;
        partial = {
          entries: [...partial.entries, ...update.entries],
          repositories: update.repository ? [...partial.repositories, update.repository] : partial.repositories,
          warnings: [],
        };
        setProgress(update);
        if (!background) setSnapshot(partial);
      });
      if (token === generation.current) {
        committedSnapshot.current = value;
        setSnapshot(value);
        const target = previewTarget.current;
        if (target?.id === id) void loadPreview(target, false);
      }
    } catch (e) {
      if (token === generation.current) {
        setSnapshot(previous);
        if ((e instanceof Error ? e.message : String(e)).includes('Scan cancelled')) setNotice('Scan cancelled');
        else fail(e);
      }
    } finally {
      receiving = false;
      if (pendingScan.current?.token === token) pendingScan.current = null;
      if (token === generation.current) setBusy(false);
    }
  }
  async function loadSettings() {
    setStartupBusy(true);
    setError("");
    setConfirmReset(false);
    try {
      const value = await backend.settings();
      setSettings(value);
      setActive(value.workspaces[0]?.id ?? "");
    } catch (e) {
      fail(e);
    } finally {
      setStartupBusy(false);
    }
  }
  async function recoverSettings() {
    setStartupBusy(true);
    setError("");
    try {
      const result = await backend.recoverSettings();
      setSettings(result.settings);
      setActive(result.settings.workspaces[0]?.id ?? "");
      setNotice(`Preferences reset. Backup: ${result.backupPath}`);
      setConfirmReset(false);
    } catch (e) {
      fail(e);
    } finally {
      setStartupBusy(false);
    }
  }
  async function add() {
    if (saving) return;
    setSaving(true);
    try {
      const s = await backend.addWorkspace();
      if (s) {
        setSettings(s);
        setActive(s.workspaces.at(-1)?.id ?? "");
      }
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  }
  async function loadPreview(target: PreviewTarget, showLoading = true) {
    const token = ++previewGeneration.current;
    previewTarget.current = target;
    setFilename(target.kind === "file" ? target.path : `${target.path} / ${target.staged ? "Staged" : "Unstaged"}`);
    if (showLoading) { setContent("Loading..."); setPreviewMode('message'); }
    try {
      let text: string;
      let mode: 'text' | 'diff' | 'message' = 'message';
      if (target.kind === "file") {
        const result = await backend.preview(target.id, target.path);
        mode = result.kind === 'text' ? 'text' : 'message';
        text = result.kind === "text"
            ? result.content
            : result.kind === "binary"
              ? `Binary file (${result.size.toLocaleString()} bytes)`
              : `File exceeds preview limit (${result.size.toLocaleString()} bytes)`;
      } else {
        text = await backend.diff(target.id, target.repository, target.path, target.staged) || "No text differences.";
        mode = text === 'No text differences.' ? 'message' : 'diff';
      }
      if (token === previewGeneration.current) { setContent(text); setPreviewMode(mode); }
    } catch (e) {
      if (token === previewGeneration.current) {
        setContent("");
        fail(e);
      }
    }
  }
  async function openFile(path: string) {
    await loadPreview({ id: active, path, kind: "file" });
  }
  async function openEditor(path: string) {
    if (openingEditor) return;
    setOpeningEditor(true);
    setError('');
    try { await backend.openEditor(active, path); }
    catch (e) { fail(e); }
    finally { setOpeningEditor(false); }
  }
  async function openTerminal(path: string) {
    if (openingTerminal) return;
    setOpeningTerminal(true);
    setError('');
    try { await backend.openTerminal(active, path); }
    catch (e) { fail(e); }
    finally { setOpeningTerminal(false); }
  }
  function editPreview() {
    const target = previewTarget.current;
    if (!target || target.id !== active) return;
    void openEditor(target.kind === 'diff' && target.repository !== '.' ? `${target.repository}/${target.path}` : target.path);
  }
  async function openDiff(change: Change, staged: boolean) {
    if (change.index === "?" || change.index === "!" || changeStyle(change).label === 'Conflict')
      return openFile(
        selected === "." ? change.path : `${selected}/${change.path}`,
      );
    await loadPreview({ id: active, path: change.path, kind: "diff", repository: selected, staged });
  }
  async function save() {
    if (!draft || saving) return;
    const changes = [];
    if (draft.editor !== settings?.editor) changes.push(`Editor application: ${draft.editor}. This application will be launched when you open files in an editor.`);
    if (draft.maxDepth !== settings?.maxDepth || draft.maxEntries !== settings?.maxEntries || draft.showHidden !== settings?.showHidden || JSON.stringify(draft.excluded) !== JSON.stringify(settings?.excluded))
      changes.push(`Scan depth: ${draft.maxDepth}; entry limit: ${draft.maxEntries}; hidden folders: ${draft.showHidden ? 'shown' : 'hidden'}; excluded folders: ${draft.excluded.join(', ') || 'none'}. These settings can hide repositories or increase scan work. Project files stay unchanged.`);
    if (changes.length && !await confirm({ title: 'Review settings changes', description: changes.join('\n\n'), action: 'Apply settings' })) return;
    setSaving(true);
    setDraftError("");
    try {
      setSettings(await backend.saveSettings(draft));
      setDraft(null);
      if (active) void scan();
      setNotice("Settings saved");
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  async function toggleAutoRefresh() {
    if (!settings || saving) return;
    setSaving(true);
    try {
      setSettings(await backend.saveSettings({ ...settings, autoRefresh: !autoRefresh }));
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  }
  async function exportReport(format: "json" | "markdown") {
    try {
      if (await backend.exportReport(active, format)) setNotice("Report saved");
    } catch (e) {
      fail(e);
    }
  }
  closeDraft.current = () => {
    if (saving) return;
    if (JSON.stringify(draft) === JSON.stringify(settings)) { setDraft(null); return; }
    void confirm({ title: 'Discard unsaved settings?', description: 'Your edited settings have not been saved. Discarding restores the saved preferences.', action: 'Discard changes' }).then(accepted => { if (accepted) setDraft(null); });
  };
  if (!settings) return (
    <main className="startup">
      <div className="brand"><FolderGit2 size={26} /><strong>RepoDeck</strong></div>
      <section aria-labelledby="startup-title">
        <h1 id="startup-title">{startupBusy ? "Opening workspace settings" : "Settings unavailable"}</h1>
        {error && <p role="alert" className="danger">{error}</p>}
        {confirmReset && <p>Reset the workspace list and preferences? Project files stay unchanged. The original settings will be backed up in the same folder.</p>}
        <div className="startup-actions">
          {confirmReset ? <>
            <button autoFocus disabled={startupBusy} onClick={() => setConfirmReset(false)}>Cancel reset</button>
            <button disabled={startupBusy} onClick={recoverSettings}>Back up and reset preferences</button>
          </> : <>
            <button disabled={startupBusy} onClick={loadSettings}><RefreshCw size={16} />Retry loading settings</button>
            <button disabled={startupBusy} onClick={() => setConfirmReset(true)}>Reset preferences</button>
          </>}
        </div>
      </section>
    </main>
  );
  const dirty = snapshot.repositories.filter((r) =>
    !r.error && r.status?.changes.some((c) => c.index !== "!"),
  ).length;
  const unavailable = snapshot.repositories.filter(r => r.error || !r.status).length;
  const repositories = snapshot.repositories.filter(r =>
    `${nameFor(r)} ${r.relativePath} ${workspace?.rootPath ?? ''}`
      .toLowerCase().includes(normalizedQuery),
  );
  const entries = snapshot.entries.filter(
    (e) =>
      (tab !== "Agents" || e.agentConfig) &&
      e.path.toLowerCase().includes(normalizedQuery),
  );
  const scanLabel = progress
    ? progress.phase === "discovery"
      ? `${progress.entryCount.toLocaleString()} entries discovered`
      : `${progress.inspectedCount.toLocaleString()} / ${progress.repositoryCount.toLocaleString()} repositories inspected`
    : "Scanning workspace...";
  if (!settings.onboardingCompleted || tourOpen) return <Onboarding firstRun={!settings.onboardingCompleted} onFinish={async openFolder => {
    if (!settings.onboardingCompleted) setSettings(await backend.saveSettings({ ...settings, onboardingCompleted: true }));
    setTourOpen(false);
    if (openFolder) await add();
  }} />;
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <FolderGit2 size={26} />
          <strong>RepoDeck</strong>
          <span>LOCAL</span>
        </div>
        <div className="section-label">
          WORKSPACES
          <button
            aria-label="Add workspace"
            title="Add workspace"
            disabled={saving}
            onClick={add}
          >
            <FolderPlus size={18} />
          </button>
        </div>
        <label className="search workspace-search">
          <Search size={14} aria-hidden="true" />
          <input ref={workspaceSearch} aria-label="Search workspaces" placeholder="Search" value={workspaceQuery} onChange={event => setWorkspaceQuery(event.target.value)} />
          {workspaceQuery && <button aria-label="Clear workspace search" title="Clear workspace search" onClick={() => { setWorkspaceQuery(''); workspaceSearch.current?.focus(); }}><X size={14} /></button>}
        </label>
        <nav aria-label="Workspaces">
          {settings?.workspaces.filter(w => `${w.name} ${w.rootPath}`.toLowerCase().includes(workspaceQuery.trim().toLowerCase())).map((w) => (
            <div className="workspace-row" key={w.id}>
              <button
                className={w.id === active ? "active" : ""}
                onClick={() => setActive(w.id)}
              >
                <Folder size={16} />
                <span>{w.name}</span>
              </button>
              <button
                aria-label={`Remove ${w.name} from list`}
                title="Remove from list"
                disabled={saving}
                onClick={async () => {
                  if (saving || removalPending.current) return;
                  removalPending.current = true;
                  try {
                    if (!await confirm({ title: `Remove ${w.name}?`, description: `${w.rootPath}\n\nRemove this workspace from RepoDeck's list? Files and Git repositories on disk will not be deleted. You can add this folder again.`, action: 'Remove from list' })) return;
                    setSaving(true);
                    const s = await backend.removeWorkspace(w.id);
                    setSettings(s);
                    setActive(current => s.workspaces.some(workspace => workspace.id === current) ? current : s.workspaces[0]?.id ?? "");
                  } catch (e) {
                    fail(e);
                  } finally {
                    removalPending.current = false;
                    setSaving(false);
                  }
                }}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          {!!workspaceQuery && !settings.workspaces.some(w => `${w.name} ${w.rootPath}`.toLowerCase().includes(workspaceQuery.trim().toLowerCase())) && <p className="empty-list">No workspaces match.</p>}
        </nav>
        <div className="sidebar-bottom">
          <span>
            <Circle size={8} fill="currentColor" /> On this device
          </span>
          <button
            aria-label="Settings"
            title="Settings"
            disabled={saving}
            onClick={() => { setDraftError(""); settings && setDraft(structuredClone(settings)); }}
          >
            <SettingsIcon size={18} />
          </button>
          <button aria-label="Show tour" title="Show tour" onClick={() => setTourOpen(true)}><CircleHelp size={18} /></button>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <div className="eyebrow">WORKSPACE</div>
            <h1>{workspace?.name ?? "RepoDeck"}</h1>
            <div className="root-path" title={workspace?.rootPath}>
              {workspace?.rootPath ?? "No workspace selected"}
            </div>
          </div>
          <div className="header-actions">
            {workspace && (
              <>
                <button aria-label={autoRefresh ? "Pause automatic refresh" : "Resume automatic refresh"} title={watchStatus} aria-pressed={autoRefresh} disabled={saving} onClick={toggleAutoRefresh}>
                  {autoRefresh ? <Pause size={17} /> : <Play size={17} />}
                </button>
                <button
                  aria-label="Refresh workspace"
                  title="Refresh workspace"
                  disabled={busy}
                  onClick={() => scan()}
                >
                  <RefreshCw className={busy ? "spin" : ""} size={17} />
                </button>
                {busy && <button aria-label="Stop scan" title="Stop scan" onClick={() => { setNotice('Stopping scan...'); backend.cancelScan(active).catch(fail); }}><X size={17} /></button>}
                <button
                  aria-label="Export JSON report"
                  title="Export JSON report"
                  onClick={() => exportReport("json")}
                >
                  <Download size={17} />
                  JSON
                </button>
                <button
                  aria-label="Export Markdown report"
                  title="Export Markdown report"
                  onClick={() => exportReport("markdown")}
                >
                  <Download size={17} />
                  MD
                </button>
              </>
            )}
          </div>
        </header>
        {error && (
          <div role="alert" className="error">
            <AlertTriangle size={16} />
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {workspace ? (
          <>
            <div className="metrics" role="region" aria-label="Workspace summary">
              <span>
                <strong>{snapshot.repositories.length}</strong> repositories
              </span>
              <span>
                <strong className="amber">{dirty}</strong> with changes
              </span>
              {unavailable > 0 && <span><strong className="danger">{unavailable}</strong> unavailable</span>}
              <span>
                <strong>
                  {
                    snapshot.entries.filter(
                      (e) => e.agentConfig && !e.directory,
                    ).length
                  }
                </strong>{" "}
                agent files
              </span>
              <span className="scan-status">
                <Circle size={7} fill="currentColor" />
                {busy ? "Scanning" : watchStatus}
              </span>
            </div>
            <div className="toolbar">
              <div role="tablist" aria-label="Workspace views">
                {views.map((t, index) => (
                  <button
                    role="tab"
                    aria-selected={tab === t}
                    id={`workspace-tab-${t}`}
                    aria-controls="workspace-panel"
                    tabIndex={tab === t ? 0 : -1}
                    key={t}
                    onKeyDown={(event) => {
                      let next: number;
                      if (event.key === "ArrowRight") next = (index + 1) % views.length;
                      else if (event.key === "ArrowLeft") next = (index + views.length - 1) % views.length;
                      else if (event.key === "Home") next = 0;
                      else if (event.key === "End") next = views.length - 1;
                      else return;
                      event.preventDefault();
                      setTab(views[next]);
                      setQuery("");
                      document.getElementById(`workspace-tab-${views[next]}`)?.focus();
                    }}
                    onClick={() => {
                      setTab(t);
                      setQuery("");
                    }}
                  >
                    {t === "Repositories" ? (
                      <GitBranch size={16} />
                    ) : t === "Files" ? (
                      <Folder size={16} />
                    ) : (
                      <Bot size={16} />
                    )}
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="content-grid" role="tabpanel" id="workspace-panel" aria-labelledby={`workspace-tab-${tab}`}>
              <section className="listing" aria-label={tab}>
              <label className="search list-search">
                <Search size={15} />
                <input
                  ref={listSearch}
                  aria-label="Filter workspace"
                  placeholder={tab === 'Repositories' ? 'Search repositories' : `Search ${tab.toLowerCase()}`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && <button aria-label="Clear list search" title="Clear list search" onClick={() => { setQuery(''); listSearch.current?.focus(); }}><X size={14} /></button>}
              </label>
                {tab === "Repositories" ? (
                  <>
                    <div className="list-heading">
                      REPOSITORY<span>STATUS</span>
                    </div>
                    {repositories.map((r) => (
                        <button
                          className={`repo-row ${selected === r.relativePath ? "selected" : ""}`}
                          key={r.relativePath}
                          onClick={() => {
                            setSelected(r.relativePath);
                            setFilename("");
                            setContent("");
                            previewGeneration.current++;
                            previewTarget.current = null;
                          }}
                        >
                          <FolderGit2 size={21} />
                          <span className="repo-name">
                            <strong>
                              {nameFor(r)}
                            </strong>
                            <small className="repo-path" title={`${workspace.rootPath}${r.relativePath === '.' ? '' : `/${r.relativePath}`}`}>{r.relativePath === '.' ? workspace.rootPath : r.relativePath}</small>
                            <small>
                              <GitBranch size={12} />
                              <span title={r.status?.branch ?? undefined}>
                              {r.status?.branch ??
                                (r.status?.detached
                                  ? "Detached HEAD"
                                  : "Unavailable")}
                              </span>
                            </small>
                          </span>
                          {!!languages.get(r.relativePath)?.length && <span className="project-types">{languages.get(r.relativePath)!.map(type => <span key={type} data-language={type} title={`Detected from scanned build or source files: ${type}`}>{type}</span>)}</span>}
                          <span
                            className={'repo-status ' + (
                              r.error || !r.status
                                ? "danger"
                                : repositoryStatus(r.status).tone
                            )}
                          >
                            {r.error || !r.status
                              ? "Error"
                              : repositoryStatus(r.status).label}
                          </span>
                        </button>
                      ))}
                  </>
                ) : (
                  <>
                    <div className="list-heading">
                      {tab === "Agents" ? "CONFIGURATION" : "PATH"}
                      <span>SIZE</span>
                    </div>
                    <FileTree key={`${active}-${tab}`} entries={snapshot.entries.filter(e => tab !== 'Agents' || e.agentConfig)} statuses={statuses} query={query} onOpen={openFile} />
                  </>
                )}
                {!busy &&
                  (tab === "Repositories"
                    ? repositories.length === 0
                    : entries.length === 0) && (
                    <p className="empty-list">{normalizedQuery ? `No ${tab.toLowerCase()} match your filter.` : `No ${tab.toLowerCase()} found.`}</p>
                  )}
              </section>
              <section className="inspector" aria-label="Inspector">
                {repo && tab === "Repositories" && (
                  <>
                    <div className="inspector-heading">
                      <GitBranch size={17} />
                      <strong>{nameFor(repo)}</strong>
                      <button title="Open repository in editor" aria-label="Open repository in editor" disabled={openingEditor} onClick={() => void openEditor(repo.relativePath)}><Code2 size={16} /></button>
                      <button title="Open repository in terminal" aria-label="Open repository in terminal" disabled={openingTerminal} onClick={() => void openTerminal(repo.relativePath)}><Terminal size={16} /></button>
                    </div>
                    <div className="repository-identity">
                      <small className="repo-path" title={`${workspace.rootPath}/${repo.relativePath}`}>{repo.relativePath === '.' ? workspace.rootPath : repo.relativePath}</small>
                      <RepositoryAlias key={checkoutKey} disabled={saving} alias={settings.repositoryAliases?.[checkoutKey] ?? ''}
                        draft={aliasDrafts[checkoutKey]} onDraftChange={value => setAliasDrafts(current => {
                          const next = { ...current };
                          if (value === undefined) delete next[checkoutKey]; else next[checkoutKey] = value;
                          return next;
                        })} onSave={async value => {
                        if (saving) throw new Error('Wait for the current settings save to finish.');
                        const repositoryAliases = { ...settings.repositoryAliases };
                        const key = checkoutKey;
                        if (value) repositoryAliases[key] = value; else delete repositoryAliases[key];
                        setSaving(true);
                        try { setSettings(await backend.saveSettings({ ...settings, repositoryAliases })); }
                        finally { setSaving(false); }
                      }} />
                    </div>
                    {repo.error || !repo.status ? (
                      <p className="danger">{repo.error || "Repository status unavailable."}</p>
                    ) : (
                      <>
                        <div className="repo-meta">
                          <span>{repo.status.branch ?? (repo.status.detached ? "Detached HEAD" : "Unavailable")}</span>
                          <span>
                            {repo.status?.ahead} ahead / {repo.status?.behind}{" "}
                            behind
                          </span>
                        </div>
                        {repo.status.comparisonNotice && <p className="muted">{repo.status.comparisonNotice}</p>}
                        {repo.status?.remotes.map((r, index) => (
                          <RemoteLink key={`${active}:${selected}:${index}:${r}`} backend={backend} remote={r} />
                        ))}
                        <div className="changes">
                          {repo.status?.changes.map((c) => (
                            <div className={`change-row ${changeStyle(c).tone}`} key={c.path} title={changeStyle(c).label}>
                              <button
                                onClick={() =>
                                  openDiff(
                                    c,
                                    c.worktree === " " && c.index !== " ",
                                  )
                                }
                              >
                                <span className="change-code">
                                  {c.index}
                                  {c.worktree}
                                </span>
                                {c.path}
                                <small className="file-status">{changeStyle(c).label}</small>
                              </button>
                              {c.index !== " " &&
                                changeStyle(c).label !== 'Conflict' &&
                                !["?", "!"].includes(c.index) &&
                                c.worktree !== " " && (
                                  <button onClick={() => openDiff(c, true)}>
                                    Staged
                                  </button>
                                )}
                            </div>
                          ))}
                        </div>
                        <RepositoryTools key={`${active}-${selected}`} backend={backend} id={active} repository={selected} />
                      </>
                    )}
                  </>
                )}
                {filename ? (
                  <>
                    <div className="preview-title">
                      <FileText size={15} />
                      <span>{filename}</span>
                      <button title="Open file in editor" aria-label="Open file in editor" disabled={openingEditor} onClick={editPreview}><Code2 size={16} /></button>
                    </div>
                    <ContentPreview content={content} mode={previewMode} />
                  </>
                ) : (
                  !repo && (
                    <div className="inspector-empty">
                      <FileText size={28} />
                      <p>Select a repository or file</p>
                    </div>
                  )
                )}
              </section>
            </div>
            {snapshot.warnings.length > 0 && (
              <details className="warnings">
                <summary>{snapshot.warnings.length} scan warnings</summary>
                {snapshot.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </details>
            )}
          </>
        ) : (
          <div className="welcome">
            <FolderGit2 size={48} />
            <h2>Your workspaces</h2>
            <button disabled={saving} onClick={add}>
              <FolderPlus size={18} />
              Open folder
            </button>
          </div>
        )}
        <footer>
          <span>
            {snapshot.entries.length.toLocaleString()} {busy ? "discovered entries" : "indexed entries"}
          </span>
          <span role="status">
            {notice || (busy ? scanLabel : "Ready")}
          </span>
        </footer>
      </main>
      {confirmation}
      {draft && (
        <div className="modal-backdrop">
          <section
            ref={dialog}
            role="dialog"
            tabIndex={-1}
            aria-busy={saving}
            aria-modal="true"
            aria-labelledby="settings-title"
            className="settings"
          >
            <div className="dialog-title">
              <h2 id="settings-title">Settings</h2>
              <button
                aria-label="Close settings"
                disabled={saving}
                onClick={() => closeDraft.current()}
              >
                <X size={18} />
              </button>
            </div>
            <label>
              Appearance
              <select
                disabled={saving}
                value={draft.theme}
                onChange={(e) => setDraft({ ...draft, theme: e.target.value })}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label>
              Editor application
              <input disabled={saving} value={draft.editor} onChange={e => setDraft({ ...draft, editor: e.target.value })} />
            </label>
            <label>
              Terminal
              <select disabled={saving} value={draft.terminal ?? 'system'} onChange={e => setDraft({ ...draft, terminal: e.target.value })}>
                <option value="system">System terminal</option>
                {!/Mac/.test(navigator.platform) && <><option value="powershell">Windows PowerShell</option><option value="cmd">Command Prompt</option></>}
              </select>
            </label>
            <label>
              Scan depth
              <input
                type="number"
                min={1}
                max={128}
                value={draft.maxDepth}
                disabled={saving}
                onChange={(e) =>
                  setDraft({ ...draft, maxDepth: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Entry limit
              <input
                type="number"
                min={1}
                max={1000000}
                value={draft.maxEntries}
                disabled={saving}
                onChange={(e) =>
                  setDraft({ ...draft, maxEntries: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Excluded folder names
              <textarea
                value={draft.excluded.join("\n")}
                disabled={saving}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    excluded: e.target.value.split("\n").filter(Boolean),
                  })
                }
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={draft.showHidden}
                disabled={saving}
                onChange={(e) =>
                  setDraft({ ...draft, showHidden: e.target.checked })
                }
              />
              Show hidden folders
            </label>
            {draftError && <p role="alert" className="danger">{draftError}</p>}
            <button className="primary" aria-label="Save settings" disabled={saving} aria-busy={saving} onClick={save}>
              {saving ? "Saving settings..." : "Save settings"}
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
