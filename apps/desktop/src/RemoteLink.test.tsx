import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RemoteLink from './RemoteLink';

afterEach(cleanup);
it('allows an explicit browser address when the remote cannot be mapped', async () => {
  const opened: string[] = [];
  render(<RemoteLink remote="ssh://alias:2222/app" backend={{ remoteTarget: async () => { throw new Error('Cannot infer browser address'); }, openRemote: async url => { opened.push(url); } }} />);
  await userEvent.click(screen.getByRole('button', { name: 'Open remote in browser' }));
  await userEvent.type(await screen.findByLabelText('Browser URL'), 'https://example.org/team/app');
  await userEvent.click(screen.getByRole('button', { name: 'Open confirmed URL' }));
  expect(opened).toEqual(['https://example.org/team/app']);
});
it('previews the target and opens only after explicit confirmation', async () => {
  const opened: string[] = [];
  const backend = { remoteTarget: async () => 'https://example.org/team/app', openRemote: async (url: string) => { opened.push(url); } };
  render(<RemoteLink backend={backend} remote="git@example.org:team/app.git" />);
  await userEvent.click(screen.getByRole('button', { name: 'Open remote in browser' }));
  expect(await screen.findByDisplayValue('https://example.org/team/app')).toBeTruthy();
  expect(opened).toEqual([]);
  await userEvent.click(screen.getByRole('button', { name: 'Cancel opening remote' }));
  expect(opened).toEqual([]);
  await userEvent.click(screen.getByRole('button', { name: 'Open remote in browser' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Open confirmed URL' }));
  expect(opened).toEqual(['https://example.org/team/app']);
});
it('shows browser launch errors without claiming success', async () => {
  render(<RemoteLink remote="https://example.org/app" backend={{ remoteTarget: async () => 'https://example.org/app', openRemote: async () => { throw new Error('No browser available'); } }} />);
  await userEvent.click(screen.getByRole('button', { name: 'Open remote in browser' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Open confirmed URL' }));
  expect((await screen.findByRole('alert')).textContent).toContain('No browser available');
});
