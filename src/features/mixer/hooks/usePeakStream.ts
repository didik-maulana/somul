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

/**
 * How a registered element consumes the level.
 *
 * `meter` owns the whole element and drives it with `transform`. `level` publishes the level as a
 * `--peak-level` custom property and leaves the visual mapping to CSS, so an element whose
 * transform belongs to the stylesheet can still react to audio.
 */
export type PeakSink = 'meter' | 'level';

export interface PeakStream {
  /** Registers an element. Returns an unregister function for cleanup. */
  register: (sessionId: SessionId, element: HTMLElement | null, sink?: PeakSink) => () => void;
}

interface SinkRegistration {
  sessionId: SessionId;
  sink: PeakSink;
  band: MeterBand | null;
}

export const usePeakStream = (): PeakStream => {
  const incoming = useRef(new Map<SessionId, number>());
  const displayed = useRef(new Map<SessionId, number>());
  const sinks = useRef(new Map<HTMLElement, SinkRegistration>());

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

    // Reused rather than allocated per frame. A session with several sinks must decay exactly
    // once per frame, or the second sink would read a level that fell twice.
    const painted = new Map<SessionId, number>();

    const paint = (timestamp: number) => {
      const elapsedMs = previousTimestamp === undefined ? 0 : timestamp - previousTimestamp;
      previousTimestamp = timestamp;
      painted.clear();

      for (const [element, registration] of sinks.current) {
        let level = painted.get(registration.sessionId);

        if (level === undefined) {
          const target = incoming.current.get(registration.sessionId) ?? 0;

          level = decayPeak(displayed.current.get(registration.sessionId) ?? 0, target, elapsedMs);
          displayed.current.set(registration.sessionId, level);
          painted.set(registration.sessionId, level);
        }

        if (registration.sink === 'meter') {
          // scaleX only. Animating width would trigger layout every frame, and a CSS transition
          // here would smear the signal.
          element.style.transform = `scaleX(${level.toString()})`;
        } else {
          element.style.setProperty('--peak-level', level.toFixed(3));
        }

        const band = meterBand(level);

        if (band !== registration.band) {
          registration.band = band;
          element.dataset.band = band;
        }
      }

      frame = requestAnimationFrame(paint);
    };

    frame = requestAnimationFrame(paint);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);

  const register = useCallback(
    (sessionId: SessionId, element: HTMLElement | null, sink: PeakSink = 'meter') => {
      if (element) {
        sinks.current.set(element, { sessionId, sink, band: null });
      }

      return () => {
        if (element) {
          sinks.current.delete(element);
        }

        // The level survives while any sink still reads it. Dropping it when the first of a row's
        // two sinks unmounts would reset the other one to silence mid-signal.
        for (const registration of sinks.current.values()) {
          if (registration.sessionId === sessionId) {
            return;
          }
        }

        displayed.current.delete(sessionId);
        incoming.current.delete(sessionId);
      };
    },
    [],
  );

  return { register };
};
