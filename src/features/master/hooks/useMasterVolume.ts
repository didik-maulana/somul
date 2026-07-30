import { useCallback, useEffect } from 'react';

import { getMasterState, onMasterChanged, setMasterMute, setMasterVolume } from '@/lib/ipc';
import { useAudioStore } from '@/stores/audioStore';
import type { MasterState } from '@/types/ipc';

export interface MasterVolume {
  master: MasterState | null;
  changeVolume: (volume: number) => void;
  commitVolume: (volume: number) => Promise<void>;
  toggleMute: () => Promise<void>;
}

/** Master volume works on every platform, so this hook is never capability-gated. */
export const useMasterVolume = (): MasterVolume => {
  const master = useAudioStore((state) => state.master);
  const setMaster = useAudioStore((state) => state.setMaster);

  useEffect(() => {
    void getMasterState().then(setMaster).catch(() => undefined);
  }, [setMaster]);

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

  const changeVolume = useCallback(
    (volume: number) => {
      if (master) {
        setMaster({ ...master, volume });
      }
    },
    [master, setMaster],
  );

  const commitVolume = useCallback(async (volume: number) => {
    await setMasterVolume(volume);
  }, []);

  const toggleMute = useCallback(async () => {
    if (!master) {
      return;
    }

    await setMasterMute(!master.isMuted);
  }, [master]);

  return { master, changeVolume, commitVolume, toggleMute };
};
