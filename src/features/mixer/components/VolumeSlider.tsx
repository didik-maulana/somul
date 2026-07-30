import React, { useLayoutEffect, useRef } from 'react';

import { Slider } from '@/components/ui/slider';
import { clampScalar, formatVolumeForScreenReader } from '@/lib/audio';
import { cn } from '@/lib/utils';

export interface VolumeSliderProps {
  /** Linear scalar 0.0–1.0 (ARCHITECTURE.md §6.1). */
  volume: number;
  /** Names the control for screen readers — "Volume for Spotify", not "Volume" (DESIGN.md §11). */
  label: string;
  isMuted?: boolean;
  isDisabled?: boolean;
  /** Fires on every pointer move and key press. Committing is the caller's job (§9). */
  onVolumeChange: (volume: number) => void;
  /** Radix fires this on pointer-up and key-up — the guaranteed flush point (§9). */
  onVolumeCommit?: (volume: number) => void;
  className?: string;
}

/**
 * DESIGN.md §9.5. Track 4 px, thumb 14 px growing to 16 px on hover.
 *
 * The thumb carries **no transition on position** — only on scale and shadow (§7). A transition
 * on translate would lag the pointer during a drag, which reads as the control fighting the user.
 * Styling reaches into the unmodified primitive through `data-slot` selectors rather than forking
 * it (§12 component boundaries).
 */
export const VolumeSlider: React.FC<VolumeSliderProps> = ({
  volume,
  label,
  isMuted = false,
  isDisabled = false,
  onVolumeChange,
  onVolumeCommit,
  className,
}) => {
  const percent = Math.round(clampScalar(volume) * 100);
  const rootRef = useRef<HTMLSpanElement>(null);
  const valueText = formatVolumeForScreenReader(volume);

  // Radix puts `role="slider"` on the thumb, but the primitive spreads its props onto the root,
  // so a11y attributes set here never reach the element that announces them. Writing them to the
  // thumb directly is what keeps §11 satisfied without forking the primitive (§12).
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
        '[&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:rounded-full',
        isMuted
          ? '[&_[data-slot=slider-range]]:bg-muted'
          : '[&_[data-slot=slider-range]]:bg-primary',
        '[&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-thumb]]:border-white/20 [&_[data-slot=slider-thumb]]:bg-[#FCFCFD]',
        '[&_[data-slot=slider-thumb]]:shadow-[0_1px_3px_rgba(0,0,0,0.4)]',
        '[&_[data-slot=slider-thumb]]:transition-[transform,box-shadow] [&_[data-slot=slider-thumb]]:duration-[140ms]',
        '[&_[data-slot=slider-thumb]]:hover:scale-[1.143]',
        '[&_[data-slot=slider-thumb]]:active:scale-[1.15] [&_[data-slot=slider-thumb]]:active:ring-6 [&_[data-slot=slider-thumb]]:active:ring-ring/16',
        '[&_[data-slot=slider-thumb]]:focus-visible:ring-2 [&_[data-slot=slider-thumb]]:focus-visible:ring-ring [&_[data-slot=slider-thumb]]:focus-visible:ring-offset-2 [&_[data-slot=slider-thumb]]:focus-visible:ring-offset-popover',
        className,
      )}
    />
  );
};
