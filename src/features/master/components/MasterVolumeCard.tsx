import type React from 'react';
import {
  Headphones,
  Laptop,
  Monitor,
  Speaker,
  Volume1,
  Volume2,
  VolumeX,
  type LucideIcon,
} from 'lucide-react';

import { resolveDeviceKind, type DeviceKind } from '@/features/master/lib/deviceIcon';
import { VolumeSlider } from '@/features/mixer/components/VolumeSlider';
import { formatPercent } from '@/lib/audio';
import { cn } from '@/lib/utils';
import type { MasterState } from '@/types/ipc';

export interface MasterVolumeCardProps {
  master: MasterState;
  onVolumeChange: (volume: number) => void;
  onVolumeCommit: (volume: number) => void;
  onMuteToggle?: () => void;
  /** False while the user is dragging — see {@link VolumeSlider.hasSmoothMotion}. */
  hasSmoothMotion?: boolean;
  /** Rendered at the end of the device row — the output device picker. */
  deviceSelector?: React.ReactNode;
}

const ENTER_MOTION =
  'animate-in fade-in slide-in-from-top-1 duration-300 ease-[var(--ease-decelerate)] motion-reduce:animate-none';

const GLYPH_SWAP =
  'animate-in fade-in zoom-in-75 duration-200 ease-[var(--ease-spring)] motion-reduce:animate-none';

const DEVICE_GLYPHS: Record<DeviceKind, LucideIcon> = {
  headphones: Headphones,
  display: Monitor,
  laptop: Laptop,
  speaker: Speaker,
};

/**
 * Pinned above the scroll region at `e1` elevation, `radius-lg`, 12 px padding.
 *
 * Two rows: which device is being driven, then how loud it is. Splitting them keeps the slider on
 * a line of its own, so it runs the full width of the card and stays the widest target in the
 * panel — the device name no longer competes with it for horizontal space.
 *
 * Its slider fill uses the signature gradient instead of flat `primary`. This is the one element
 * permitted to visually outrank the app rows, and one of only three places the gradient is
 * allowed at all. Rank is otherwise carried by the readout: `text-readout` against an app row's
 * `text-numeric`, and no extra chrome.
 */
export const MasterVolumeCard: React.FC<MasterVolumeCardProps> = ({
  master,
  onVolumeChange,
  onVolumeCommit,
  onMuteToggle,
  hasSmoothMotion = false,
  deviceSelector,
}) => {
  const { deviceName, volume, isMuted, isVolumeControllable } = master;
  const DeviceIcon = DEVICE_GLYPHS[resolveDeviceKind(deviceName)];
  const VolumeIcon = isMuted ? VolumeX : volume > 0.5 ? Volume2 : Volume1;
  // Remounting on every state change is what lets the glyph animate in. Keying on the state rather
  // than on the component keeps the three volume icons from sharing one instance.
  const volumeIconState = isMuted ? 'muted' : volume > 0.5 ? 'loud' : 'quiet';

  return (
    <section
      data-testid="master-volume-card"
      data-muted={isMuted}
      aria-label="Master output"
      className={cn(
        'bg-card backdrop-blur-md border-border card-raised flex shrink-0 flex-col gap-2.5 rounded-lg border p-3 shadow-xs',
        'transition-[background-color,border-color] duration-200 ease-[var(--ease-standard)]',
        'hover:border-ring/35 focus-within:border-ring/45',
        ENTER_MOTION,
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          data-testid="master-device-icon"
          className="bg-secondary/60 border-border/50 text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg border"
        >
          <DeviceIcon key={deviceName} size={16} strokeWidth={1.75} className={GLYPH_SWAP} />
        </span>

        <span
          className={cn(
            'text-label min-w-0 flex-1 truncate transition-colors duration-200',
            isMuted && 'text-muted-foreground',
          )}
          title={deviceName}
        >
          {deviceName}
        </span>

        {isMuted && isVolumeControllable && (
          <span
            data-testid="master-muted-chip"
            className={cn(
              'text-micro text-destructive-text bg-destructive/10 border-destructive/25 shrink-0 rounded-xs border px-1.5 py-0.5 font-medium tracking-wide',
              'animate-in fade-in slide-in-from-right-1 duration-200 motion-reduce:animate-none',
            )}
          >
            MUTED
          </span>
        )}

        {deviceSelector}
      </div>

      <div className="flex items-center gap-2.5">
        {onMuteToggle && (
          <button
            type="button"
            data-testid="master-mute-toggle"
            disabled={!isVolumeControllable}
            onClick={onMuteToggle}
            aria-label={isMuted ? 'Unmute master volume' : 'Mute master volume'}
            aria-pressed={isMuted}
            className={cn(
              // No tile behind it: the glyph itself is the control, so the state lives in its
              // colour and its shape rather than in a chip that appears only when muted.
              'flex size-8 shrink-0 items-center justify-center rounded-sm outline-none',
              'transition-[transform,color] duration-[140ms] ease-[var(--ease-standard)]',
              'active:scale-90 motion-reduce:active:scale-100',
              'focus-visible:ring-ring focus-visible:ring-2',
              'disabled:pointer-events-none disabled:opacity-50',
              isMuted ? 'text-destructive-text' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <VolumeIcon key={volumeIconState} size={18} strokeWidth={1.75} className={GLYPH_SWAP} />
          </button>
        )}

        <VolumeSlider
          volume={volume}
          label={`Master volume for ${deviceName}`}
          isMuted={isMuted}
          isDisabled={!isVolumeControllable}
          onVolumeChange={onVolumeChange}
          onVolumeCommit={onVolumeCommit}
          hasSmoothMotion={hasSmoothMotion}
          className={cn(
            'min-w-0 flex-1 [&_[data-slot=slider-range]]:bg-signature',
            // The gradient is a background *image*, which cannot tween to a flat colour. Draining
            // it instead lets the mute toggle land as one continuous move across the whole card.
            '[&_[data-slot=slider-range]]:transition-[filter,opacity] [&_[data-slot=slider-range]]:duration-200 [&_[data-slot=slider-range]]:ease-[var(--ease-standard)]',
            'motion-reduce:[&_[data-slot=slider-range]]:transition-none',
            isMuted && '[&_[data-slot=slider-range]]:opacity-45 [&_[data-slot=slider-range]]:grayscale',
          )}
        />

        <span
          className={cn(
            'text-readout shrink-0 transition-colors duration-200',
            // Muting dims the level but never hides it — it is the value the device returns to on
            // unmute, so it stays at a legible token rather than a faded one.
            (isMuted || !isVolumeControllable) && 'text-muted-foreground',
          )}
        >
          {isVolumeControllable ? formatPercent(volume) : '—'}
        </span>
      </div>

      {!isVolumeControllable && (
        <p
          className={cn(
            'text-caption text-muted-foreground',
            'animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none',
          )}
        >
          This output controls its volume in hardware. Use the dial on the device.
        </p>
      )}
    </section>
  );
};
