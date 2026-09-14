import { useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import type { Backend } from './types';
import './remote-link.css';

export default function RemoteLink({ backend, remote }: { backend: Pick<Backend, 'remoteTarget' | 'openRemote'>; remote: string }) {
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function prepare() {
    setBusy(true); setError('');
    try { setTarget(await backend.remoteTarget(remote)); }
    catch (e) { setTarget(''); setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function open() {
    if (!target || busy) return;
    setBusy(true); setError('');
    try { await backend.openRemote(target); setTarget(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div className="remote-link">
    <div className="remote-address"><span className="remote">{remote}</span><button type="button" title="Open remote in browser" aria-label="Open remote in browser" disabled={busy} onClick={prepare}><ExternalLink size={15} /></button></div>
    {target !== null && <form onSubmit={event => { event.preventDefault(); void open(); }}>
      <label>Browser URL<input type="url" value={target} onChange={event => setTarget(event.target.value)} disabled={busy} required /></label>
      <div className="remote-actions"><button type="submit" disabled={busy || !target} aria-label="Open confirmed URL"><ExternalLink size={15} />Open</button><button type="button" title="Cancel opening remote" aria-label="Cancel opening remote" disabled={busy} onClick={() => { setTarget(null); setError(''); }}><X size={15} /></button></div>
    </form>}
    {error && <p role="alert" className="danger">{error}</p>}
  </div>;
}
