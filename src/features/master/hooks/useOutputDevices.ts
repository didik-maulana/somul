import { useCallback, useEffect } from 'react';

import { listOutputDevices, onDeviceChanged, setDefaultOutputDevice } from '@/lib/ipc';
import { useAudioStore } from '@/stores/audioStore';
import type { AudioDevice, DeviceId } from '@/types/ipc';

export interface OutputDevices {
  devices: AudioDevice[];
  selectDevice: (deviceId: DeviceId) => Promise<void>;
  refresh: () => void;
}

export const useOutputDevices = (): OutputDevices => {
  const devices = useAudioStore((state) => state.devices);
  const setDevices = useAudioStore((state) => state.setDevices);

  const refresh = useCallback(() => {
    void listOutputDevices().then(setDevices).catch(() => undefined);
  }, [setDevices]);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isCancelled = false;

    void onDeviceChanged((payload) => {
      setDevices(payload.devices);
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
  }, [setDevices]);

  const selectDevice = useCallback(
    async (deviceId: DeviceId) => {
      await setDefaultOutputDevice(deviceId);
      refresh();
    },
    [refresh],
  );

  return { devices, selectDevice, refresh };
};
