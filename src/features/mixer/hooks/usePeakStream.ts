import { useCallback, useEffect, useRef } from 'react';

import { decayPeak, meterBand, type MeterBand } from '@/lib/audio';
import { onPeaks } from '@/lib/ipc';
import type { SessionId, SessionPeak } from '@/types/ipc';

/**
 * ONE requestAnimationFrame loop for the whole panel.
 *
 * Peaks arrive at 30 Hz and must never reach Zustand or
 * React state. A store write per frame would re-render every subscriber 30 times a second, and
 * the panel would miss the 60 fps budget with a dozen rows open. Levels live in refs; the loop
 * writes `transform: scaleX()` straight to registered elements.
 *
 * The loop is also what interpolates: Rust emits at 30 Hz, the UI decays between frames so the
 * fall reads smoothly at 60 fps.
 */
export interface PeakStream {
  /** Registers a bar element. Returns an unregister function for cleanup. */
  register: (sessionId: SessionId, element: HTMLElement | null) => () => void;
}

interface BarRegistration {
  element: HTMLElement;
  band: MeterBand | null;
}

export const usePeakStream = (): PeakStream => {
  const incoming = useRef(new Map<SessionId, number>());
  const displayed = useRef(new Map<SessionId, number>());
  const bars = useRef(new Map<SessionId, BarRegistration>());

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isCancelled = false;

    void onPeaks((peaks: SessionPeak[]) => {
      for (const peak of peaks) {
        incoming.current.set(peak.sessionId, peak.peak);
      }
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
  }, []);

  useEffect(() => {
    let frame = 0;
    let previousTimestamp: number | undefined;

    const paint = (timestamp: number) => {
      const elapsedMs = previousTimestamp === undefined ? 0 : timestamp - previousTimestamp;
      previousTimestamp = timestamp;

      for (const [sessionId, registration] of bars.current) {
        const target = incoming.current.get(sessionId) ?? 0;
        const level = decayPeak(displayed.current.get(sessionId) ?? 0, target, elapsedMs);

        displayed.current.set(sessionId, level);

        // scaleX only. Animating width would trigger layout every frame, and a CSS transition
        // here would smear the signal.
        registration.element.style.transform = `scaleX(${level.toString()})`;

        const band = meterBand(level);

        if (band !== registration.band) {
          registration.band = band;
          registration.element.dataset.band = band;
        }
      }

      frame = requestAnimationFrame(paint);
    };

    frame = requestAnimationFrame(paint);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);

  const register = useCallback((sessionId: SessionId, element: HTMLElement | null) => {
    if (element) {
      bars.current.set(sessionId, { element, band: null });
    }

    return () => {
      bars.current.delete(sessionId);
      displayed.current.delete(sessionId);
      incoming.current.delete(sessionId);
    };
  }, []);

  return { register };
};
