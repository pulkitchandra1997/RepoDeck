import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Onboarding from './Onboarding';

afterEach(cleanup);
it('shows three visual steps with back navigation and explicit completion', async () => {
  const finish = vi.fn(async () => {});
  render(<Onboarding firstRun onFinish={finish} />);
  expect(screen.getByRole('heading', { name: 'Choose a project folder' })).toBeTruthy();
  expect(screen.getByRole('img').getAttribute('alt')).toContain('Add workspace');
  expect(finish).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('heading', { name: 'Review changes across repositories' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('heading', { name: 'Choose a project folder' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add a workspace' }));
  expect(finish).toHaveBeenCalledWith(true);
});
it('lets users skip without opening a folder picker', async () => {
  const finish = vi.fn(async () => {});
  render(<Onboarding firstRun onFinish={finish} />);
  await userEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
  expect(finish).toHaveBeenCalledWith(false);
});
it('keeps the tour available after a preference save error', async () => {
  render(<Onboarding firstRun onFinish={async () => { throw new Error('Disk unavailable'); }} />);
  await userEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Disk unavailable');
  expect(screen.getByRole('button', { name: 'Skip tour' }).hasAttribute('disabled')).toBe(false);
});
