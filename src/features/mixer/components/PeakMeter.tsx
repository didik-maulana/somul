import { useEffect, useRef, type FC } from 'react';

import type { PeakStream } from '@/features/mixer/hooks/usePeakStream';
import { cn } from '@/lib/utils';
import type { SessionId } from '@/types/ipc';

export interface PeakMeterProps {
  sessionId: SessionId;
  stream: PeakStream;
  isMuted?: boolean;
  className?: string;
}

/**
 * A 3 px bar on a `bg-muted` track.
 *
 * The fill is a single element driven by `transform: scaleX()` from the shared rAF loop. It
 * holds no state and never re-renders on a level change: this component mounts, hands its
 * element to the stream, and is untouched by the 30 Hz event flow after that.
 *
 * `aria-hidden` because the meter is decorative — level is conveyed by the dB readout,
 * never by color alone.
 */
export const PeakMeter: FC<PeakMeterProps> = ({ sessionId, stream, isMuted = false, className }) => {
  const fillRef = useRef<HTMLDivElement>(null);
  const { register } = stream;

  useEffect(() => register(sessionId, fillRef.current), [register, sessionId]);

  return (
    <div
      aria-hidden="true"
      data-testid="peak-meter"
      className={cn('bg-muted h-[3px] w-full overflow-hidden rounded-xs', isMuted && 'opacity-30', className)}
    >
      <div
        ref={fillRef}
        data-testid="peak-meter-fill"
        data-band="floor"
        className="h-full w-full origin-left scale-x-0 rounded-xs bg-[var(--meter-floor)] data-[band=clip]:bg-[var(--destructive)] data-[band=mid]:bg-[var(--meter-mid)] data-[band=warning]:bg-[var(--warning)]"
      />
    </div>
  );
};
