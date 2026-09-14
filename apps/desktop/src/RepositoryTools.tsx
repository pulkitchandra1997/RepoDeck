import type { Backend } from './types';
import './repository-tools.css';
import { useState } from 'react';
import { Settings2, Search, Workflow } from 'lucide-react';
export default function RepositoryTools({ backend, id, repository }: { backend: Pick<Backend, 'gitConfig' | 'ignoreRule' | 'gitFeatures'>; id: string; repository: string }) {
  const [config, setConfig] = useState<Awaited<ReturnType<Backend['gitConfig']>> | null>(null);
  const [rule, setRule] = useState<Awaited<ReturnType<Backend['ignoreRule']>> | undefined>(undefined);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [features, setFeatures] = useState<Awaited<ReturnType<Backend['gitFeatures']>> | null>(null);
  async function loadFeatures() {
    if (features) { setFeatures(null); return; }
    setBusy(true); setError('');
    try { setFeatures(await backend.gitFeatures(id, repository)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function load() {
    if (config) { setConfig(null); return; }
    setBusy(true); setError('');
    try { setConfig(await backend.gitConfig(id, repository)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function check() {
    setBusy(true); setError(''); setRule(undefined);
    try { setRule(await backend.ignoreRule(id, repository, path)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div className="repository-tools">
    <button disabled={busy} aria-expanded={config !== null} onClick={load}><Settings2 size={15} />Git configuration</button>
    <button disabled={busy} aria-expanded={features !== null} onClick={loadFeatures}><Workflow size={15} />Hooks and LFS</button>
    {features && <div className="git-config">
      <h3>Hook files</h3>
      {features.hooks.length ? <ul>{features.hooks.map(hook => <li key={hook}>{hook}</li>)}</ul> : <p>No hook files found.</p>}
      <p>{features.lfsConfigured ? 'LFS filter configured' : 'No LFS filter configured'}</p>
      <h3>LFS attribute declarations</h3>
      {features.lfsAttributes.length ? <ul>{features.lfsAttributes.map(path => <li key={path}>{path}</li>)}</ul> : <p>No declarations found.</p>}
      {features.warnings.map((warning, index) => <p className="amber" key={index}>{warning}</p>)}
    </div>}
    {config && <dl className="git-config">{config.map((entry, index) => <div key={index}><dt>{entry.key}</dt><dd>{entry.value}</dd></div>)}</dl>}
    <form onSubmit={event => { event.preventDefault(); if (path && !busy) void check(); }}>
      <input aria-label="Repository-relative path" placeholder="Path to check ignore rule" value={path} disabled={busy} onChange={event => { setPath(event.target.value); setRule(undefined); }} />
      <button disabled={busy || !path} aria-label="Check ignore rule" title="Check ignore rule"><Search size={15} /></button>
    </form>
    {error && <p role="alert" className="danger">{error}</p>}
    {rule === null && <p role="status">No ignore rule matched.</p>}
    {rule && <div className="ignore-result"><span>{rule.source}:{rule.line}</span><code>{rule.pattern}</code></div>}
  </div>;
}
