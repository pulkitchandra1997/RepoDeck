import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Copy } from 'lucide-react';
import { diffTone } from './repositoryPresentation';

export function numberLines(content: string, diff: boolean, offset = 0, limit = Infinity) {
  const rows: { text: string; oldLine: number | null; newLine: number | null; newline: boolean }[] = [];
  let old = 0, next = 0, oldLeft = 0, newLeft = 0;
  let start = 0, index = 0;
  while (start < content.length && index < offset + limit) {
    const end = content.indexOf('\n', start);
    const text = content.slice(start, end < 0 ? content.length : end);
    let oldLine: number | null = null, newLine: number | null = null;
    if (!diff) newLine = index + 1;
    else {
      // Git emits ordinary unified hunks; only hunk body lines advance counters.
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(text);
      if (hunk) {
        [old, oldLeft, next, newLeft] = [Number(hunk[1]), Number(hunk[2] ?? 1), Number(hunk[3]), Number(hunk[4] ?? 1)];
      } else if (text.startsWith(' ') && oldLeft > 0 && newLeft > 0) {
        oldLine = old++; newLine = next++; oldLeft--; newLeft--;
      } else if (text.startsWith('-') && oldLeft > 0) {
        oldLine = old++; oldLeft--;
      } else if (text.startsWith('+') && newLeft > 0) {
        newLine = next++; newLeft--;
      } else if (!text.startsWith('\\')) { oldLeft = 0; newLeft = 0; }
    }
    if (index >= offset) rows.push({ text, oldLine, newLine, newline: end >= 0 });
    if (end < 0) break;
    start = end + 1; index++;
  }
  return rows;
}

export default function ContentPreview({ content, mode }: { content: string; mode: 'text' | 'diff' | 'message' }) {
  const [position, setPosition] = useState({ content, page: 0 });
  const [copyNotice, setCopyNotice] = useState({ content: '', message: '' });
  const [copying, setCopying] = useState(false);
  const pageSize = 1000;
  const total = useMemo(() => {
    let count = 0, start = 0;
    while (start < content.length) {
      count++;
      const end = content.indexOf('\n', start);
      if (end < 0) break;
      start = end + 1;
    }
    return count;
  }, [content]);
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const page = position.content === content ? Math.min(position.page, lastPage) : 0;
  const rows = useMemo(() => numberLines(content, mode === 'diff', page * pageSize, pageSize), [content, mode, page]);
  if (mode === 'message') return <pre className="preview">{content}</pre>;
  const digits = rows.reduce((max, row) => Math.max(max, String(Math.max(row.oldLine ?? 0, row.newLine ?? 0)).length), Math.max(2, String(total).length));
  return <>
    {total > pageSize && <nav className="preview-pagination" aria-label="Preview pages">
      <span>{page * pageSize + 1}-{Math.min(total, (page + 1) * pageSize)} of {total.toLocaleString()} lines</span>
      <button aria-label="First lines" title="First lines" disabled={page === 0} onClick={() => setPosition({ content, page: 0 })}><ChevronsLeft size={16} /></button>
      <button aria-label="Previous lines" title="Previous lines" disabled={page === 0} onClick={() => setPosition({ content, page: page - 1 })}><ChevronLeft size={16} /></button>
      <button aria-label="Next lines" title="Next lines" disabled={page === lastPage} onClick={() => setPosition({ content, page: page + 1 })}><ChevronRight size={16} /></button>
      <button aria-label="Last lines" title="Last lines" disabled={page === lastPage} onClick={() => setPosition({ content, page: lastPage })}><ChevronsRight size={16} /></button>
      <button aria-label="Copy full content" title="Copy full content" disabled={copying} onClick={async () => {
        setCopying(true);
        try { await navigator.clipboard.writeText(content); setCopyNotice({ content, message: 'Full content copied' }); }
        catch { setCopyNotice({ content, message: 'Copy failed. Select text or open the file in your editor.' }); }
        finally { setCopying(false); }
      }}><Copy size={16} /></button>
      {copyNotice.content === content && copyNotice.message && <span role="status">{copyNotice.message}</span>}
    </nav>}
    <pre className={`preview numbered-preview ${mode === 'diff' ? 'diff-preview' : ''}`} aria-label={mode === 'diff' ? 'Diff content' : 'File content'} style={{ '--line-width': `${digits + 2}ch` } as React.CSSProperties}
    onCopy={event => {
      const selection = window.getSelection();
      if (!selection?.rangeCount || !event.currentTarget.contains(selection.anchorNode) || !event.currentTarget.contains(selection.focusNode)) return;
      const fragment = selection.getRangeAt(0).cloneContents();
      fragment.querySelectorAll('.line-number').forEach(node => node.remove());
      event.clipboardData.setData('text/plain', fragment.textContent ?? '');
      event.preventDefault();
    }}>
    {rows.map((row, index) => <span className="source-line" key={index}>
      {mode === 'diff' && <span className="line-number" aria-hidden="true" data-line={row.oldLine ?? ''} title={row.oldLine === null ? '' : `Old line ${row.oldLine}`} />}
      <span className="line-number" aria-hidden="true" data-line={row.newLine ?? ''} title={row.newLine === null ? '' : `${mode === 'diff' ? 'New line' : 'Line'} ${row.newLine}`} />
      <span className={`line-content ${diffTone(row.text, mode === 'diff', mode === 'diff' && (row.oldLine !== null || row.newLine !== null))}`}>{row.text}{row.newline ? '\n' : ''}</span>
    </span>)}
  </pre></>;
}
