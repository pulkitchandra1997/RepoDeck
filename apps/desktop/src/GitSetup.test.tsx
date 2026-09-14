import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GitSetup from './GitSetup';

afterEach(cleanup);
it('checks Git before opening the workspace', async () => {
  const install = vi.fn();
  render(<GitSetup check={async () => ({ available: true, platform: 'windows', message: 'git version 2.50' })} install={install}>Workspace</GitSetup>);
  expect(await screen.findByText('Workspace')).toBeTruthy();
  expect(install).not.toHaveBeenCalled();
});
it('requires consent on macOS and rechecks after requesting Apple tools', async () => {
  let ready = false;
  const install = vi.fn(async () => 'Complete the Apple installer, then check again.');
  render(<GitSetup check={async () => ({ available: ready, platform: 'macos', message: 'Git missing' })} install={install}>Workspace</GitSetup>);
  await screen.findByText('Git missing');
  expect(install).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Install Command Line Tools' }));
  expect(install).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(install).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Install Command Line Tools' }));
  await userEvent.click(screen.getByRole('button', { name: 'Request installation' }));
  await screen.findByText('Complete the Apple installer, then check again.');
  expect(screen.queryByText('Workspace')).toBeNull();
  ready = true;
  await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
  expect(await screen.findByText('Workspace')).toBeTruthy();
});
it('reports installation failure without claiming Git is ready', async () => {
  render(<GitSetup check={async () => ({ available: false, platform: 'windows', message: 'Git missing' })} install={async () => { throw new Error('Download unavailable'); }}>Workspace</GitSetup>);
  await userEvent.click(await screen.findByRole('button', { name: 'Open Git download' }));
  await userEvent.click(screen.getByRole('button', { name: 'Open download page' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Workspace')).toBeNull();
});
