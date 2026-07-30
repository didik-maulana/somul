import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useVolumeCommit,
  VOLUME_COMMIT_DEBOUNCE_MS,
} from '@/features/mixer/hooks/useVolumeCommit';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useVolumeCommit', () => {
  it('debounces on the documented 50 ms window', () => {
    expect(VOLUME_COMMIT_DEBOUNCE_MS).toBe(50);
  });

  /** ARCHITECTURE.md §9: a drag produces one write per window, not one per pointer move. */
  it('coalesces a burst of moves into a single trailing write', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useVolumeCommit(commit));

    act(() => {
      result.current.change(0.1);
      result.current.change(0.2);
      result.current.change(0.3);
    });

    expect(commit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(VOLUME_COMMIT_DEBOUNCE_MS);
    });

    expect(commit).toHaveBeenCalledExactlyOnceWith(0.3);
  });

  it('writes nothing before the window elapses', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useVolumeCommit(commit));

    act(() => {
      result.current.change(0.4);
      vi.advanceTimersByTime(VOLUME_COMMIT_DEBOUNCE_MS - 1);
    });

    expect(commit).not.toHaveBeenCalled();
  });

  /**
   * §9: the flush is guaranteed. Releasing inside the debounce window must not lose the final
   * value — otherwise the backend settles a few percent off where the thumb visibly sits.
   */
  it('flushes immediately on pointer-up', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useVolumeCommit(commit));

    act(() => {
      result.current.change(0.4);
      result.current.flush(0.42);
    });

    expect(commit).toHaveBeenCalledExactlyOnceWith(0.42);
  });

  it('does not double-write after a flush', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useVolumeCommit(commit));

    act(() => {
      result.current.change(0.4);
      result.current.flush(0.42);
      vi.advanceTimersByTime(VOLUME_COMMIT_DEBOUNCE_MS * 4);
    });

    expect(commit).toHaveBeenCalledExactlyOnceWith(0.42);
  });

  it('starts a fresh window after a flush', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useVolumeCommit(commit));

    act(() => {
      result.current.flush(0.42);
      result.current.change(0.6);
      vi.advanceTimersByTime(VOLUME_COMMIT_DEBOUNCE_MS);
    });

    expect(commit).toHaveBeenNthCalledWith(1, 0.42);
    expect(commit).toHaveBeenNthCalledWith(2, 0.6);
  });

  it('drops a pending write when the component unmounts', () => {
    const commit = vi.fn();
    const { result, unmount } = renderHook(() => useVolumeCommit(commit));

    act(() => {
      result.current.change(0.4);
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(VOLUME_COMMIT_DEBOUNCE_MS * 4);
    });

    expect(commit).not.toHaveBeenCalled();
  });

  it('always uses the latest commit function', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ commit }) => useVolumeCommit(commit), {
      initialProps: { commit: first },
    });

    act(() => {
      result.current.change(0.4);
    });

    rerender({ commit: second });

    act(() => {
      vi.advanceTimersByTime(VOLUME_COMMIT_DEBOUNCE_MS);
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith(0.4);
  });
});
