import { expect, it } from 'vitest';
import type { Repository } from './types';
import { repositoryStatus } from './repositoryStatus';
const repository: Repository = { path: '/repo', branch: 'main', detached: false, upstream: null, ahead: 0, behind: 0, remotes: [], changes: [] };
it('recognizes all seven unmerged states including delete/delete and add/add', () => {
  for (const state of ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']) {
    expect(repositoryStatus({ ...repository, changes: [{ path: 'file', index: state[0], worktree: state[1], originalPath: null }] })).toEqual({ label: '1 conflict', tone: 'danger' });
  }
});
it('highlights detached HEAD even when there are no changes', () => {
  expect(repositoryStatus({ ...repository, branch: null, detached: true })).toEqual({ label: 'Detached HEAD', tone: 'amber' });
});
it('does not hide changes or conflicts behind detached HEAD', () => {
  const detached = { ...repository, branch: null, detached: true };
  expect(repositoryStatus({ ...detached, changes: [
    { path: 'tracked', index: ' ', worktree: 'M', originalPath: null },
    { path: 'new', index: '?', worktree: '?', originalPath: null },
  ] })).toEqual({ label: '2 changes', tone: 'amber' });
  expect(repositoryStatus({ ...detached, changes: [
    { path: 'conflict', index: 'U', worktree: 'U', originalPath: null },
  ] })).toEqual({ label: '1 conflict', tone: 'danger' });
});
it('distinguishes ignored files from changes and reports divergence on clean trees', () => {
  const ignored = { ...repository, changes: [{ path: 'cache/', index: '!', worktree: '!', originalPath: null }] };
  expect(repositoryStatus(ignored).label).toBe('Clean');
  expect(repositoryStatus({ ...repository, ahead: 2, behind: 3 }).label).toBe('2 ahead / 3 behind');
  expect(repositoryStatus({ ...repository, changes: [{ path: 'file', index: '?', worktree: '?', originalPath: null }] }).label).toBe('1 change');
});
