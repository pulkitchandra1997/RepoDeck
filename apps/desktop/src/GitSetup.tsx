import { useEffect, useState, type ReactNode } from 'react';
import { Download, GitBranch, RefreshCw } from 'lucide-react';
import useConfirmation from './useConfirmation';

export interface GitAvailability { available: boolean; platform: string; message: string }
export default function GitSetup({ check, install, children }: {
  check: () => Promise<GitAvailability>; install: () => Promise<string>; children: ReactNode;
}) {
  const { confirm, confirmation } = useConfirmation();
  const [status, setStatus] = useState<GitAvailability | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filesOnly, setFilesOnly] = useState(false);
  useEffect(() => {
    let active = true;
    check().then(value => { if (active) setStatus(value); }).catch(reason => {
      if (active) setError(String(reason));
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [check]);
  async function recheck() {
    setBusy(true); setError(''); setNotice('');
    try { setStatus(await check()); } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  async function requestInstall() {
    if (!await confirm({ title: status?.platform === 'macos' ? 'Install Apple developer tools?' : 'Open Git download?', description: status?.platform === 'macos' ? 'This requests Apple Command Line Tools, including Git. A download and system installation may be required. Complete the macOS approval and license prompts yourself, then check Git again.' : 'Your browser will open the official Git for Windows download page. Installing Git is a separate system change that you approve in its installer.', action: status?.platform === 'macos' ? 'Request installation' : 'Open download page' })) return;
    setBusy(true); setError('');
    try { setNotice(await install()); } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  if (status?.available || filesOnly) return children;
  return <main className="startup" aria-label="Git setup" aria-busy={busy}>
    {confirmation}
    <GitBranch size={28} />
    <h1>Git setup</h1>
    <p>{status?.message ?? (busy ? 'Checking Git installation...' : 'Git could not be checked.')}</p>
    {status?.platform === 'macos' ? <p>Install Apple's Command Line Tools, including Git. macOS will ask you to approve the installation and license.</p>
      : <p>Install Git for Windows, then check again. Internet access may be required.</p>}
    {error && <p role="alert" className="danger">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="startup-actions">
      <button disabled={busy || !status} onClick={() => void requestInstall()}><Download size={16} />{status?.platform === 'macos' ? 'Install Command Line Tools' : 'Open Git download'}</button>
      <button disabled={busy} onClick={() => void recheck()}><RefreshCw size={16} />Check again</button>
      <button disabled={busy} onClick={() => setFilesOnly(true)}>Continue with files</button>
    </div>
  </main>;
}
