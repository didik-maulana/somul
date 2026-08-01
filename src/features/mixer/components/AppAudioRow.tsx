import type React from 'react';

import { AppSpeaker } from '@/features/mixer/components/AppSpeaker';
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
  // The platform sees the app but could not take control of it — on macOS, a tap the OS refused.
  // Its audio is real and playing, so hiding the row would be a lie; leaving the slider live
  // would be a worse one, because it would write to a control that does not exist.
  const isUncontrollable = session.state === 'inactive';
  const isDisabled = isExpired || isUncontrollable;

  return (
    <div
      data-testid="app-audio-row"
      data-state={session.state}
      data-muted={session.isMuted}
      data-dragging={isDragging}
      className={cn(
        'group flex items-center gap-3 rounded-lg border border-transparent bg-secondary/15 backdrop-blur-xs px-2 transition-colors duration-[140ms] ease-[var(--ease-standard)]',
        peakStream ? 'h-16' : 'h-13',
        'hover:bg-accent hover:border-border hover:backdrop-blur-md',
        // Offset against `background`, the panel's own surface. Offsetting to `popover` would
        // paint a wrong-coloured halo, since popover is now reserved for things floating above
        // the panel rather than the panel itself.
        'focus-within:ring-ring focus-within:ring-offset-background focus-within:ring-2 focus-within:ring-offset-2',
        isDragging && 'bg-card backdrop-blur-md border-border shadow-e2',
        isExpired && 'pointer-events-none opacity-50',
        isUncontrollable && 'opacity-60',
      )}
    >
      <AppSpeaker
        session={session}
        peakStream={peakStream}
        isDisabled={isDisabled}
        onMuteToggle={onMuteToggle}
      />

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

          {session.isMuted && !isUncontrollable && (
            <span className="text-micro text-muted-foreground bg-secondary/90 border border-border/50 rounded-xs px-1.5 py-0.5 font-medium tracking-wide">
              MUTED
            </span>
          )}

          {isUncontrollable && (
            <span
              data-testid="uncontrollable-chip"
              title="macOS would not let Somul take over this app's audio."
              className="text-micro text-muted-foreground bg-secondary/90 border border-border/50 rounded-xs px-1.5 py-0.5 font-medium tracking-wide"
            >
              NO CONTROL
            </span>
          )}

          <span className={cn('text-numeric shrink-0 font-medium', session.isMuted ? 'text-muted-foreground/60' : 'text-muted-foreground')}>
            {isUncontrollable ? '—' : formatPercent(session.volume)}
          </span>
        </div>

        <VolumeSlider
          volume={session.volume}
          label={`Volume for ${session.displayName}`}
          isMuted={session.isMuted}
          isDisabled={isDisabled}
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
    </div>
  );
};
