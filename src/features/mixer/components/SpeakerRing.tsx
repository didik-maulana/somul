import { useEffect, useRef, type FC } from 'react';

import type { PeakStream } from '@/features/mixer/hooks/usePeakStream';
import { cn } from '@/lib/utils';
import type { SessionId } from '@/types/ipc';

export interface SpeakerRingProps {
  sessionId: SessionId;
  stream: PeakStream;
  className?: string;
}

/**
 * The halo around an app's speaker tile, scaled and faded by that app's live peak.
 *
 * Same contract as the peak meter: it hands its element to the shared rAF loop and is never
 * re-rendered by the level flow after that. It publishes `--peak-level` and lets the stylesheet
 * own the mapping, so the reduced-motion variant is a CSS concern rather than a JS branch.
 *
 * `aria-hidden` because it is a second reading of a level the dB band and the meter already
 * carry — never the only channel.
 */
export const SpeakerRing: FC<SpeakerRingProps> = ({ sessionId, stream, className }) => {
  const ringRef = useRef<HTMLSpanElement>(null);
  const { register } = stream;

  useEffect(() => register(sessionId, ringRef.current, 'level'), [register, sessionId]);

  return (
    <span
      ref={ringRef}
      aria-hidden="true"
      data-testid="speaker-ring"
      data-band="floor"
      className={cn(
        'speaker-ring pointer-events-none absolute -inset-1 rounded-lg border',
        'border-[var(--meter-floor)] data-[band=clip]:border-[var(--destructive)] data-[band=mid]:border-[var(--meter-mid)] data-[band=warning]:border-[var(--warning)]',
        className,
      )}
    />
  );
};
