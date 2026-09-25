import type { Backend } from './types';

type Notice = { error: string | null };
interface Transport {
  prepare(token: string): Promise<void>;
  start(id: string, token: string, onChange: (notice: Notice) => void): Promise<void>;
  stop(token: string): Promise<void>;
}

export function createWatchService(transport: Transport): Backend['watch'] {
  // Order only the short reservation handshake; an obsolete startup cannot block its successor.
  let reservation = Promise.resolve();
  return async (id, onChange, signal) => {
    const token = crypto.randomUUID();
    let stopped = signal?.aborted ?? false;
    let prepared = false;
    let stopSent = false;
    const stop = () => {
      stopped = true;
      signal?.removeEventListener('abort', stop);
      if (prepared && !stopSent) {
        stopSent = true;
        void transport.stop(token).catch(() => {});
      }
    };
    signal?.addEventListener('abort', stop, { once: true });
    const ready = reservation.then(async () => {
      if (stopped) return;
      await transport.prepare(token);
      prepared = true;
      if (stopped) stop();
    });
    reservation = ready.catch(() => {});
    try {
      await ready;
      if (stopped) {
        stop();
        throw new DOMException('Watch cancelled', 'AbortError');
      }
      await transport.start(id, token, notice => { if (!stopped) onChange(notice); });
      if (stopped) stop();
      return stop;
    } catch (error) {
      stop();
      // Also clean an ambiguous failed reservation response using its exact token.
      if (!prepared) void transport.stop(token).catch(() => {});
      throw error;
    }
  };
}
