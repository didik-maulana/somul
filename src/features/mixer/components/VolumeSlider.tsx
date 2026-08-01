import React, { useLayoutEffect, useRef } from 'react';

import { Slider } from '@/components/ui/slider';
import { clampScalar, formatVolumeForScreenReader } from '@/lib/audio';
import { cn } from '@/lib/utils';

export interface VolumeSliderProps {
  /** Linear scalar 0.0–1.0, not a percentage. */
  volume: number;
  /** Names the control for screen readers — "Volume for Spotify", not a bare "Volume". */
  label: string;
  isMuted?: boolean;
  isDisabled?: boolean;
  /** Fires on every pointer move and key press. Committing is the caller's job. */
  onVolumeChange: (volume: number) => void;
  /** Radix fires this on pointer-up and key-up — the guaranteed flush point. */
  onVolumeCommit?: (volume: number) => void;
  /**
   * Eases the thumb between values instead of snapping.
   *
   * Turn this on only while the value is arriving from outside — the OS volume being changed in
   * the menu bar reaches us as periodic samples, and without easing the thumb visibly steps. It
   * must be **off** during a drag, where any transition lags the pointer.
   */
  hasSmoothMotion?: boolean;
  className?: string;
}

/**
 * Track 4 px, thumb 14 px growing to 16 px on hover.
 *
 * The thumb carries **no transition on position** — only on scale and shadow. A transition
 * on translate would lag the pointer during a drag, which reads as the control fighting the user.
 * Styling reaches into the unmodified primitive through `data-slot` selectors rather than forking
 * it, which would put a maintained fork of a vendored primitive in the tree.
 */
export const VolumeSlider: React.FC<VolumeSliderProps> = ({
  volume,
  label,
  isMuted = false,
  isDisabled = false,
  onVolumeChange,
  onVolumeCommit,
  hasSmoothMotion = false,
  className,
}) => {
  const percent = Math.round(clampScalar(volume) * 100);
  const rootRef = useRef<HTMLSpanElement>(null);
  const valueText = formatVolumeForScreenReader(volume);

  // Radix puts `role="slider"` on the thumb, but the primitive spreads its props onto the root,
  // so a11y attributes set here never reach the element that announces them. Writing them to the
  // thumb directly keeps the control accessible without forking the primitive.
  useLayoutEffect(() => {
    const thumb = rootRef.current?.querySelector('[data-slot="slider-thumb"]');

    thumb?.setAttribute('aria-label', label);
    thumb?.setAttribute('aria-valuetext', valueText);
  }, [label, valueText]);

  const toScalar = (values: number[]): number => clampScalar((values[0] ?? 0) / 100);

  return (
    <Slider
      ref={rootRef}
      value={[percent]}
      min={0}
      max={100}
      step={1}
      disabled={isDisabled}
      aria-label={label}
      aria-valuetext={formatVolumeForScreenReader(volume)}
      onValueChange={(values) => {
        onVolumeChange(toScalar(values));
      }}
      onValueCommit={(values) => {
        onVolumeCommit?.(toScalar(values));
      }}
      className={cn(
        '[&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:rounded-full [&_[data-slot=slider-track]]:bg-black/14 dark:[&_[data-slot=slider-track]]:bg-white/12',
        // Muting drains the fill rather than swapping it for a flat colour, so every slider in
        // the panel reads the same way whether its fill is `primary` or the master's gradient.
        // A gradient is a background *image* and cannot tween to a colour; draining can.
        '[&_[data-slot=slider-range]]:bg-primary',
        isMuted && '[&_[data-slot=slider-range]]:opacity-45 [&_[data-slot=slider-range]]:grayscale',
        // Every transition on the range lives in one property list. tailwind-merge folds separate
        // `transition-*` classes into a single group and keeps only the last, which is how a
        // second one silently deleted the position easing this branch exists for.
        //
        // Radix positions the range and the thumb with `left`/`right` percentages, so those are
        // the properties that have to ease. Linear over exactly one sample interval means each
        // sample arrives as the previous one finishes, and the steps read as continuous motion.
        hasSmoothMotion
          ? [
              '[&_[data-slot=slider-range]]:transition-[left,right,filter,opacity]',
              '[&_[data-slot=slider-range]]:duration-[var(--master-sync-duration)]',
              '[&_[data-slot=slider-range]]:ease-linear',
              '[&_span:has(>[data-slot=slider-thumb])]:transition-[left]',
              '[&_span:has(>[data-slot=slider-thumb])]:duration-[var(--master-sync-duration)]',
              '[&_span:has(>[data-slot=slider-thumb])]:ease-linear',
              'motion-reduce:[&_[data-slot=slider-range]]:transition-none',
              'motion-reduce:[&_span:has(>[data-slot=slider-thumb])]:transition-none',
            ]
          : [
              // The drain still eases while position does not: muting is a state change worth
              // showing as one, and the fill's length has to track the pointer exactly.
              '[&_[data-slot=slider-range]]:transition-[filter,opacity]',
              '[&_[data-slot=slider-range]]:duration-200',
              'motion-reduce:[&_[data-slot=slider-range]]:transition-none',
            ],
        '[&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-thumb]]:border-white/20 [&_[data-slot=slider-thumb]]:bg-[#FCFCFD]',
        '[&_[data-slot=slider-thumb]]:shadow-[0_1px_3px_rgba(0,0,0,0.4)]',
        '[&_[data-slot=slider-thumb]]:transition-[transform,box-shadow] [&_[data-slot=slider-thumb]]:duration-[140ms]',
        '[&_[data-slot=slider-thumb]]:hover:scale-[1.143]',
        '[&_[data-slot=slider-thumb]]:active:scale-[1.15] [&_[data-slot=slider-thumb]]:active:ring-6 [&_[data-slot=slider-thumb]]:active:ring-ring/16',
        '[&_[data-slot=slider-thumb]]:focus-visible:ring-2 [&_[data-slot=slider-thumb]]:focus-visible:ring-ring [&_[data-slot=slider-thumb]]:focus-visible:ring-offset-2 [&_[data-slot=slider-thumb]]:focus-visible:ring-offset-background',
        className,
      )}
    />
  );
};
