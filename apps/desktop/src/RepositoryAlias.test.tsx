import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RepositoryAlias from './RepositoryAlias';
import { useState } from 'react';

function AliasEditor({ alias, onSave }: { alias: string; onSave: (value: string) => Promise<void> }) {
  const [draft, setDraft] = useState<string>();
  return <RepositoryAlias alias={alias} draft={draft} onDraftChange={setDraft} onSave={onSave} />;
}

afterEach(cleanup);
it('returns keyboard focus to the custom-name button after saving', async () => {
  const save = vi.fn(async () => {});
  render(<AliasEditor alias="" onSave={save} />);
  await userEvent.click(screen.getByRole('button', { name: 'Edit custom name' }));
  await userEvent.type(screen.getByLabelText('Custom name'), 'Payments');
  await userEvent.click(screen.getByRole('button', { name: 'Save custom name' }));
  expect(save).toHaveBeenCalledWith('Payments');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit custom name' }));
});
it('returns focus after canceling an unchanged edit', async () => {
  const save = vi.fn(async () => {});
  render(<AliasEditor alias="Payments" onSave={save} />);
  await userEvent.click(screen.getByRole('button', { name: 'Edit custom name' }));
  await userEvent.keyboard('{Escape}');
  expect(save).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit custom name' }));
});
it('discards an edited alias only after confirmation and restores focus', async () => {
  const save = vi.fn(async () => {});
  render(<AliasEditor alias="" onSave={save} />);
  await userEvent.click(screen.getByRole('button', { name: 'Edit custom name' }));
  await userEvent.type(screen.getByLabelText('Custom name'), 'Payments');
  await userEvent.keyboard('{Escape}');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect((screen.getByLabelText('Custom name') as HTMLInputElement).value).toBe('Payments');
  await userEvent.keyboard('{Escape}');
  await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(save).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit custom name' }));
});

it('treats an empty draft as an unsaved restore-default edit', async () => {
  const save = vi.fn(async () => {});
  render(<AliasEditor alias="Payments" onSave={save} />);
  await userEvent.click(screen.getByRole('button', { name: 'Edit custom name' }));
  await userEvent.click(screen.getByRole('button', { name: 'Restore default name' }));
  expect((screen.getByLabelText('Custom name') as HTMLInputElement).value).toBe('');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel custom name' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect((screen.getByLabelText('Custom name') as HTMLInputElement).value).toBe('');
  await userEvent.click(screen.getByRole('button', { name: 'Save custom name' }));
  expect(save).toHaveBeenCalledWith('');
  expect(screen.queryByLabelText('Custom name')).toBeNull();
});

it('retains a controlled draft when validation or saving fails', async () => {
  const save = vi.fn(async () => { throw new Error('Disk full'); });
  render(<AliasEditor alias="" onSave={save} />);
  await userEvent.click(screen.getByRole('button', { name: 'Edit custom name' }));
  await userEvent.type(screen.getByLabelText('Custom name'), 'x'.repeat(81));
  await userEvent.click(screen.getByRole('button', { name: 'Save custom name' }));
  expect(save).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Custom name') as HTMLInputElement).value).toBe('x'.repeat(81));
  await userEvent.clear(screen.getByLabelText('Custom name'));
  await userEvent.type(screen.getByLabelText('Custom name'), 'Payments');
  await userEvent.click(screen.getByRole('button', { name: 'Save custom name' }));
  expect(screen.getByRole('alert').textContent).toContain('Disk full');
  expect((screen.getByLabelText('Custom name') as HTMLInputElement).value).toBe('Payments');
});
