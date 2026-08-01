import type React from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
  /** Rendered to the right of the device name — the output device picker. */
  deviceSelector?: React.ReactNode;
}

/**
 * Pinned above the scroll region at `e1` elevation, `radius-lg`, 12 px padding.
 *
 * Its slider fill uses the signature gradient instead of flat `primary`. This is the one element
 * permitted to visually outrank the app rows, and one of only three places the gradient is
 * allowed at all.
 */
export const MasterVolumeCard: React.FC<MasterVolumeCardProps> = ({
  master,
  onVolumeChange,
  onVolumeCommit,
  onMuteToggle,
  hasSmoothMotion = false,
  deviceSelector,
}) => {
  const Icon = master.isMuted ? VolumeX : master.volume > 0.5 ? Volume2 : Volume1;

  return (
    <section
      data-testid="master-volume-card"
      aria-label="Master output"
      className="bg-card backdrop-blur-md border-border card-raised flex shrink-0 flex-col gap-2 rounded-lg border p-3 shadow-xs transition-colors duration-150"
    >
      <div className="flex items-center gap-2">
        {onMuteToggle && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={!master.isVolumeControllable}
            onClick={onMuteToggle}
            aria-label={master.isMuted ? 'Unmute master volume' : 'Mute master volume'}
            className={cn(
              'size-7 shrink-0 rounded-md transition-colors',
              master.isMuted && 'text-destructive bg-destructive/10 hover:bg-destructive/20',
            )}
          >
            <Icon size={16} strokeWidth={1.75} />
          </Button>
        )}

        <span
          className={cn(
            'text-caption text-muted-foreground min-w-0 flex-1 font-medium truncate',
            master.isMuted && 'text-muted-foreground/60',
          )}
          title={master.deviceName}
        >
          {master.deviceName}
        </span>

        {deviceSelector}

        <span
          className={cn(
            'text-numeric shrink-0 font-medium',
            master.isMuted ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {master.isVolumeControllable ? (master.isMuted ? 'MUTED' : formatPercent(master.volume)) : '—'}
        </span>
      </div>

      <VolumeSlider
        volume={master.volume}
        label={`Master volume for ${master.deviceName}`}
        isMuted={master.isMuted}
        isDisabled={!master.isVolumeControllable}
        onVolumeChange={onVolumeChange}
        onVolumeCommit={onVolumeCommit}
        hasSmoothMotion={hasSmoothMotion}
        className="[&_[data-slot=slider-range]]:bg-signature"
      />

      {!master.isVolumeControllable && (
        <p className="text-caption text-muted-foreground">
          This output controls its volume in hardware. Use the dial on the device.
        </p>
      )}
    </section>
  );
};

