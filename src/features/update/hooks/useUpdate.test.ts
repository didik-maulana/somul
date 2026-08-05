import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUpdate } from '@/features/update/hooks/useUpdate';
import type { UpdateSnapshot } from '@/types/ipc';

interface Progress {
  downloaded: number;
  total: number | null;
}

const {
  getUpdateStateSpy,
  checkForUpdateSpy,
  installUpdateSpy,
  relaunchAppSpy,
  openUpdateWindowSpy,
  onUpdateChangedSpy,
  onUpdateProgressSpy,
  emitChanged,
  emitProgress,
} = vi.hoisted(() => {
  const changedListeners = new Set<(snapshot: never) => void>();
  const progressListeners = new Set<(progress: never) => void>();

  const subscribe = <TPayload>(listeners: Set<(payload: TPayload) => void>) =>
    vi.fn((listener: (payload: TPayload) => void) => {
      listeners.add(listener);

      return Promise.resolve(() => {
        listeners.delete(listener);
      });
    });

  return {
    getUpdateStateSpy: vi.fn(),
    checkForUpdateSpy: vi.fn(),
    installUpdateSpy: vi.fn(),
    relaunchAppSpy: vi.fn(),
    openUpdateWindowSpy: vi.fn(),
    onUpdateChangedSpy: subscribe(changedListeners),
    onUpdateProgressSpy: subscribe(progressListeners),
    emitChanged: (snapshot: unknown) => {
      changedListeners.forEach((listener) => {
        (listener as (payload: unknown) => void)(snapshot);
      });
    },
    emitProgress: (progress: Progress) => {
      progressListeners.forEach((listener) => {
        (listener as (payload: Progress) => void)(progress);
      });
    },
  };
});

vi.mock('@/lib/ipc', () => ({
  getUpdateState: getUpdateStateSpy,
  checkForUpdate: checkForUpdateSpy,
  installUpdate: installUpdateSpy,
  relaunchApp: relaunchAppSpy,
  openUpdateWindow: openUpdateWindowSpy,
  onUpdateChanged: onUpdateChangedSpy,
  onUpdateProgress: onUpdateProgressSpy,
}));

const upToDate: UpdateSnapshot = {
  phase: 'upToDate',
  currentVersion: '1.0.0',
  availableVersion: null,
  notes: null,
};

const newRelease: UpdateSnapshot = {
  phase: 'available',
  currentVersion: '1.0.0',
  availableVersion: '1.1.0',
  notes: '## Mixer\n- Fixes the meter',
};

beforeEach(() => {
  getUpdateStateSpy.mockReset().mockResolvedValue(upToDate);
  checkForUpdateSpy.mockReset().mockResolvedValue(upToDate);
  installUpdateSpy.mockReset().mockResolvedValue(undefined);
  relaunchAppSpy.mockReset().mockResolvedValue(undefined);
  openUpdateWindowSpy.mockReset().mockResolvedValue(undefined);
});

const renderUpdate = () => renderHook(() => useUpdate({ checksOnMount: true }));

