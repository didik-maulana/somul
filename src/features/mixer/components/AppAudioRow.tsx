import type React from 'react';

import { MuteToggle } from '@/features/mixer/components/MuteToggle';
import { PeakMeter } from '@/features/mixer/components/PeakMeter';
import { VolumeSlider } from '@/features/mixer/components/VolumeSlider';
import type { PeakStream } from '@/features/mixer/hooks/usePeakStream';
import { formatPercent } from '@/lib/audio';
import { cn } from '@/lib/utils';
import type { AudioSession } from '@/types/ipc';

export interface AppAudioRowProps {
  session: AudioSession;
  /** Absent when the platform has no per-app metering — the row then renders at 52 px. */
  peakStream?: PeakStream;
  isDragging?: boolean;
  onVolumeChange: (volume: number) => void;
  onVolumeCommit: (volume: number) => void;
  onMuteToggle: () => void;
}

const AppIcon: React.FC<{ session: AudioSession }> = ({ session }) => {
  if (session.iconDataUri) {
    return (
      <img
        src={session.iconDataUri}
        alt=""
        aria-hidden="true"
        className="size-8 shrink-0 rounded-md"
      />
    );
  }

  // A missing icon falls back to a tile, not a glyph. The tile is a surface rather than a stroke
  // icon, which is why the signature gradient is permitted here.
  return (
    <span
      aria-hidden="true"
      data-testid="app-icon-fallback"
      className="bg-signature text-label flex size-8 shrink-0 items-center justify-center rounded-md opacity-20"
    >
      {session.displayName.charAt(0).toUpperCase()}
    </span>
  );
};

/**
 * The core repeated unit of the mixer.
 *
 * Pure presentation. It takes an `AudioSession` plus handlers and calls no IPC; debouncing and
 * commits belong upstream in the hook. Height is derived from whether the meter renders — 64 px
 * with, 52 px without — because the content stack does not fit in 52 px once the meter is on.
 */
export const AppAudioRow: React.FC<AppAudioRowProps> = ({
  session,
  peakStream,
  isDragging = false,
  onVolumeChange,
  onVolumeCommit,
  onMuteToggle,
}) => {
  const isExpired = session.state === 'expired';

  return (
    <div
      data-testid="app-audio-row"
      data-state={session.state}
      data-muted={session.isMuted}
      data-dragging={isDragging}
      className={cn(
        'group flex items-center gap-3 rounded-lg border border-transparent px-2 transition-colors duration-[140ms] ease-[var(--ease-standard)]',
        peakStream ? 'h-16' : 'h-13',
        'hover:bg-accent hover:border-border',
        // Offset against `background`, the panel's own surface. Offsetting to `popover` would
        // paint a wrong-coloured halo, since popover is now reserved for things floating above
        // the panel rather than the panel itself.
        'focus-within:ring-ring focus-within:ring-offset-background focus-within:ring-2 focus-within:ring-offset-2',
        isDragging && 'bg-card border-border shadow-e2',
        isExpired && 'pointer-events-none opacity-50',
      )}
    >
      <AppIcon session={session} />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          {isExpired && (
            <span
              aria-hidden="true"
              data-testid="device-lost-dot"
              className="bg-destructive size-1.5 shrink-0 rounded-full"
            />
          )}

          <span
            title={session.displayName}
            className={cn(
              'text-label flex-1 truncate',
              session.isMuted && 'text-muted-foreground',
            )}
          >
            {session.displayName}
          </span>

          {session.isMuted && (
            <span className="text-micro text-muted-foreground bg-secondary rounded-xs px-1">
              MUTED
            </span>
          )}

          <span className="text-numeric text-muted-foreground shrink-0">
            {formatPercent(session.volume)}
          </span>
        </div>

        <VolumeSlider
          volume={session.volume}
          label={`Volume for ${session.displayName}`}
          isMuted={session.isMuted}
          isDisabled={isExpired}
          onVolumeChange={onVolumeChange}
          onVolumeCommit={onVolumeCommit}
        />

        {peakStream && (
          <PeakMeter
            sessionId={session.sessionId}
            stream={peakStream}
            isMuted={session.isMuted}
          />
        )}
      </div>

      <MuteToggle
        isMuted={session.isMuted}
        volume={session.volume}
        appName={session.displayName}
        isDisabled={isExpired}
        onMuteToggle={onMuteToggle}
      />
    </div>
  );
};
