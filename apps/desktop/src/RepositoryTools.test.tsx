import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RepositoryTools from './RepositoryTools';
afterEach(cleanup);
it('loads configuration on request and displays the matched ignore rule', async () => {
  render(<RepositoryTools id="one" repository="api" backend={{
    gitFeatures: async () => ({ hooks: [], lfsConfigured: false, lfsAttributes: [], warnings: [] }),
    gitConfig: async () => [{ key: 'core.autocrlf', value: 'false', hidden: false }, { key: 'credential.helper', value: '[hidden]', hidden: true }],
    ignoreRule: async (_id, _repo, path) => path === 'error.log' ? { source: '.gitignore', line: 3, pattern: '*.log', path } : null,
  }} />);
  await userEvent.click(screen.getByRole('button', { name: 'Git configuration' }));
  expect(await screen.findByText('core.autocrlf')).toBeTruthy();
  expect(screen.getByText('[hidden]')).toBeTruthy();
  await userEvent.type(screen.getByLabelText('Repository-relative path'), 'error.log');
  await userEvent.click(screen.getByRole('button', { name: 'Check ignore rule' }));
  expect(await screen.findByText('.gitignore:3')).toBeTruthy();
  expect(screen.getByText('*.log')).toBeTruthy();
  await userEvent.clear(screen.getByLabelText('Repository-relative path'));
  await userEvent.type(screen.getByLabelText('Repository-relative path'), 'app.rs');
  await userEvent.click(screen.getByRole('button', { name: 'Check ignore rule' }));
  expect(await screen.findByText('No ignore rule matched.')).toBeTruthy();
});
it('reports query failures instead of claiming no rule matched', async () => {
  render(<RepositoryTools id="one" repository="api" backend={{ gitFeatures: async () => ({ hooks: [], lfsConfigured: false, lfsAttributes: [], warnings: [] }), gitConfig: async () => [], ignoreRule: async () => { throw new Error('Git timed out'); } }} />);
  await userEvent.type(screen.getByLabelText('Repository-relative path'), 'file.txt');
  await userEvent.click(screen.getByRole('button', { name: 'Check ignore rule' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('No ignore rule matched.')).toBeNull();
});

it('shows hook files, LFS declarations and inventory warnings on request', async () => {
  render(<RepositoryTools id="one" repository="api" backend={{
    gitConfig: async () => [], ignoreRule: async () => null,
    gitFeatures: async () => ({ hooks: ['pre-commit'], lfsConfigured: true, lfsAttributes: ['assets/.gitattributes'], warnings: ['Cannot inspect attributes: restricted/.gitattributes'] }),
  }} />);
  await userEvent.click(screen.getByRole('button', { name: 'Hooks and LFS' }));
  expect(await screen.findByText('pre-commit')).toBeTruthy();
  expect(screen.getByText('LFS filter configured')).toBeTruthy();
  expect(screen.getByText('assets/.gitattributes')).toBeTruthy();
  expect(screen.getByText('Cannot inspect attributes: restricted/.gitattributes')).toBeTruthy();
});