describe('useUpdate', () => {
  /** A user who has to know to go looking for updates mostly does not. */
  it('checks once on its own, without being asked', async () => {
    const { result } = renderUpdate();

    await waitFor(() => {
      expect(result.current.status.phase).toBe('upToDate');
    });

    expect(checkForUpdateSpy).toHaveBeenCalled();
    expect(result.current.status.currentVersion).toBe('1.0.0');
    expect(result.current.isNoticeVisible).toBe(false);
  });

  /**
   * The release-notes window is opened *from* a result. Checking again on the way in would
   * replace what it was opened to show.
   */
  it('checks nothing on mount unless asked to', async () => {
    const { result } = renderHook(() => useUpdate());

    await waitFor(() => {
      expect(result.current.status.phase).toBe('upToDate');
    });

    expect(checkForUpdateSpy).not.toHaveBeenCalled();
  });

  /**
   * The launch check answers in milliseconds, so announcing it means a spinner that is already
   * gone by the time anyone reads it.
   */
  it('keeps the launch check silent', () => {
    const { result } = renderUpdate();

    expect(result.current.status.phase).toBe('idle');
  });

  /** A requested check has to be visible for long enough to read as an answer. */
  it('holds a requested check on screen even when the endpoint answers instantly', async () => {
    const { result } = renderUpdate();

    await waitFor(() => {
      expect(result.current.status.phase).toBe('upToDate');
    });

    act(() => {
      result.current.check();
    });

    expect(result.current.status.phase).toBe('checking');

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(result.current.status.phase).toBe('checking');

    await waitFor(
      () => {
        expect(result.current.status.phase).toBe('upToDate');
      },
      { timeout: 2000 },
    );
  });

  it('raises the notice when the endpoint announces a newer build', async () => {
    checkForUpdateSpy.mockResolvedValue(newRelease);

    const { result } = renderUpdate();

    await waitFor(() => {
      expect(result.current.status.phase).toBe('available');
    });

    expect(result.current.status.availableVersion).toBe('1.1.0');
    expect(result.current.status.notes).toContain('Fixes the meter');
    expect(result.current.isNoticeVisible).toBe(true);
  });

  /**
   * The panel and the release-notes window are separate WebViews. Whichever one installs, both
   * have to move, or the other keeps offering an install that already happened.
   */
  it('follows the phase announced by the backend', async () => {
    const { result } = renderUpdate();

    await waitFor(() => {
      expect(onUpdateChangedSpy).toHaveBeenCalled();
    });

    act(() => {
      emitChanged({ ...newRelease, phase: 'installed' });
    });

    expect(result.current.status.phase).toBe('installed');
    expect(result.current.isNoticeVisible).toBe(true);
  });

  it('keeps a dismissed notice down without forgetting the update itself', async () => {
    checkForUpdateSpy.mockResolvedValue(newRelease);

    const { result } = renderUpdate();

    await waitFor(() => {
      expect(result.current.isNoticeVisible).toBe(true);
    });

    act(() => {
      result.current.dismissNotice();
    });

    expect(result.current.isNoticeVisible).toBe(false);
    expect(result.current.status.availableVersion).toBe('1.1.0');
  });

  /** Nothing is installed until the user presses the button — an update replaces the app. */
  it('installs nothing on its own', async () => {
    checkForUpdateSpy.mockResolvedValue(newRelease);

    const { result } = renderUpdate();

    await waitFor(() => {
      expect(result.current.status.phase).toBe('available');
    });

    expect(installUpdateSpy).not.toHaveBeenCalled();

    act(() => {
      result.current.install();
    });

    expect(installUpdateSpy).toHaveBeenCalledOnce();
  });

  /** Downloading is not the same as running the new build. */
  it('restarts only when asked', async () => {
    const { result } = renderUpdate();

    await waitFor(() => {
      expect(onUpdateChangedSpy).toHaveBeenCalled();
    });

    act(() => {
      emitChanged({ ...newRelease, phase: 'installed' });
    });

    expect(relaunchAppSpy).not.toHaveBeenCalled();

    act(() => {
      result.current.restart();
    });

    expect(relaunchAppSpy).toHaveBeenCalledOnce();
  });

  it('opens the release notes in their own window', async () => {
    const { result } = renderUpdate();

    act(() => {
      result.current.showNotes();
    });

    await waitFor(() => {
      expect(openUpdateWindowSpy).toHaveBeenCalledOnce();
    });
  });

  it('follows the download as the backend reports it', async () => {
    const { result } = renderUpdate();

    await waitFor(() => {
      expect(onUpdateProgressSpy).toHaveBeenCalled();
    });

    act(() => {
      emitProgress({ downloaded: 2_500_000, total: 5_000_000 });
    });

    expect(result.current.status.downloadFraction).toBe(0.5);
  });

  /** No length means no position to report — the UI shows an indeterminate bar instead. */
  it('reports no fraction for a download of unknown size', async () => {
    const { result } = renderUpdate();

    await waitFor(() => {
      expect(onUpdateProgressSpy).toHaveBeenCalled();
    });

    act(() => {
      emitProgress({ downloaded: 2_500_000, total: null });
    });

    expect(result.current.status.downloadFraction).toBeNull();
  });

  /** A failed check must not read as "you are up to date" — that is a lie about a stale build. */
  it('reports an unreachable endpoint as a failure', async () => {
    getUpdateStateSpy.mockResolvedValue({ ...upToDate, phase: 'idle' });
    checkForUpdateSpy.mockRejectedValue(new Error('offline'));

    const { result } = renderUpdate();

    await waitFor(() => {
      expect(onUpdateChangedSpy).toHaveBeenCalled();
    });

    // Rust publishes the failure; the window renders what it is told.
    act(() => {
      emitChanged({ ...upToDate, phase: 'failed' });
    });

    expect(result.current.status.phase).toBe('failed');
    expect(result.current.isNoticeVisible).toBe(false);
  });
});
