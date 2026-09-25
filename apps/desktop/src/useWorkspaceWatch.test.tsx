import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import useWorkspaceWatch from './useWorkspaceWatch';
import type { Backend } from './types';
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('aborts pending startup on pause and ignores its late completion and notice', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let signal: AbortSignal | undefined;
  let finish!: (stop: () => void) => void;
  let emit!: (notice: { error: string | null }) => void;
  const watch = vi.fn((_id: string, callback: typeof emit, cancellation?: AbortSignal) => {
    signal = cancellation;
    emit = callback;
    return new Promise<() => void>(resolve => { finish = resolve; });
  });
  const refresh = vi.fn();
  const stop = vi.fn();
  const api = { watch };
  const { result, rerender } = renderHook(({ enabled }) => useWorkspaceWatch(api, 'one', false, enabled, '', refresh), { initialProps: { enabled: true } });
  rerender({ enabled: false });
  expect(signal?.aborted).toBe(true);
  await act(async () => { emit({ error: 'obsolete failure' }); finish(stop); });
  act(() => vi.advanceTimersByTime(1000));
  expect(stop).toHaveBeenCalledOnce();
  expect(refresh).not.toHaveBeenCalled();
  expect(result.current).toBe('Automatic refresh paused');
});

it('aborts only the superseded startup when switching workspaces', async () => {
  const requests: { signal?: AbortSignal; finish: (stop: () => void) => void }[] = [];
  const watch = vi.fn((_id: string, _callback: (notice: { error: string | null }) => void, signal?: AbortSignal) => new Promise<() => void>(finish => { requests.push({ signal, finish }); }));
  const api = { watch };
  const { rerender, unmount } = renderHook(({ id }) => useWorkspaceWatch(api, id, true, true, '', () => {}), { initialProps: { id: 'one' } });
  rerender({ id: 'two' });
  expect(requests[0].signal?.aborted).toBe(true);
  expect(requests[1].signal?.aborted).toBe(false);
  const oldStop = vi.fn();
  const newestStop = vi.fn();
  await act(async () => { requests[1].finish(newestStop); requests[0].finish(oldStop); });
  expect(oldStop).toHaveBeenCalledOnce();
  expect(newestStop).not.toHaveBeenCalled();
  unmount();
  expect(newestStop).toHaveBeenCalledOnce();
});

it('replaces registrations only when repository discovery or scan settings change', async () => {
  const stop = vi.fn();
  const watch = vi.fn(async () => stop);
  const api = { watch };
  const { rerender } = renderHook(({ revision }) => useWorkspaceWatch(api, 'one', true, true, revision, () => {}), {
    initialProps: { revision: 'one-repository' },
  });
  await act(async () => {});
  rerender({ revision: 'one-repository' });
  expect(watch).toHaveBeenCalledTimes(1);
  rerender({ revision: 'two-repositories' });
  await act(async () => {});
  expect(stop).toHaveBeenCalledTimes(1);
  expect(watch).toHaveBeenCalledTimes(2);
});

it('coalesces changes and retains pending updates while a scan is busy', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let emit: (notice: { error: string | null }) => void = () => {};
  const api: Pick<Backend, 'watch'> = { watch: async (_id, callback) => { emit = callback; return () => {}; } };
  const refresh = vi.fn();
  const { rerender } = renderHook(({ busy }) => useWorkspaceWatch(api, 'one', busy, true, '', refresh), { initialProps: { busy: true } });
  await act(async () => {});
  act(() => { emit({ error: null }); emit({ error: null }); vi.advanceTimersByTime(1000); });
  expect(refresh).not.toHaveBeenCalled();
  rerender({ busy: false });
  act(() => vi.advanceTimersByTime(250));
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() => { emit({ error: null }); emit({ error: null }); });
  act(() => vi.advanceTimersByTime(250));
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('cleans up late watch registration and does not refresh after unmount', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let finish: (stop: () => void) => void = () => {};
  const stop = vi.fn();
  const refresh = vi.fn();
  const api: Pick<Backend, 'watch'> = { watch: () => new Promise(resolve => { finish = resolve; }) };
  const { unmount } = renderHook(() => useWorkspaceWatch(api, 'one', false, true, '', refresh));
  unmount();
  await act(async () => finish(stop));
  act(() => vi.advanceTimersByTime(1000));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
});

it('reports watch failures and stops the watcher when paused', async () => {
  const stop = vi.fn();
  let emit: (notice: { error: string | null }) => void = () => {};
  const api: Pick<Backend, 'watch'> = { watch: async (_id, callback) => { emit = callback; return stop; } };
  const { result, rerender } = renderHook(({ enabled }) => useWorkspaceWatch(api, 'one', true, enabled, '', () => {}), { initialProps: { enabled: true } });
  await act(async () => {});
  act(() => emit({ error: 'Watch failed' }));
  expect(result.current).toBe('Watch failed');
  rerender({ enabled: false });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(result.current).toBe('Automatic refresh paused');
});
