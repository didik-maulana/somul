import { useCallback, useEffect, useRef } from 'react';

/** Trailing debounce applied to the commit path. */
export const VOLUME_COMMIT_DEBOUNCE_MS = 50;

export interface VolumeCommit {
  /** Call on every slider move. Coalesces into one write per 50 ms. */
  change: (volume: number) => void;
  /** Call on pointer-up. Writes the pending value immediately — never dropped. */
  flush: (volume: number) => void;
}

/**
 * Debounces volume writes and guarantees a flush on release.
 *
 * A trailing debounce alone loses the final value when the user releases
 * inside the window, which leaves the backend a few percent off where the thumb visibly sits.
 * `flush` cancels the pending timer and writes synchronously, so the last position always wins.
 */
export const useVolumeCommit = (commit: (volume: number) => void): VolumeCommit => {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<number>(undefined);
  const commitRef = useRef(commit);

  // Kept in a ref so `change` and `flush` stay referentially stable across renders while still
  // calling the latest handler — a fresh identity every render would restart the debounce.
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  const cancel = useCallback(() => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const change = useCallback(
    (volume: number) => {
      pending.current = volume;
      cancel();

      timer.current = setTimeout(() => {
        timer.current = undefined;

        if (pending.current !== undefined) {
          commitRef.current(pending.current);
          pending.current = undefined;
        }
      }, VOLUME_COMMIT_DEBOUNCE_MS);
    },
    [cancel],
  );

  const flush = useCallback(
    (volume: number) => {
      cancel();
      pending.current = undefined;
      commitRef.current(volume);
    },
    [cancel],
  );

  return { change, flush };
};
