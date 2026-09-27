import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import type { Backend, Settings, Snapshot } from './types';

afterEach(cleanup);

function fixture(): Backend {
  let settings: Settings = {
    schemaVersion: 1, onboardingCompleted: true, autoRefresh: false,
    workspaces: [{ id: 'one', name: 'First', rootPath: '/first' }, { id: 'two', name: 'Second', rootPath: '/second' }],
    theme: 'light', maxDepth: 12, maxEntries: 50000, excluded: ['.git'], showHidden: false, editor: 'code',
  };
  const snapshot: Snapshot = { entries: [], warnings: [], repositories: ['api', 'web'].map(relativePath => ({
    relativePath, error: null, status: { path: `/project/${relativePath}`, branch: 'main', detached: false,
      upstream: null, ahead: 0, behind: 0, remotes: [], changes: [] },
  })) };
  return {
    settings: async () => settings,
    saveSettings: async value => (settings = value),
    addWorkspace: async () => null,
    removeWorkspace: async id => (settings = { ...settings, workspaces: settings.workspaces.filter(w => w.id !== id) }),
    recoverSettings: async () => ({ settings, backupPath: '/fixture/backup' }),
    scan: async () => snapshot, cancelScan: async () => {}, watch: async () => () => {},
    openTerminal: async () => {}, openEditor: async () => {}, openRemote: async () => {}, remoteTarget: async value => value,
    gitFeatures: async () => ({ hooks: [], lfsConfigured: false, lfsAttributes: [], warnings: [] }),
    gitConfig: async () => [], ignoreRule: async () => null,
    preview: async () => ({ kind: 'text', content: '' }), diff: async () => '', exportReport: async () => true,
  };
}

function current(container: HTMLElement) {
  return within(container).queryAllByRole('button', { current: true });
}

it('exposes only the active workspace as current through keyboard switching and removal', async () => {
  const user = userEvent.setup();
  render(<App backend={fixture()} />);
  const nav = await screen.findByRole('navigation', { name: 'Workspaces' });
  const first = within(nav).getByRole('button', { name: 'First' });
  const second = within(nav).getByRole('button', { name: 'Second' });
  expect(current(nav)).toEqual([first]);
  first.focus();
  await user.tab();
  expect(document.activeElement).toBe(within(nav).getByRole('button', { name: 'Remove First from list' }));
  await user.tab();
  expect(document.activeElement).toBe(second);
  await user.keyboard('{Enter}');
  expect(current(nav)).toEqual([second]);
  expect(document.activeElement).toBe(second);
  first.focus();
  await user.keyboard(' ');
  expect(current(nav)).toEqual([first]);
  expect(document.activeElement).toBe(first);
  expect(first.hasAttribute('role')).toBe(false);
  expect(first.hasAttribute('aria-selected')).toBe(false);
  await user.click(within(nav).getByRole('button', { name: 'Remove First from list' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove from list' }));
  await waitFor(() => expect(current(nav)).toEqual([second]));
});

it('exposes exactly one chosen repository without changing button focus or inventing a filtered selection', async () => {
  const user = userEvent.setup();
  render(<App backend={fixture()} />);
  const api = await screen.findByRole('button', { name: /^api/ });
  const list = screen.getByRole('region', { name: 'Repositories' });
  const web = within(list).getByRole('button', { name: /^web/ });
  expect(current(list)).toEqual([]);
  api.focus();
  await user.keyboard('{Enter}');
  expect(current(list)).toEqual([api]);
  expect(document.activeElement).toBe(api);
  await user.tab();
  expect(document.activeElement).toBe(web);
  await user.keyboard(' ');
  expect(current(list)).toEqual([web]);
  expect(document.activeElement).toBe(web);
  expect(web.hasAttribute('role')).toBe(false);
  expect(web.hasAttribute('aria-selected')).toBe(false);
  const search = screen.getByRole('textbox', { name: 'Filter workspace' });
  await user.type(search, 'api');
  expect(current(list)).toEqual([]);
  await user.clear(search);
  expect(current(list)).toEqual([within(list).getByRole('button', { name: /^web/ })]);
  const nav = screen.getByRole('navigation', { name: 'Workspaces' });
  await user.click(within(nav).getByRole('button', { name: 'Second' }));
  await screen.findByRole('button', { name: /^api/ });
  expect(current(list)).toEqual([]);
});

it('does not transfer current workspace semantics to a different search result', async () => {
  const user = userEvent.setup();
  render(<App backend={fixture()} />);
  const nav = await screen.findByRole('navigation', { name: 'Workspaces' });
  const search = screen.getByRole('textbox', { name: 'Search workspaces' });
  await user.type(search, 'Second');
  expect(current(nav)).toEqual([]);
  await user.clear(search);
  expect(current(nav)).toEqual([within(nav).getByRole('button', { name: 'First' })]);
});
