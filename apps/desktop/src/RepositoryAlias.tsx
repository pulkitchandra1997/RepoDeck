import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, RotateCcw, X } from 'lucide-react';
import useConfirmation from './useConfirmation';

export default function RepositoryAlias({ alias, draft, onDraftChange, onSave, disabled = false }: {
  alias: string;
  draft: string | undefined;
  onDraftChange: (value: string | undefined) => void;
  onSave: (value: string) => Promise<void>;
  disabled?: boolean;
}) {
  const editing = draft !== undefined;
  const value = draft ?? alias;
  const [busy, setBusy] = useState(false);
  const locked = busy || disabled;
  const [error, setError] = useState('');
  const { confirm, confirmation } = useConfirmation();
  const opener = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) opener.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  async function cancel() {
    if (locked) return;
    if (value !== alias && !await confirm({ title: 'Discard custom name?', description: 'This name has not been saved. The current repository identifier stays unchanged.', action: 'Discard changes' })) return;
    onDraftChange(undefined); setError('');
  }
  if (!editing) return <button ref={opener} disabled={disabled} className="alias-edit" title="Edit custom name" aria-label="Edit custom name" onClick={() => onDraftChange(alias)}><Pencil size={14} />Custom name</button>;
  return <form className="alias-form" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); void cancel(); } }} onSubmit={async event => {
    event.preventDefault();
    if (locked) return;
    const name = value.trim();
    if ([...name].length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(name)) { setError('Use at most 80 characters without control characters.'); return; }
    setBusy(true); setError('');
    try { await onSave(name); onDraftChange(undefined); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  }}>
    {confirmation}
    <label>Custom name<input autoFocus disabled={locked} value={value} onChange={event => onDraftChange(event.target.value)} placeholder="Default repository name" /></label>
    <button type="button" disabled={locked} title="Cancel custom name" aria-label="Cancel custom name" onClick={() => void cancel()}><X size={16} /></button>
    <button type="button" disabled={locked || !value} title="Restore default name" aria-label="Restore default name" onClick={() => onDraftChange('')}><RotateCcw size={16} /></button>
    <button disabled={locked} title="Save custom name" aria-label="Save custom name"><Check size={16} /></button>
    {error && <p role="alert" className="danger">{error}</p>}
  </form>;
}
