import type React from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';

import { AppIcon } from '@/features/mixer/components/AppIcon';
import { PeakMeter } from '@/features/mixer/components/PeakMeter';
import { VolumeSlider } from '@/features/mixer/components/VolumeSlider';
import { formatPercent } from '@/lib/audio';
import { cn } from '@/lib/utils';
import type { AudioSession } from '@/types/ipc';

export interface AppAudioRowProps {
  session: AudioSession;
  isDragging?: boolean;
  /** Platform capability, decided upstream. A row never asks the backend what it can do. */
  hasMeter?: boolean;
  onVolumeChange: (volume: number) => void;
  onVolumeCommit: (volume: number) => void;
  onMuteToggle: () => void;
}

const GLYPH_SWAP =
  'animate-in fade-in zoom-in-75 duration-200 ease-[var(--ease-spring)] motion-reduce:animate-none';

const CHIP = 'text-micro shrink-0 rounded-xs border px-1.5 py-0.5 font-medium tracking-wide';

/**
 * The core repeated unit of the mixer.
 *
 * The app's logo leads the row, and the two lines beside it carry its name and its volume. Same
 * shape as the master card one rank down, so a row and the control that scales every row are read
 * the same way.
 *
 * Pure presentation. It takes an `AudioSession` plus handlers and calls no IPC; debouncing and
 * commits belong upstream in the hook.
 */
export const AppAudioRow: React.FC<AppAudioRowProps> = ({
  session,
  isDragging = false,
  hasMeter = false,
  onVolumeChange,
  onVolumeCommit,
  onMuteToggle,
}) => {
  const { displayName, isMuted, volume } = session;
  const isExpired = session.state === 'expired';
  // The platform sees the app but could not take control of it — on macOS, a tap the OS refused.
  // Its audio is real and playing, so hiding the row would be a lie; leaving the slider live
  // would be a worse one, because it would write to a control that does not exist.
  const isUncontrollable = session.state === 'inactive';
  const isDisabled = isExpired || isUncontrollable;
  const VolumeIcon = isMuted ? VolumeX : volume > 0.5 ? Volume2 : Volume1;
  // Remounting on every state change is what lets the glyph animate in. Keying on the state
  // rather than on the component keeps the three volume icons from sharing one instance.
  const volumeIconState = isMuted ? 'muted' : volume > 0.5 ? 'loud' : 'quiet';
  // A row Somul is not carrying has no peaks to read, and a meter parked at silence beside an app
  // that is audibly playing is worse than no meter at all.
  const isMeterVisible = hasMeter && !isDisabled;

  return (
    <div
      data-testid="app-audio-row"
      data-state={session.state}
      data-muted={isMuted}
      data-dragging={isDragging}
      className={cn(
        'group bg-secondary/15 flex items-center gap-2.5 rounded-lg border border-transparent px-2.5 backdrop-blur-xs',
        isMeterVisible ? 'h-[86px]' : 'h-16',
        'transition-[background-color,border-color,box-shadow] duration-[140ms] ease-[var(--ease-standard)]',
        // Hover lifts the row onto the master card's surface, so the two read as one family of
        // control rather than two. Rest stays quieter than the master: the card it is borrowing
        // outranks it, and matching at rest as well would flatten that.
        'hover:bg-card hover:border-border hover:backdrop-blur-md hover:card-raised hover:shadow-xs',
        // No focus ring on the row. Dragging the slider put a blue rectangle around the whole
        // row for the length of the drag, which read as an error state on the thing being
        // adjusted. Keyboard focus is shown where it actually is: on the thumb and on the glyph.
        'animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none',
        isDragging && 'bg-card backdrop-blur-md border-border shadow-e2',
        isExpired && 'pointer-events-none opacity-50',
        isUncontrollable && 'opacity-60',
      )}
    >
      <AppIcon
        session={session}
        className={cn(
          'shrink-0 transition-[filter,opacity] duration-200 ease-[var(--ease-standard)]',
          isMuted && 'opacity-40 grayscale',
        )}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span
            title={displayName}
            className={cn(
              'text-label min-w-0 flex-1 truncate transition-colors duration-200',
              isMuted && 'text-muted-foreground',
            )}
          >
            {displayName}
          </span>

          {/* Trails the name rather than leading it: in front, it pushed the name out of line
              with the slider below and only for one of the six row states. */}
          {isExpired && (
            <span
              aria-hidden="true"
              data-testid="device-lost-dot"
              className="bg-destructive size-1.5 shrink-0 rounded-full"
            />
          )}

          {isMuted && !isUncontrollable && (
            <span
              data-testid="muted-chip"
              className={cn(
                CHIP,
                'text-destructive-text bg-destructive/10 border-destructive/25',
                'animate-in fade-in slide-in-from-right-1 duration-200 motion-reduce:animate-none',
              )}
            >
              MUTED
            </span>
          )}

          {isUncontrollable && (
            <span
              data-testid="uncontrollable-chip"
              title="Somul can hear this app but is not carrying its volume yet. If it stays this way, allow Somul under System Settings, Privacy and Security, Audio Recording."
              className={cn(CHIP, 'text-muted-foreground bg-secondary/90 border-border/50')}
            >
              NO CONTROL
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            data-testid="mute-toggle"
            disabled={isDisabled}
            onClick={onMuteToggle}
            aria-label={`${isMuted ? 'Unmute' : 'Mute'} ${displayName}`}
            aria-pressed={isMuted}
            className={cn(
              // No tile behind it: the logo beside it already carries the app's identity, and a
              // second filled square in the same row would compete with it.
              'flex size-7 shrink-0 items-center justify-center rounded-sm outline-none',
              'transition-[transform,color] duration-[140ms] ease-[var(--ease-standard)]',
              'active:scale-90 motion-reduce:active:scale-100',
              'focus-visible:ring-ring focus-visible:ring-2',
              'disabled:pointer-events-none disabled:opacity-50',
              isMuted ? 'text-destructive-text' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <VolumeIcon key={volumeIconState} size={16} strokeWidth={1.75} className={GLYPH_SWAP} />
          </button>

          <VolumeSlider
            volume={volume}
            label={`Volume for ${displayName}`}
            isMuted={isMuted}
            isDisabled={isDisabled}
            onVolumeChange={onVolumeChange}
            onVolumeCommit={onVolumeCommit}
            className="min-w-0 flex-1"
          />

          {/* Fixed width so every row's slider ends on the same x. Hugging the text left the
              track a different length in each row, which is what made the list look ragged. */}
          <span
            className={cn(
              'text-numeric w-8 shrink-0 text-right font-medium transition-colors duration-200',
              isMuted || isUncontrollable ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {isUncontrollable ? '—' : formatPercent(volume)}
          </span>
        </div>

        {isMeterVisible && (
          <PeakMeter sessionId={session.sessionId} isMuted={isMuted} className="mt-0.5" />
        )}
      </div>
    </div>
  );
};
