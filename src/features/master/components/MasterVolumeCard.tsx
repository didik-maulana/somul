import type React from 'react';

import { VolumeSlider } from '@/features/mixer/components/VolumeSlider';
import { formatPercent } from '@/lib/audio';
import type { MasterState } from '@/types/ipc';

export interface MasterVolumeCardProps {
  master: MasterState;
  onVolumeChange: (volume: number) => void;
  onVolumeCommit: (volume: number) => void;
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
  hasSmoothMotion = false,
  deviceSelector,
}) => (
  <section
    data-testid="master-volume-card"
    aria-label="Master output"
    className="bg-card border-border flex shrink-0 flex-col gap-2 rounded-lg border p-3"
  >
    <div className="flex items-center gap-2">
      <span className="text-caption text-muted-foreground min-w-0 flex-1 truncate" title={master.deviceName}>
        {master.deviceName}
      </span>
      {deviceSelector}
      <span className="text-numeric text-muted-foreground shrink-0">
        {formatPercent(master.volume)}
      </span>
    </div>

    <VolumeSlider
      volume={master.volume}
      label={`Master volume for ${master.deviceName}`}
      isMuted={master.isMuted}
      onVolumeChange={onVolumeChange}
      onVolumeCommit={onVolumeCommit}
      hasSmoothMotion={hasSmoothMotion}
      className="[&_[data-slot=slider-range]]:bg-signature"
    />
  </section>
);
