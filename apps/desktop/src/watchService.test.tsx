import { expect, it, vi } from 'vitest';
import { createWatchService } from './watchService';

function barrier() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it('cancels a reserved watch without launching discovery when its reply arrives late', async () => {
  const preparing = barrier();
  const entered = barrier();
  const prepare = vi.fn((_token: string) => { entered.resolve(); return preparing.promise; });
  const start = vi.fn(async () => {});
  const stop = vi.fn(async () => {});
  const watch = createWatchService({ prepare, start, stop });
  const abort = new AbortController();
  const result = watch('one', () => {}, abort.signal);
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await entered.promise;
  abort.abort();
  preparing.resolve();
  await rejected;
  expect(start).not.toHaveBeenCalled();
  expect(stop).toHaveBeenCalledExactlyOnceWith(prepare.mock.calls[0][0]);
});

it('stops during pending startup and lets the newest watch complete first', async () => {
  const oldStartup = barrier();
  const oldEntered = barrier();
  const callbacks: ((notice: { error: string | null }) => void)[] = [];
  const prepare = vi.fn(async (_token: string) => {});
  const start = vi.fn((id: string, _token: string, callback: typeof callbacks[number]) => {
    callbacks.push(callback);
    if (id === 'old') { oldEntered.resolve(); return oldStartup.promise; }
    return Promise.resolve();
  });
  const stop = vi.fn(async (_token: string) => {});
  const watch = createWatchService({ prepare, start, stop });
  const abort = new AbortController();
  const oldNotice = vi.fn();
  const old = watch('old', oldNotice, abort.signal);
  await oldEntered.promise;
  abort.abort();
  const newNotice = vi.fn();
  const newestStop = await watch('new', newNotice);
  expect(stop).toHaveBeenCalledExactlyOnceWith(start.mock.calls[0][1]);
  callbacks[0]({ error: 'late' });
  callbacks[1]({ error: null });
  expect(oldNotice).not.toHaveBeenCalled();
  expect(newNotice).toHaveBeenCalledOnce();
  oldStartup.resolve();
  (await old)();
  expect(stop).toHaveBeenCalledTimes(1);
  newestStop();
  expect(stop).toHaveBeenLastCalledWith(start.mock.calls[1][1]);
});

it('cleans failed startup without blocking later reservations', async () => {
  const prepare = vi.fn(async (_token: string) => {});
  const start = vi.fn(async (id: string) => { if (id === 'bad') throw new Error('fixture failure'); });
  const stop = vi.fn(async (_token: string) => {});
  const watch = createWatchService({ prepare, start, stop });
  await expect(watch('bad', () => {})).rejects.toThrow('fixture failure');
  const release = await watch('good', () => {});
  expect(stop).toHaveBeenCalledTimes(1);
  release();
  expect(stop).toHaveBeenCalledTimes(2);
});
