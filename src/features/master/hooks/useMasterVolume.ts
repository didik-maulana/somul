import { useCallback, useEffect, useState } from 'react';

import {
  getMasterState,
  onMasterChanged,
  onMasterResync,
  setMasterMute,
  setMasterVolume,
} from '@/lib/ipc';
import { useAudioStore } from '@/stores/audioStore';
import type { MasterState } from '@/types/ipc';

export interface MasterVolume {
  master: MasterState | null;
  /** True for the single frame that applies a resync, so the slider snaps instead of easing. */
  isResyncing: boolean;
  changeVolume: (volume: number) => void;
  commitVolume: (volume: number) => Promise<void>;
  toggleMute: () => Promise<void>;
}

/** Master volume works on every platform, so this hook is never capability-gated. */
export const useMasterVolume = (): MasterVolume => {
  const master = useAudioStore((state) => state.master);
  const setMaster = useAudioStore((state) => state.setMaster);
  const setMasterVolumeLocally = useAudioStore((state) => state.setMasterVolume);
  const startDraggingMaster = useAudioStore((state) => state.startDraggingMaster);
  const stopDraggingMaster = useAudioStore((state) => state.stopDraggingMaster);
  const [isResyncing, setIsResyncing] = useState(false);

  useEffect(() => {
    void getMasterState().then(setMaster).catch(() => undefined);
  }, [setMaster]);

  // A resync means the panel just opened and the value may have moved while it was closed.
  // Easing into it would animate the slider across the gap, which reads as Somul changing the
  // volume rather than reporting it, so the flag suppresses the transition for one frame.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isCancelled = false;

    void onMasterResync((incoming) => {
      setIsResyncing(true);
      setMaster(incoming);
    }).then((stop) => {
      if (isCancelled) {
        stop();
        return;
      }

      unlisten = stop;
    });

    return () => {
      isCancelled = true;
      unlisten?.();
    };
  }, [setMaster]);

  useEffect(() => {
    if (!isResyncing) {
      return;
    }

    // Cleared on the next frame: by then the snapped value has painted, and later changes should
    // ease again.
    const frame = requestAnimationFrame(() => {
      setIsResyncing(false);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [isResyncing]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isCancelled = false;

    void onMasterChanged(setMaster).then((stop) => {
      if (isCancelled) {
        stop();
        return;
      }

      unlisten = stop;
    });

    return () => {
      isCancelled = true;
      unlisten?.();
    };
  }, [setMaster]);

  /**
   * Optimistic and authoritative while the pointer is down. Marking the drag stops the backend's
   * polled `master-changed` events from overwriting the value being held.
   */
  const changeVolume = useCallback(
    (volume: number) => {
      startDraggingMaster();
      setMasterVolumeLocally(volume);
    },
    [setMasterVolumeLocally, startDraggingMaster],
  );

  const commitVolume = useCallback(
    async (volume: number) => {
      setMasterVolumeLocally(volume);

      try {
        await setMasterVolume(volume);
      } finally {
        // Released even if the write failed, or the slider would stay frozen to the last
        // dragged value and never resync with the system.
        stopDraggingMaster();
      }
    },
    [setMasterVolumeLocally, stopDraggingMaster],
  );

  const toggleMute = useCallback(async () => {
    if (!master) {
      return;
    }

    await setMasterMute(!master.isMuted);
  }, [master]);

  return { master, isResyncing, changeVolume, commitVolume, toggleMute };
};
