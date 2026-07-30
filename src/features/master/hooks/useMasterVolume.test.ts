import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMasterVolume } from '@/features/master/hooks/useMasterVolume';
import { useAudioStore } from '@/stores/audioStore';
import type { DeviceId, MasterState, SessionId } from '@/types/ipc';

const master = (volume: number): MasterState => ({
  deviceId: 'mock:speakers' as DeviceId,
  deviceName: 'Built-in Speakers',
  volume,
  isMuted: false,
});

let resyncListeners: ((master: MasterState) => void)[] = [];
let changeListeners: ((master: MasterState) => void)[] = [];

vi.mock('@/lib/ipc', () => ({
  getMasterState: () => Promise.resolve<MasterState>({
    deviceId: 'mock:speakers' as DeviceId,
    deviceName: 'Built-in Speakers',
    volume: 0.2,
    isMuted: false,
  }),
  onMasterChanged: (fn: (m: MasterState) => void) => {
    changeListeners.push(fn);
    return Promise.resolve(() => undefined);
  },
  onMasterResync: (fn: (m: MasterState) => void) => {
    resyncListeners.push(fn);
    return Promise.resolve(() => undefined);
  },
  setMasterVolume: () => Promise.resolve(),
  setMasterMute: () => Promise.resolve(),
}));

beforeEach(() => {
  resyncListeners = [];
  changeListeners = [];
  useAudioStore.setState({
    sessions: [],
    devices: [],
    master: null,
    capabilities: null,
    draggingSessionIds: new Set<SessionId>(),
    isDraggingMaster: false,
  });
});

describe('useMasterVolume resync', () => {
  /**
   * Panel shows 20%, closes; the user raises the system volume to 40%; the panel reopens. The
   * slider must already read 40% rather than travelling there in front of the user.
   */
  it('snaps to the system volume when the panel reopens', async () => {
    const { result } = renderHook(() => useMasterVolume());

    await waitFor(() => {
      expect(result.current.master?.volume).toBe(0.2);
    });

    act(() => {
      for (const listener of resyncListeners) {
        listener(master(0.4));
      }
    });

    expect(result.current.master?.volume).toBe(0.4);
    expect(result.current.isResyncing).toBe(true);
  });

  it('goes back to easing on the frame after the resync', async () => {
    const { result } = renderHook(() => useMasterVolume());

    await waitFor(() => {
      expect(result.current.master).not.toBeNull();
    });

    act(() => {
      for (const listener of resyncListeners) {
        listener(master(0.4));
      }
    });
    expect(result.current.isResyncing).toBe(true);

    await waitFor(() => {
      expect(result.current.isResyncing).toBe(false);
    });
  });

  /** A change while the panel is open is motion, not a correction — it must stay eased. */
  it('never marks an ordinary change as a resync', async () => {
    const { result } = renderHook(() => useMasterVolume());

    await waitFor(() => {
      expect(result.current.master).not.toBeNull();
    });

    act(() => {
      for (const listener of changeListeners) {
        listener(master(0.55));
      }
    });

    expect(result.current.master?.volume).toBe(0.55);
    expect(result.current.isResyncing).toBe(false);
  });
});
