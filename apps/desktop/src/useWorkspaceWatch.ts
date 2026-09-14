import { useEffect, useRef, useState } from 'react';
import type { Backend } from './types';

export default function useWorkspaceWatch(backend: Pick<Backend, 'watch'>, id: string, busy: boolean, enabled: boolean, revision: string, refresh: () => void) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const pending = useRef(false);
  const [changes, setChanges] = useState(0);
  const [status, setStatus] = useState('Starting automatic refresh');

  useEffect(() => {
    let alive = true;
    let stop: (() => void) | undefined;
    pending.current = false;
    if (!id || !enabled) { setStatus('Automatic refresh paused'); return; }
    setStatus('Starting automatic refresh');
    const changed = () => { pending.current = true; setChanges(value => value + 1); };
    backend.watch(id, notice => {
      if (!alive) return;
      if (notice.error) setStatus(notice.error);
      else changed();
    }).then(release => {
      if (!alive) { release(); return; }
      stop = release;
      setStatus('Automatic refresh active');
      // Cover edits between initial scan startup and watcher registration.
      changed();
    }).catch(error => {
      if (alive) setStatus(error instanceof Error ? error.message : String(error));
    });
    return () => { alive = false; pending.current = false; stop?.(); };
  }, [backend, id, enabled, revision]);

  useEffect(() => {
    if (!id || !enabled || busy || !pending.current) return;
    const timer = setTimeout(() => { pending.current = false; refreshRef.current(); }, 250);
    return () => clearTimeout(timer);
  }, [changes, busy, id, enabled, revision]);
  return status;
}
