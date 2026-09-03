import { useEffect, useRef, type FC } from 'react';

import { subscribeToMeter } from '@/features/mixer/lib/meterEngine';
import { dbToLevel, formatDb, METER_MID_DB, METER_WARNING_DB } from '@/lib/meter';
import { cn } from '@/lib/utils';
import type { SessionId } from '@/types/ipc';

export interface PeakMeterProps {
  sessionId: SessionId;
  isMuted?: boolean;
  className?: string;
}

const SEGMENT_PITCH_PX = 5;
const SEGMENT_WIDTH_PX = 3.5;

/**
 * Band stops are derived from the dB edges rather than typed as percentages, so moving an edge
 * moves the colour with it. Hardcoding both is how a bar ends up amber a band early.
 */
const MID_STOP = dbToLevel(METER_MID_DB) * 100;
const WARNING_STOP = dbToLevel(METER_WARNING_DB) * 100;
const BLEND = 2.5;

const LADDER_GRADIENT = [
  'linear-gradient(to right',
  'var(--success) 0%',
  `var(--success) ${(MID_STOP - BLEND).toString()}%`,
  `var(--warning) ${(MID_STOP + BLEND).toString()}%`,
  `var(--warning) ${(WARNING_STOP - BLEND).toString()}%`,
  `var(--destructive) ${(WARNING_STOP + BLEND).toString()}%`,
  'var(--destructive) 100%)',
].join(', ');

/**
 * The LED look. Applied to the untransformed container so the pitch is fixed in screen space —
 * masking the scaled fill instead would stretch the segments along with it.
 */
const SEGMENT_MASK = `repeating-linear-gradient(to right, #000 0 ${SEGMENT_WIDTH_PX.toString()}px, transparent ${SEGMENT_WIDTH_PX.toString()}px ${SEGMENT_PITCH_PX.toString()}px)`;

/** Below this the counter-scale blows up and there is nothing to see anyway. */
const MIN_VISIBLE_LEVEL = 0.03;

/**
 * The segmented peak ladder, one per session.
 *
 * Nothing here is React state. The row renders once and then the engine writes `transform` and
 * one string of text straight to these nodes on its own rAF loop; at 30 Hz across every visible
 * row, a re-render per batch is the whole frame budget.
 *
 * The fill is clipped by scaling a wrapper and counter-scaling the gradient inside it. Scaling
 * the gradient alone would squash the bands toward the left, so a quiet signal would paint amber.
 */
export const PeakMeter: FC<PeakMeterProps> = ({ sessionId, isMuted = false, className }) => {
  const clipRef = useRef<HTMLDivElement>(null);
  const litRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const shownDbRef = useRef<number | null>(null);

  useEffect(
    () =>
      subscribeToMeter(sessionId, (db) => {
        const clip = clipRef.current;
        const lit = litRef.current;
        const readout = readoutRef.current;

        if (!clip || !lit || !readout) {
          return;
        }

        const level = dbToLevel(db);

        if (level < MIN_VISIBLE_LEVEL) {
          clip.style.opacity = '0';
        } else {
          clip.style.opacity = '1';
          clip.style.transform = `scaleX(${level.toString()})`;
          lit.style.transform = `scaleX(${(1 / level).toString()})`;
        }

        // The readout is the one channel a person reads a value off, so it is written on a whole
        // dB change rather than every frame. Rewriting it at 60 Hz makes it unreadable and dirties
        // a text node for nothing.
        const rounded = Math.round(db);

        if (rounded !== shownDbRef.current) {
          shownDbRef.current = rounded;
          readout.textContent = formatDb(db);
        }
      }),
    [sessionId],
  );

  return (
    <div
      data-testid="peak-meter"
      className={cn(
        'flex items-center gap-2 transition-opacity duration-200',
        isMuted && 'opacity-35',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="relative h-[7px] min-w-0 flex-1 overflow-hidden rounded-[2px]"
        style={{ maskImage: SEGMENT_MASK, WebkitMaskImage: SEGMENT_MASK }}
      >
        {/* The unlit ladder. Present at rest so the meter reads as a scale rather than as an
            empty groove, which is what tells you how much headroom is left. */}
        <div className="absolute inset-0 opacity-[0.16]" style={{ background: LADDER_GRADIENT }} />

        <div
          ref={clipRef}
          className="absolute inset-0 origin-left overflow-hidden opacity-0 will-change-transform"
        >
          <div
            ref={litRef}
            className="absolute inset-0 origin-left will-change-transform"
            style={{ background: LADDER_GRADIENT }}
          />
        </div>
      </div>

      <span
        ref={readoutRef}
        data-testid="peak-readout"
        title="Peak level"
        className="text-numeric text-muted-foreground w-11 shrink-0 text-right"
      >
        −∞ dB
      </span>
    </div>
  );
};
