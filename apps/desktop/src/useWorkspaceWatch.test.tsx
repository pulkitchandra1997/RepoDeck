import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import useWorkspaceWatch from './useWorkspaceWatch';
import type { Backend } from './types';
afterEach(() => { cleanup(); vi.useRealTimers(); });

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
