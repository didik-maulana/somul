import { useEffect } from 'react';

import { publishPeaks } from '@/features/mixer/lib/meterEngine';
import { onPeaks } from '@/lib/ipc';

/**
 * Feeds the meter engine and nothing else.
 *
 * Returns no value on purpose. A hook that handed peaks back would put them in a render, which is
 * the one place a 30 Hz stream must never reach — rows subscribe to the engine individually and
 * paint themselves.
 */
export const usePeakMeters = (isEnabled: boolean): void => {
  useEffect(() => {
    if (!isEnabled) {
      return;
    }

    let unlisten: (() => void) | undefined;
    let isCancelled = false;

    void onPeaks(publishPeaks)
      .then((stop) => {
        if (isCancelled) {
          stop();
          return;
        }

        unlisten = stop;
      })
      .catch(() => undefined);

    return () => {
      isCancelled = true;
      unlisten?.();
    };
  }, [isEnabled]);
};
