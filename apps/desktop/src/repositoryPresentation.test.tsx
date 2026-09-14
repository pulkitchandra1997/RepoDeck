import { expect, it } from 'vitest';
import { aliasKey, projectTypes, fileStatuses, changeStyle, repositoryName, diffTone } from './repositoryPresentation';
import type { Entry, Snapshot } from './types';
const entry = (path: string, repository = false): Entry => ({ path, repository, directory: repository, agentConfig: false, size: 0, modifiedMs: 0 });
it('uses origin name then folder fallback and normalizes Windows alias identity', () => {
  expect(repositoryName({ relativePath: 'services/api', status: null, error: null }, 'Project')).toBe('api');
  expect(repositoryName({ relativePath: 'clone', error: null, status: { path: '/clone', originUrl: 'git@example.org:team/canonical.git', branch: 'main', detached: false, upstream: null, ahead: 0, behind: 0, changes: [], remotes: [] } }, 'Project')).toBe('canonical');
  expect(aliasKey('\\\\?\\C:\\Projects\\App', 'services/api')).toBe(aliasKey('C:/Projects/App/services/api', '.'));
});
it('uses source fallback conservatively and ignores dependencies', () => {
  expect(projectTypes([entry('.', true), entry('main.go')]).get('.')).toEqual(['Go']);
  expect(projectTypes([entry('.', true), entry('a.go'), entry('a.py')]).get('.')).toEqual([]);
  expect(projectTypes([entry('.', true), entry('node_modules/pkg/package.json')]).get('.')).toEqual([]);
});
it.each(['go', 'py', 'csproj', 'constructor', 'toString', '__proto__', 'main.constructor', 'main.__proto__'])('does not infer a language from the unrelated filename %s', name => {
  expect(projectTypes([entry('.', true), entry(name)]).get('.')).toEqual([]);
});
it('recognizes real project extensions without an extensionless lookalike overriding source evidence', () => {
  expect(projectTypes([entry('.', true), entry('App.csproj')]).get('.')).toEqual(['C#']);
  expect(projectTypes([entry('.', true), entry('go'), entry('main.py')]).get('.')).toEqual(['Python']);
});
it.each(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])('marks %s as a conflict', code => {
  expect(changeStyle({ path: 'f', originalPath: null, index: code[0], worktree: code[1] })).toMatchObject({ tone: 'danger', label: 'Conflict' });
});
it('colors diff additions and removals without coloring headers or plain source', () => {
  expect(diffTone('+added', true)).toBe('green');
  expect(diffTone('-removed', true)).toBe('danger');
  expect(diffTone('+++ b/path', true)).toBe('');
  expect(diffTone('+ordinary source', false)).toBe('');
  expect(diffTone('<<<<<<< HEAD', false)).toContain('conflict-line');
});
it('detects mixed build types without borrowing nested repository files', () => {
  const entries = [entry('.', true), entry('pom.xml'), entry('src/Main.java'), entry('client/tsconfig.json'), entry('child', true), entry('child/pyproject.toml')];
  expect(projectTypes(entries).get('.')).toEqual(['Java', 'TypeScript']);
  expect(projectTypes(entries).get('child')).toEqual(['Python']);
  expect(projectTypes([entry('.', true), entry('README.md')]).get('.')).toEqual([]);
});
it('prioritizes conflicts and retains explicit staged and unstaged labels', () => {
  expect(changeStyle({ path: 'a', originalPath: null, index: 'A', worktree: 'A' }).label).toContain('Conflict');
  expect(changeStyle({ path: 'a', originalPath: null, index: 'M', worktree: 'M' }).label).toContain('Staged');
  expect(changeStyle({ path: 'a', originalPath: null, index: '?', worktree: '?' }).tone).toBe('green');
});
it('keeps parent status out of unavailable nested repositories', () => {
  const status = { path: '/p', branch: 'main', detached: false, upstream: null, ahead: 0, behind: 0, remotes: [], changes: [{ path: 'child/a.py', originalPath: null, index: 'M', worktree: ' ' }] };
  const repos: Snapshot['repositories'] = [{ relativePath: '.', status, error: null }, { relativePath: 'child', status: null, error: 'Missing Git' }];
  expect(fileStatuses(repos).has('child/a.py')).toBe(false);
});
