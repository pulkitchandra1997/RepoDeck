import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ContentPreview, { numberLines } from './ContentPreview';
import userEvent from '@testing-library/user-event';
afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());
it('copies the complete content rather than just the visible page and reports clipboard failure', async () => {
  const user = userEvent.setup();
  const content = 'x\n'.repeat(2100);
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  render(<ContentPreview content={content} mode="text" />);
  await user.click(screen.getByRole('button', { name: 'Copy full content' }));
  expect(write).toHaveBeenCalledWith(content);
  write.mockRejectedValueOnce(new Error('Permission denied'));
  await user.click(screen.getByRole('button', { name: 'Copy full content' }));
  expect(screen.getByRole('status').textContent).toContain('Copy failed');
});
it('calculates diff numbers when a page starts within a hunk', () => {
  const content = '@@ -1,1000 +1,1000 @@\n' + ' same\n'.repeat(999) + '-old\n+new\n';
  expect(numberLines(content, true, 1000, 2).map(row => [row.oldLine, row.newLine])).toEqual([[1000, null], [null, 1000]]);
});
it('returns to the first page for newly opened content', async () => {
  const view = render(<ContentPreview content={'x\n'.repeat(2100)} mode="text" />);
  await userEvent.click(screen.getByRole('button', { name: 'Last lines' }));
  view.rerender(<ContentPreview content={'y\n'.repeat(1100)} mode="text" />);
  expect(document.querySelector('.line-number')?.getAttribute('data-line')).toBe('1');
});
it('bounds rendered rows and keeps line numbers accurate across pages', async () => {
  render(<ContentPreview content={'x\n'.repeat(2100)} mode="text" />);
  expect(document.querySelectorAll('.source-line')).toHaveLength(1000);
  await userEvent.click(screen.getByRole('button', { name: 'Next lines' }));
  expect(document.querySelector('.line-number')?.getAttribute('data-line')).toBe('1001');
  await userEvent.click(screen.getByRole('button', { name: 'Last lines' }));
  expect(document.querySelectorAll('.source-line')).toHaveLength(100);
  expect(document.querySelector('.line-number')?.getAttribute('data-line')).toBe('2001');
  await userEvent.click(screen.getByRole('button', { name: 'First lines' }));
  expect(document.querySelector('.line-number')?.getAttribute('data-line')).toBe('1');
});
it('colors hunk content beginning with header-like characters but not actual headers', () => {
  render(<ContentPreview content={'--- a/file\n+++ b/file\n@@ -1 +1 @@\n---old value\n+++new value\n'} mode="diff" />);
  expect(screen.getByText('--- a/file').classList.contains('danger')).toBe(false);
  expect(screen.getByText('+++ b/file').classList.contains('green')).toBe(false);
  expect(screen.getByText('---old value').classList.contains('danger')).toBe(true);
  expect(screen.getByText('+++new value').classList.contains('green')).toBe(true);
});
it('numbers physical source lines without inventing a final empty line', () => {
  expect(numberLines('one\ntwo\n', false).map(row => row.newLine)).toEqual([1, 2]);
  expect(numberLines('', false)).toEqual([]);
});
it('tracks both sides of multiple diff hunks including zero-length ranges', () => {
  const rows = numberLines('--- a/f\n+++ b/f\n@@ -4,2 +4,2 @@\n keep\n-old\n+new\n@@ -0,0 +1 @@\n+first\n\\ No newline at end of file', true);
  expect(rows.slice(3, 6).map(row => [row.oldLine, row.newLine])).toEqual([[4, 4], [5, null], [null, 5]]);
  expect(rows[7]).toMatchObject({ oldLine: null, newLine: 1 });
  expect(rows[8]).toMatchObject({ oldLine: null, newLine: null });
});
it('does not number diff headers or status messages', () => {
  render(<ContentPreview content="Binary file (10 bytes)" mode="message" />);
  expect(screen.getByText('Binary file (10 bytes)')).toBeTruthy();
  expect(document.querySelector('.line-number')).toBeNull();
});
it('copies source text without line numbers', () => {
  render(<ContentPreview content={'alpha\nbeta\n'} mode="text" />);
  const pre = screen.getByLabelText('File content');
  const range = document.createRange();
  range.selectNodeContents(pre);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  let copied = '';
  fireEvent.copy(pre, { clipboardData: { setData: (_type: string, value: string) => { copied = value; } } });
  expect(copied).toBe('alpha\nbeta\n');
  expect(pre.querySelectorAll('.line-number')).toHaveLength(2);
});
