import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import type { Backend, ScanProgress, Settings, Snapshot } from "./types";

afterEach(cleanup);
const settings: Settings = {
  schemaVersion: 1,
  onboardingCompleted: true,
  workspaces: [],
  theme: "system",
  maxDepth: 12,
  maxEntries: 50000,
  excluded: [".git"],
  showHidden: false,
  editor: "code",
};
const snapshot: Snapshot = {
  entries: [
    {
      path: "AGENTS.md",
      directory: false,
      repository: false,
      agentConfig: true,
      size: 5,
      modifiedMs: 0,
    },
  ],
  warnings: [],
  repositories: [
    {
      relativePath: "api",
      error: null,
      status: {
        path: "/project/api",
        branch: "main",
        detached: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        remotes: [],
        comparisonNotice: "Submodule working-file changes are shown separately.",
        changes: [
          { path: "index.ts", originalPath: null, index: " ", worktree: "M" },
        ],
      },
    },
  ],
};
function backend(): Backend {
  let saved = structuredClone(settings);
  return {
    openTerminal: async () => {},
    openEditor: async () => {},
    remoteTarget: async remote => remote,
    openRemote: async () => {},
    watch: async () => () => {},
    recoverSettings: async () => ({ settings: saved, backupPath: '/profile/settings.backup.json' }),
    cancelScan: async () => {},
    gitFeatures: async () => ({ hooks: [], lfsConfigured: false, lfsAttributes: [], warnings: [] }),
    gitConfig: async () => [],
    ignoreRule: async () => null,
    settings: async () => saved,
    addWorkspace: async () =>
      (saved = {
        ...saved,
        workspaces: [{ id: "one", name: "Project", rootPath: "/project" }],
      }),
    removeWorkspace: async () => (saved = { ...saved, workspaces: [] }),
    saveSettings: async (s) => (saved = s),
    scan: async () => snapshot,
    preview: async () => ({ kind: "text", content: "Project instructions" }),
    diff: async () => "+new line",
    exportReport: async () => true,
  };
}
describe("Workspace experience", () => {
  async function renderScannedWorkspace(result: Snapshot = snapshot) {
    const api = backend();
    api.settings = async () => ({ ...settings, autoRefresh: false, workspaces: [{ id: 'one', name: 'Project', rootPath: '/project' }] });
    let finishScan!: (value: Snapshot) => void;
    api.scan = () => new Promise(resolve => { finishScan = resolve; });
    await act(async () => { render(<App backend={api} />); });
    expect(screen.getByRole('button', { name: 'Stop scan' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^api/ })).toBeNull();
    expect(screen.queryByText('No repositories found.')).toBeNull();
    await act(async () => { finishScan(result); });
    expect(screen.queryByRole('button', { name: 'Stop scan' })).toBeNull();
  }
  it.each(['Repositories', 'Files', 'Agents'])('normalizes %s searches without contradictory empty results', async tab => {
    await renderScannedWorkspace();
    await userEvent.click(screen.getByRole('tab', { name: tab }));
    const input = screen.getByRole('textbox', { name: 'Filter workspace' });
    const listing = within(screen.getByRole('region', { name: tab }));
    const name = tab === 'Repositories' ? /^api/ : /^AGENTS.md,/;
    const term = tab === 'Repositories' ? 'ApI' : 'aGeNtS.Md';
    for (const query of ['', '   ', term, `  ${term}  `]) {
      await userEvent.clear(input);
      if (query) await userEvent.type(input, query);
      expect(listing.getByRole('button', { name })).toBeTruthy();
      expect(listing.queryByText(/^No .* (found|match your filter)\.$/)).toBeNull();
      expect((input as HTMLInputElement).value).toBe(query);
    }
    await userEvent.clear(input);
    await userEvent.type(input, ' missing ');
    expect(listing.queryByRole('button', { name })).toBeNull();
    expect(listing.getByText(`No ${tab.toLowerCase()} match your filter.`)).toBeTruthy();
  });
  it.each(['Repositories', 'Files', 'Agents'])('treats whitespace as no filter in an empty %s view', async tab => {
    await renderScannedWorkspace({ entries: [], repositories: [], warnings: [] });
    expect(screen.getByText('No repositories found.')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: tab }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter workspace' }), '   ');
    expect(screen.getByText(`No ${tab.toLowerCase()} found.`)).toBeTruthy();
    expect(screen.queryByText(`No ${tab.toLowerCase()} match your filter.`)).toBeNull();
  });
  it('shows the backend comparison limitation for the selected repository', async () => {
    await renderScannedWorkspace();
    await userEvent.click(screen.getByRole('button', { name: /^api/ }));
    expect(screen.getByText('Submodule working-file changes are shown separately.')).toBeTruthy();
  });
  async function openAliasDraft() {
    const api = backend();
    api.settings = async () => ({ ...settings, autoRefresh: false, workspaces: [
      { id: 'parent', name: 'Parent', rootPath: 'C:\\Projects' },
      { id: 'checkout', name: 'Checkout', rootPath: 'c:/projects/API' },
      { id: 'other', name: 'Other', rootPath: 'C:/Other' },
    ] });
    api.scan = async id => id === 'checkout'
      ? { ...snapshot, repositories: [{ ...snapshot.repositories[0], relativePath: '.' }] } : snapshot;
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: /^api/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit custom name' }));
    await userEvent.type(screen.getByLabelText('Custom name'), 'Payments');
  }

  it('retains alias drafts across tabs', async () => {
    await openAliasDraft();
    await userEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Repositories' }));
    expect((screen.getByLabelText('Custom name') as HTMLInputElement).value).toBe('Payments');
  });

  it('keeps drafts for unrelated checkouts independent', async () => {
    await openAliasDraft();
    await userEvent.click(screen.getByRole('button', { name: 'Other' }));
    await userEvent.click(await screen.findByRole('button', { name: /^api/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit custom name' }));
    expect((screen.getByLabelText('Custom name') as HTMLInputElement).value).toBe('');
    await userEvent.type(screen.getByLabelText('Custom name'), 'Other draft');
    await userEvent.click(screen.getByRole('button', { name: 'Parent' }));
    await userEvent.click(await screen.findByRole('button', { name: /^api/ }));
    expect((screen.getByLabelText('Custom name') as HTMLInputElement).value).toBe('Payments');
    await userEvent.click(screen.getByRole('button', { name: 'Other' }));
    await userEvent.click(await screen.findByRole('button', { name: /^api/ }));
    expect((screen.getByLabelText('Custom name') as HTMLInputElement).value).toBe('Other draft');
  });

  it('shares alias drafts and saves across canonical checkout workspace identities', async () => {
    await openAliasDraft();
    await userEvent.click(screen.getByRole('button', { name: 'Checkout' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Checkout.*main/ }));
    expect((screen.getByLabelText('Custom name') as HTMLInputElement).value).toBe('Payments');
    await userEvent.click(screen.getByRole('button', { name: 'Save custom name' }));
    await userEvent.click(screen.getByRole('button', { name: 'Parent' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Payments/ }));
    expect(screen.queryByLabelText('Custom name')).toBeNull();
  });

  it('retains alias drafts while manual scan progress unmounts the inspector', async () => {
    const api = backend();
    api.settings = async () => ({ ...settings, autoRefresh: false, workspaces: [{ id: 'one', name: 'Project', rootPath: '/project' }] });
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: /^api/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit custom name' }));
    await userEvent.type(screen.getByLabelText('Custom name'), 'Payments');
    let progress!: (value: ScanProgress) => void;
    let finish!: (value: Snapshot) => void;
    api.scan = (_id, update) => { progress = update!; return new Promise(resolve => { finish = resolve; }); };
    await userEvent.click(screen.getByRole('button', { name: 'Refresh workspace' }));
    await act(async () => progress({ phase: 'discovery', entries: [], repository: null, entryCount: 0, repositoryCount: 0, inspectedCount: 0 }));
    expect(screen.queryByLabelText('Custom name')).toBeNull();
    await act(async () => finish(snapshot));
    expect((screen.getByLabelText('Custom name') as HTMLInputElement).value).toBe('Payments');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel custom name' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Repositories' }));
    expect(screen.queryByLabelText('Custom name')).toBeNull();
  });

  it('blocks workspace mutations while an alias save is pending', async () => {
    const api = backend();
    let finish!: () => void;
    api.saveSettings = value => new Promise(resolve => { finish = () => resolve(value); });
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(await screen.findByRole('button', { name: /^api/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit custom name' }));
    await userEvent.type(screen.getByLabelText('Custom name'), 'Payments');
    await userEvent.click(screen.getByRole('button', { name: 'Save custom name' }));
    expect((screen.getByRole('button', { name: 'Add workspace' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Remove Project from list' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish());
    expect((screen.getByRole('button', { name: 'Add workspace' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(['success', 'failure'])('settles an alias save after its inspector unmounts: %s', async outcome => {
    const api = backend();
    api.settings = async () => ({ ...settings, autoRefresh: false, workspaces: [{ id: 'one', name: 'Project', rootPath: '/project' }] });
    api.scan = async () => ({ ...snapshot, repositories: [...snapshot.repositories, { ...snapshot.repositories[0], relativePath: 'web' }] });
    let finish!: () => void;
    let reject!: (reason: Error) => void;
    api.saveSettings = value => new Promise((resolve, failure) => { finish = () => resolve(value); reject = failure; });
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: /^api/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit custom name' }));
    await userEvent.type(screen.getByLabelText('Custom name'), 'Payments');
    await userEvent.click(screen.getByRole('button', { name: /^web/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit custom name' }));
    await userEvent.type(screen.getByLabelText('Custom name'), 'Website');
    await userEvent.click(screen.getByRole('button', { name: /^api/ }));
    expect((screen.getByLabelText('Custom name') as HTMLInputElement).value).toBe('Payments');
    await userEvent.click(screen.getByRole('button', { name: 'Save custom name' }));
    await userEvent.click(screen.getByRole('button', { name: /^web/ }));
    expect((screen.getByLabelText('Custom name') as HTMLInputElement).disabled).toBe(true);
    await act(async () => outcome === 'success' ? finish() : reject(new Error('Disk full')));
    expect((screen.getByLabelText('Custom name') as HTMLInputElement).value).toBe('Website');
    expect((screen.getByLabelText('Custom name') as HTMLInputElement).disabled).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: outcome === 'success' ? /^Payments/ : /^api/ }));
    if (outcome === 'success') expect(screen.queryByLabelText('Custom name')).toBeNull();
    else expect((screen.getByLabelText('Custom name') as HTMLInputElement).value).toBe('Payments');
  });

  it.each(['success', 'cancel', 'failure'])('holds the settings lock throughout adding a workspace: %s', async outcome => {
    const api = backend();
    let finish!: (value: Settings | null) => void;
    let reject!: (reason: Error) => void;
    let calls = 0;
    api.addWorkspace = () => { calls++; return new Promise((resolve, failure) => { finish = resolve; reject = failure; }); };
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    for (const name of ['Add workspace', 'Open folder', 'Settings'])
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    expect(calls).toBe(1);
    await act(async () => {
      if (outcome === 'failure') reject(new Error('Add failed'));
      else finish(outcome === 'cancel' ? null : { ...settings, workspaces: [{ id: 'one', name: 'Project', rootPath: '/project' }] });
    });
    expect((screen.getByRole('button', { name: 'Add workspace' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Settings' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(['removed', 'remaining'])('validates the current selection when removal resolves: %s', async selection => {
    const api = backend();
    const workspaces = [
      { id: 'one', name: 'One', rootPath: '/one' },
      { id: 'two', name: 'Two', rootPath: '/two' },
      { id: 'three', name: 'Three', rootPath: '/three' },
    ];
    api.settings = async () => ({ ...settings, autoRefresh: false, workspaces });
    let finish!: (value: Settings) => void;
    api.removeWorkspace = () => new Promise(resolve => { finish = resolve; });
    render(<App backend={api} />);
    const removed = selection === 'removed' ? 'Two' : 'One';
    await userEvent.click(await screen.findByRole('button', { name: `Remove ${removed} from list` }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove from list' }));
    await userEvent.click(screen.getByRole('button', { name: selection === 'removed' ? 'Two' : 'Three' }));
    for (const name of ['Add workspace', 'Remove Two from list', 'Settings', 'Resume automatic refresh'])
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish({ ...settings, workspaces: workspaces.filter(workspace => workspace.name !== removed) }));
    expect(screen.getByRole('heading', { name: selection === 'removed' ? 'One' : 'Three' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add workspace' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('guards preference actions while a repository alias save is pending', async () => {
    const api = backend();
    let finish: () => void = () => {};
    api.saveSettings = value => new Promise(resolve => { finish = () => resolve(value); });
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(await screen.findByRole('button', { name: /^api/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit custom name' }));
    await userEvent.type(screen.getByLabelText('Custom name'), 'Payments');
    await userEvent.click(screen.getByRole('button', { name: 'Save custom name' }));
    expect((screen.getByRole('button', { name: 'Pause automatic refresh' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Settings' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish());
    await screen.findByRole('button', { name: /^Payments/ });
    expect((screen.getByRole('button', { name: 'Pause automatic refresh' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('keeps an alias draft but blocks its save while automatic-refresh preferences are saving', async () => {
    const api = backend();
    let finish: () => void = () => {};
    let writes = 0;
    api.saveSettings = value => { writes++; return new Promise(resolve => { finish = () => resolve(value); }); };
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(await screen.findByRole('button', { name: /^api/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit custom name' }));
    await userEvent.type(screen.getByLabelText('Custom name'), 'Payments');
    await userEvent.click(screen.getByRole('button', { name: 'Pause automatic refresh' }));
    const saveAlias = screen.getByRole('button', { name: 'Save custom name' });
    expect((saveAlias as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(saveAlias);
    expect(writes).toBe(1);
    await act(async () => finish());
    expect((screen.getByLabelText('Custom name') as HTMLInputElement).value).toBe('Payments');
    expect((saveAlias as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Resume automatic refresh' })).toBeTruthy();
  });
  it('preserves action errors across automatic refresh but clears them on manual refresh', async () => {
    const api = backend();
    let changed: (notice: { error: string | null }) => void = () => {};
    let scans = 0;
    api.watch = async (_id, callback) => { changed = callback; return () => {}; };
    api.scan = async () => { scans++; return snapshot; };
    api.openEditor = async () => { throw new Error('Editor launch rejected'); };
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await waitFor(() => expect(scans).toBeGreaterThan(1));
    await userEvent.click(await screen.findByRole('button', { name: /^api/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Open repository in editor' }));
    await screen.findByText('Editor launch rejected');
    const before = scans;
    act(() => changed({ error: null }));
    await waitFor(() => expect(scans).toBeGreaterThan(before));
    expect(screen.getByText('Editor launch rejected')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh workspace' }));
    await waitFor(() => expect(screen.queryByText('Editor launch rejected')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.selectOptions(screen.getByLabelText('Appearance'), 'dark');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await screen.findByText('Settings saved');
    const afterSave = scans;
    act(() => changed({ error: null }));
    await waitFor(() => expect(scans).toBeGreaterThan(afterSave));
    expect(screen.getByText('Settings saved')).toBeTruthy();
  });
  it('filters workspace names and paths independently without changing the active workspace', async () => {
    const api = backend();
    api.settings = async () => ({ ...settings, workspaces: [{ id: 'one', name: 'Commerce', rootPath: '/projects/shop' }, { id: 'two', name: 'Analytics', rootPath: '/data/reports' }] });
    render(<App backend={api} />);
    await userEvent.type(await screen.findByRole('textbox', { name: 'Search workspaces' }), 'reports');
    const nav = screen.getByRole('navigation', { name: 'Workspaces' });
    expect(within(nav).queryByRole('button', { name: 'Commerce' })).toBeNull();
    expect(within(nav).getByRole('button', { name: 'Analytics' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Commerce' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Clear workspace search' }));
    expect(within(nav).getByRole('button', { name: 'Commerce' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search workspaces' }));
  });
  it.each(['Repositories', 'Files', 'Agents'])('restores search focus after clearing the %s filter', async tab => {
    render(<App backend={backend()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await screen.findByRole('button', { name: /^api/ });
    await userEvent.click(screen.getByRole('tab', { name: tab }));
    const input = screen.getByRole('textbox', { name: 'Filter workspace' });
    await userEvent.type(input, 'not-present');
    await userEvent.click(screen.getByRole('button', { name: 'Clear list search' }));
    expect((input as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(input);
    await userEvent.keyboard('api');
    expect((input as HTMLInputElement).value).toBe('api');
  });
  it('saves local aliases, searches them after restart, and clears back to the original name', async () => {
    const api = backend();
    const view = render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(await screen.findByRole('button', { name: /^api/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit custom name' }));
    await userEvent.type(screen.getByLabelText('Custom name'), 'Payments');
    await userEvent.click(screen.getByRole('button', { name: 'Save custom name' }));
    expect((await api.settings()).repositoryAliases).toEqual({ '/project/api': 'Payments' });
    view.unmount();
    render(<App backend={api} />);
    await userEvent.type(await screen.findByRole('textbox', { name: 'Filter workspace' }), 'Payments');
    await userEvent.click(await screen.findByRole('button', { name: /^Payments · api/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit custom name' }));
    await userEvent.clear(screen.getByLabelText('Custom name'));
    await userEvent.click(screen.getByRole('button', { name: 'Save custom name' }));
    expect((await api.settings()).repositoryAliases).toEqual({});
  });
  it('retains the custom name draft when saving fails', async () => {
    const api = backend();
    api.saveSettings = async () => { throw new Error('Disk full'); };
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(await screen.findByRole('button', { name: /^api/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit custom name' }));
    await userEvent.type(screen.getByLabelText('Custom name'), 'Payments');
    await userEvent.click(screen.getByRole('button', { name: 'Save custom name' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByLabelText('Custom name') as HTMLInputElement).value).toBe('Payments');
    expect((await api.settings()).repositoryAliases).toBeUndefined();
    expect((screen.getByRole('button', { name: 'Settings' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Save custom name' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('focuses Cancel, traps keyboard navigation, and removes only after approval', async () => {
    const api = backend();
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    const remove = await screen.findByRole('button', { name: 'Remove Project from list' });
    await userEvent.click(remove);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove from list' }));
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(remove);
    expect((await api.settings()).workspaces).toHaveLength(1);
    await userEvent.click(remove);
    await userEvent.click(screen.getByRole('button', { name: 'Remove from list' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Project' })).toBeNull());
    expect((await api.settings()).workspaces).toHaveLength(0);
  });
  it('requires confirmation to remove a workspace and preserves it on cancel or failure', async () => {
    const api = backend();
    let calls = 0;
    api.removeWorkspace = async () => { calls++; throw new Error('Cannot save workspace list'); };
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Project from list' }));
    expect(calls).toBe(0);
    expect(screen.getByRole('alertdialog').textContent).toContain('/project');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Project from list' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove from list' }));
    await screen.findByText('Cannot save workspace list');
    expect(calls).toBe(1);
    expect(screen.getByRole('button', { name: 'Project' })).toBeTruthy();
  });
  it('guards unsaved settings when dismissed with Escape', async () => {
    render(<App backend={backend()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    await userEvent.selectOptions(screen.getByLabelText('Appearance'), 'dark');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((screen.getByLabelText('Appearance') as HTMLSelectElement).value).toBe('dark');
    await userEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('persists skipping the first-run tour and does not reopen it after remount', async () => {
    const api = backend();
    let preferences = { ...settings, onboardingCompleted: false };
    api.settings = async () => preferences;
    api.saveSettings = async value => { preferences = { ...value, onboardingCompleted: !!value.onboardingCompleted }; return preferences; };
    const view = render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Skip tour' }));
    expect(preferences.onboardingCompleted).toBe(true);
    view.unmount();
    render(<App backend={api} />);
    await screen.findByRole('button', { name: 'Settings' });
    expect(screen.queryByRole('button', { name: 'Skip tour' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show tour' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close tour' }));
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
  });
  it.each([
    { status: null, error: null, message: 'Repository status unavailable.' },
    { status: snapshot.repositories[0].status, error: 'Access denied', message: 'Access denied' },
  ])("does not show branch data or Git tools for an unavailable inspection: $message", async ({ status, error, message }) => {
    const api = backend();
    let configReads = 0;
    api.gitConfig = async () => { configReads++; return []; };
    api.scan = async () => ({ ...snapshot, repositories: [{ relativePath: 'api', status, error }] });
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(await screen.findByRole('button', { name: /^api/ }));
    const inspector = screen.getByRole('region', { name: 'Inspector' });
    expect(within(inspector).getByText(message)).toBeTruthy();
    expect(inspector.textContent).not.toContain('Detached HEAD');
    expect(inspector.textContent).not.toContain('ahead');
    expect(inspector.textContent).not.toContain('index.ts');
    expect(within(inspector).queryByRole('button', { name: 'Hooks and LFS' })).toBeNull();
    expect(within(inspector).queryByRole('button', { name: 'Check ignore rule' })).toBeNull();
    expect(configReads).toBe(0);
    expect(within(inspector).getByRole('button', { name: 'Open repository in editor' })).toBeTruthy();
    expect(within(inspector).getByRole('button', { name: 'Open repository in terminal' })).toBeTruthy();
  });
  it("shows both detached HEAD and the change count in a repository row", async () => {
    const api = backend();
    api.scan = async () => ({ ...snapshot, repositories: [{ ...snapshot.repositories[0], status: {
      ...snapshot.repositories[0].status!, branch: null, detached: true,
    } }] });
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    expect(await screen.findByRole('button', { name: /api.*Detached HEAD.*1 change/ })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /api.*Detached HEAD.*1 change/ }));
    const inspector = screen.getByRole('region', { name: 'Inspector' });
    expect(within(inspector).getByText('Detached HEAD')).toBeTruthy();
    expect(within(inspector).getByText('0 ahead / 0 behind')).toBeTruthy();
    expect(within(inspector).getByRole('button', { name: /index.ts/ })).toBeTruthy();
  });
  it("closes a completed deferred save and restores focus to settings", async () => {
    const api = backend();
    let finish: () => void = () => {};
    api.saveSettings = draft => new Promise(resolve => { finish = () => resolve(draft); });
    render(<App backend={api} />);
    const opener = await screen.findByRole('button', { name: 'Settings' });
    await userEvent.click(opener);
    await userEvent.selectOptions(screen.getByLabelText('Appearance'), 'dark');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByText('Saving settings...')).toBeTruthy();
    expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBe('true');
    await act(async () => finish());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.activeElement).toBe(opener);
  });
  it("locks the settings draft and dismissal while saving, then permits retry after failure", async () => {
    const api = backend();
    let reject: (error: Error) => void = () => {};
    let writes = 0;
    api.saveSettings = async () => { writes++; return new Promise((_, failure) => { reject = failure; }); };
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    const modal = screen.getByRole('dialog');
    const editor = within(modal).getByLabelText('Editor application');
    await userEvent.clear(editor);
    await userEvent.type(editor, 'custom-editor');
    await userEvent.click(within(modal).getByRole('button', { name: 'Save settings' }));
    expect(writes).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
    for (const control of modal.querySelectorAll('input, select, textarea, button')) {
      expect(control.hasAttribute('disabled')).toBe(true);
    }
    expect(document.activeElement).toBe(modal);
    await userEvent.keyboard('{Escape}{Tab}{Shift>}{Tab}{/Shift}');
    expect(screen.getByRole('dialog')).toBe(modal);
    expect(document.activeElement).toBe(modal);
    expect(writes).toBe(1);
    await act(async () => reject(new Error('Disk unavailable')));
    expect(within(modal).getByRole('alert').textContent).toContain('Disk unavailable');
    expect((editor as HTMLInputElement).value).toBe('custom-editor');
    expect(editor.hasAttribute('disabled')).toBe(false);
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(within(modal).getByRole('button', { name: 'Close settings' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it("shows unmatched repository filters and matches the workspace root name", async () => {
    const api = backend();
    api.scan = async () => ({ ...snapshot, repositories: [{ ...snapshot.repositories[0], relativePath: '.' }] });
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await screen.findByRole('button', { name: /Project.*main/ });
    const filter = screen.getByRole('textbox', { name: 'Filter workspace' });
    await userEvent.type(filter, 'missing');
    expect(await screen.findByText('No repositories match your filter.')).toBeTruthy();
    await userEvent.clear(filter);
    await userEvent.type(filter, 'PROJECT');
    expect(screen.getByRole('button', { name: /Project.*main/ })).toBeTruthy();
    expect(screen.queryByText('No repositories match your filter.')).toBeNull();
  });
  it("separates unavailable inspections from repositories with changes", async () => {
    const api = backend();
    api.scan = async () => ({ ...snapshot, repositories: [
      snapshot.repositories[0],
      { relativePath: 'locked', status: null, error: 'Access denied' },
      { relativePath: 'missing', status: null, error: null },
    ] });
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    const summary = await screen.findByRole('region', { name: 'Workspace summary' });
    expect(summary.textContent).toContain('3 repositories');
    expect(summary.textContent).toContain('1 with changes');
    expect(summary.textContent).toContain('2 unavailable');
  });
  it("saves the terminal choice and opens the selected repository", async () => {
    const api = backend();
    const opened: string[][] = [];
    api.openTerminal = async (id, path) => { opened.push([id, path]); };
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.selectOptions(screen.getByLabelText('Terminal'), 'cmd');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect((await api.settings()).terminal).toBe('cmd');
    await userEvent.click(await screen.findByRole('button', { name: /api.*main/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Open repository in terminal' }));
    expect(opened).toEqual([['one', 'api']]);
  });
  it("reports terminal failures and prevents repeated pending launches", async () => {
    const api = backend();
    let reject: (error: Error) => void = () => {};
    api.openTerminal = async () => new Promise((_, failure) => { reject = failure; });
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(await screen.findByRole('button', { name: /api.*main/ }));
    const button = screen.getByRole('button', { name: 'Open repository in terminal' });
    await userEvent.click(button);
    expect(button.hasAttribute('disabled')).toBe(true);
    await act(async () => reject(new Error('Terminal unavailable')));
    expect((await screen.findByRole('alert')).textContent).toContain('Terminal unavailable');
    expect(button.hasAttribute('disabled')).toBe(false);
  });
  it("opens repositories and agent files in the configured editor", async () => {
    const api = backend();
    const opened: string[][] = [];
    api.openEditor = async (id, path) => { opened.push([id, path]); };
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(await screen.findByRole('button', { name: /api.*main/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Open repository in editor' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Agents' }));
    await userEvent.click(await screen.findByRole('button', { name: /^AGENTS.md,/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Open file in editor' }));
    expect(opened).toEqual([['one', 'api'], ['one', 'AGENTS.md']]);
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.clear(screen.getByLabelText('Editor application'));
    await userEvent.type(screen.getByLabelText('Editor application'), 'C:/Editors/My Editor.exe');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply settings' }));
    expect((await api.settings()).editor).toBe('C:/Editors/My Editor.exe');
  });
  it("reports editor launch failure", async () => {
    const api = backend();
    api.openEditor = async () => { throw new Error('Editor unavailable'); };
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(await screen.findByRole('button', { name: /api.*main/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Open repository in editor' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Editor unavailable');
  });
  it("persists automatic refresh pause across application restarts", async () => {
    const api = backend();
    const first = render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pause automatic refresh' }));
    expect(await screen.findByRole('button', { name: 'Resume automatic refresh' })).toBeTruthy();
    expect((await api.settings()).autoRefresh).toBe(false);
    first.unmount();
    render(<App backend={api} />);
    expect(await screen.findByRole('button', { name: 'Resume automatic refresh' })).toBeTruthy();
  });
  it("does not pretend automatic refresh was paused when saving fails", async () => {
    const api = backend();
    api.saveSettings = async () => { throw new Error('Preferences cannot be saved'); };
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pause automatic refresh' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Preferences cannot be saved');
    expect(screen.getByRole('button', { name: 'Pause automatic refresh' })).toBeTruthy();
  });
  it("does not replace a newly selected file with a late refreshed preview", async () => {
    const api = backend();
    api.scan = async () => ({ ...snapshot, entries: [...snapshot.entries, { ...snapshot.entries[0], path: 'other.txt' }] });
    let reads = 0;
    let finish: (value: { kind: 'text'; content: string }) => void = () => {};
    api.preview = async (_id, path) => {
      if (path === 'other.txt') return { kind: 'text', content: 'other file content' };
      if (++reads === 1) return { kind: 'text', content: 'first file content' };
      return new Promise(resolve => { finish = resolve; });
    };
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pause automatic refresh' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await userEvent.click(await screen.findByRole('button', { name: /^AGENTS.md,/ }));
    expect(await screen.findByText('first file content')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh workspace' }));
    await waitFor(() => expect(reads).toBe(2));
    await userEvent.click(screen.getByRole('button', { name: /^other.txt,/ }));
    expect(await screen.findByText('other file content')).toBeTruthy();
    await act(async () => finish({ kind: 'text', content: 'stale refresh response' }));
    expect(screen.queryByText('stale refresh response')).toBeNull();
    expect(screen.getByText('other file content')).toBeTruthy();
  });
  it("refreshes an open file preview after scanning and clears deleted content", async () => {
    const api = backend();
    let text = 'original instructions';
    let missing = false;
    api.preview = async () => {
      if (missing) throw new Error('File no longer exists');
      return { kind: 'text', content: text };
    };
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Agents' }));
    await userEvent.click(await screen.findByRole('button', { name: /^AGENTS.md,/ }));
    expect(await screen.findByText('original instructions')).toBeTruthy();
    text = 'new agent instructions';
    await userEvent.click(screen.getByRole('button', { name: 'Refresh workspace' }));
    expect(await screen.findByText('new agent instructions')).toBeTruthy();
    missing = true;
    await userEvent.click(screen.getByRole('button', { name: 'Refresh workspace' }));
    expect((await screen.findByRole('alert')).textContent).toContain('File no longer exists');
    expect(screen.queryByText('new agent instructions')).toBeNull();
  });
  it("refreshes an open diff after a scan completes", async () => {
    const api = backend();
    let diff = '+first';
    api.diff = async () => diff;
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(await screen.findByRole('button', { name: /api.*main/ }));
    await userEvent.click(screen.getByRole('button', { name: /index.ts/ }));
    expect(await screen.findByText('+first')).toBeTruthy();
    diff = '+second';
    await userEvent.click(screen.getByRole('button', { name: 'Refresh workspace' }));
    expect(await screen.findByText('+second')).toBeTruthy();
  });
  it("navigates workspace tabs with arrows, Home and End using one tab stop", async () => {
    render(<App backend={backend()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    const repositories = screen.getByRole('tab', { name: 'Repositories' });
    await userEvent.click(repositories);
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Files' }));
    expect(screen.getByRole('tabpanel', { name: 'Files' })).toBeTruthy();
    expect(repositories.tabIndex).toBe(-1);
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Agents' }));
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(repositories);
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Agents' }));
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(repositories);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Filter workspace' }));
  });
  it("shows settings save errors inside the dialog and clears them when reopened", async () => {
    const api = backend();
    api.saveSettings = async () => { throw new Error('Invalid theme or scan limits'); };
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect((await within(screen.getByRole('dialog')).findByRole('alert')).textContent).toContain('Invalid theme or scan limits');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(within(screen.getByRole('dialog')).queryByRole('alert')).toBeNull();
  });
  it("prevents duplicate settings writes while a save is pending", async () => {
    const api = backend();
    let saves = 0;
    let finish: (settings: Settings) => void = () => {};
    api.saveSettings = async () => { saves++; return new Promise(resolve => { finish = resolve; }); };
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const save = screen.getByRole('button', { name: 'Save settings' });
    await userEvent.click(save);
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(save);
    expect(saves).toBe(1);
    await act(async () => finish(await api.settings()));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it("cancels a departed workspace and ignores its late progress and completion", async () => {
    const api = backend();
    api.settings = async () => ({ ...settings, workspaces: [
      { id: 'one', name: 'First', rootPath: '/first' },
      { id: 'two', name: 'Second', rootPath: '/second' },
    ] });
    let publish: (progress: ScanProgress) => void = () => {};
    let finish: (value: Snapshot) => void = () => {};
    const cancelled: string[] = [];
    api.cancelScan = async id => { cancelled.push(id); };
    api.scan = async (id, onProgress) => {
      if (id === 'two') return snapshot;
      publish = onProgress!;
      return new Promise(resolve => { finish = resolve; });
    };
    render(<App backend={api} />);
    await screen.findByRole('button', { name: 'Stop scan' });
    await userEvent.click(screen.getByRole('button', { name: 'Second' }));
    expect(cancelled).toEqual(['one']);
    await screen.findByRole('button', { name: /api.*main/ });
    await userEvent.click(screen.getByRole('tab', { name: 'Files' }));
    const oldEntries = [{ ...snapshot.entries[0], path: 'old-workspace.txt' }];
    await act(async () => {
      publish({ phase: 'discovery', entries: oldEntries, repository: null, entryCount: 1, repositoryCount: 0, inspectedCount: 0 });
      finish({ entries: oldEntries, repositories: [], warnings: [] });
    });
    expect(screen.getByRole('button', { name: /^AGENTS.md,/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^old-workspace.txt,/ })).toBeNull();
  });
  it("cancels an in-flight scan on unmount and handles cancellation failure", async () => {
    const api = backend();
    api.settings = async () => ({ ...settings, workspaces: [{ id: 'one', name: 'First', rootPath: '/first' }] });
    let finish: (value: Snapshot) => void = () => {};
    api.scan = async () => new Promise(resolve => { finish = resolve; });
    const cancelled: string[] = [];
    api.cancelScan = async id => { cancelled.push(id); throw new Error('IPC closed'); };
    const view = render(<App backend={api} />);
    await screen.findByRole('button', { name: 'Stop scan' });
    view.unmount();
    expect(cancelled).toEqual(['one']);
    await act(async () => finish(snapshot));
  });
  it("does not request cancellation for a completed scan on unmount", async () => {
    const api = backend();
    api.settings = async () => ({ ...settings, autoRefresh: false, workspaces: [{ id: 'one', name: 'First', rootPath: '/first' }] });
    const cancelled: string[] = [];
    api.cancelScan = async id => { cancelled.push(id); };
    const view = render(<App backend={api} />);
    await screen.findByRole('button', { name: /api.*main/ });
    view.unmount();
    expect(cancelled).toEqual([]);
  });
  it("shows streamed files during scanning and restores the previous snapshot on cancellation", async () => {
    const api = backend();
    let calls = 0;
    let publish: (progress: ScanProgress) => void = () => {};
    let rejectScan: (error: Error) => void = () => {};
    const progress: ScanProgress = { phase: 'discovery', entries: [{ ...snapshot.entries[0], path: 'partial.txt' }], repository: null, entryCount: 1, repositoryCount: 0, inspectedCount: 0 };
    api.scan = async (_id, onProgress) => {
      if (++calls === 1) return snapshot;
      publish = onProgress!;
      publish(progress);
      return new Promise((_resolve, reject) => { rejectScan = reject; });
    };
    api.cancelScan = async () => rejectScan(new Error('Scan cancelled'));
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await screen.findByRole('button', { name: /api.*main/ });
    await userEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh workspace' }));
    expect(await screen.findByRole('button', { name: /^partial.txt,/ })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('1 entries discovered');
    await userEvent.click(screen.getByRole('button', { name: 'Stop scan' }));
    expect(await screen.findByText('Scan cancelled')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^partial.txt,/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^AGENTS.md,/ })).toBeTruthy();
    await act(async () => publish(progress));
    expect(screen.queryByRole('button', { name: /^partial.txt,/ })).toBeNull();
  });
  it("keeps recovery available when a backup cannot be created", async () => {
    const api = backend();
    api.settings = async () => { throw new Error('Settings are invalid'); };
    api.recoverSettings = async () => { throw new Error('Cannot create settings backup; original file preserved'); };
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reset preferences' }));
    await userEvent.click(screen.getByRole('button', { name: 'Back up and reset preferences' }));
    expect((await screen.findByRole('alert')).textContent).toContain('original file preserved');
    expect((screen.getByRole('button', { name: 'Back up and reset preferences' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('heading', { name: 'Your workspaces' })).toBeNull();
  });
  it("retries unavailable settings without resetting preferences", async () => {
    const api = backend();
    let attempts = 0;
    api.settings = async () => {
      if (++attempts === 1) throw new Error('Settings are invalid');
      return { ...settings, theme: 'dark' };
    };
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry loading settings' }));
    expect(await screen.findByRole('heading', { name: 'Your workspaces' })).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
  it("requires confirmation before recovering settings and displays the backup path", async () => {
    const api = backend();
    let resets = 0;
    api.settings = async () => { throw new Error('Settings are invalid'); };
    api.recoverSettings = async () => { resets++; return { settings, backupPath: '/profile/settings.backup.json' }; };
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reset preferences' }));
    expect(resets).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel reset' }));
    expect(resets).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Reset preferences' }));
    await userEvent.click(screen.getByRole('button', { name: 'Back up and reset preferences' }));
    expect(await screen.findByRole('heading', { name: 'Your workspaces' })).toBeTruthy();
    expect(resets).toBe(1);
    expect(screen.getByRole('status').textContent).toContain('/profile/settings.backup.json');
  });
  it("stops an in-flight scan and restores the refresh control", async () => {
    const api = backend();
    let rejectScan: (reason: unknown) => void = () => {};
    api.scan = async () => new Promise((_resolve, reject) => { rejectScan = reject; });
    api.cancelScan = async () => rejectScan(new Error('Scan cancelled'));
    render(<App backend={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop scan' }));
    expect(await screen.findByText('Scan cancelled')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Refresh workspace' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it("contains keyboard focus in settings and restores it on Escape", async () => {
    render(<App backend={backend()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add workspace" }));
    const opener = screen.getByRole("button", { name: "Settings" });
    await userEvent.click(opener);
    const close = screen.getByRole("button", { name: "Close settings" });
    expect(document.activeElement).toBe(close);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save settings" }));
    await userEvent.tab();
    expect(document.activeElement).toBe(close);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
  it("adds a workspace and inspects changed files and diffs", async () => {
    render(<App backend={backend()} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Add workspace" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /api.*main/i }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /index.ts/i }),
    );
    expect(await screen.findByText("+new line")).toBeTruthy();
  });
  it("opens agent configuration previews and persists theme changes", async () => {
    const api = backend();
    render(<App backend={api} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Add workspace" }),
    );
    await userEvent.click(await screen.findByRole("tab", { name: /Agents/ }));
    await userEvent.click(
      await screen.findByRole("button", { name: /AGENTS.md/ }),
    );
    expect(await screen.findByText("Project instructions")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await userEvent.selectOptions(screen.getByLabelText("Appearance"), "dark");
    await userEvent.click(
      screen.getByRole("button", { name: "Save settings" }),
    );
    await waitFor(async () =>
      expect((await api.settings()).theme).toBe("dark"),
    );
    expect(await screen.findByText("Settings saved")).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: "Refresh workspace" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole("status").textContent).toBe("Settings saved");
  });
  it("displays scan errors with retry available", async () => {
    const api = backend();
    api.scan = async () => {
      throw new Error("Workspace unavailable");
    };
    render(<App backend={api} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Add workspace" }),
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Refresh workspace" }),
    ).toBeTruthy();
  });
});
