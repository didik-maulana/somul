import type { FC } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';

import { AppIcon } from '@/features/mixer/components/AppIcon';
import { SpeakerRing } from '@/features/mixer/components/SpeakerRing';
import type { PeakStream } from '@/features/mixer/hooks/usePeakStream';
import { cn } from '@/lib/utils';
import type { AudioSession } from '@/types/ipc';

export interface AppSpeakerProps {
  session: AudioSession;
  /** Absent when the platform has no per-app metering — the ring then never renders. */
  peakStream?: PeakStream;
  isDisabled?: boolean;
  onMuteToggle: () => void;
}

/**
 * One app's logo, its mute control, and its live level, in a single 32 px tile.
 *
 * The logo *is* the button rather than sitting next to one: a row carrying both would offer two
 * controls for the same action. Mute is therefore never hover-only state — a muted tile keeps its
 * glyph and its destructive tint at rest, and only the unmuted tile reveals the glyph on hover.
 *
 * The `aria-label` names the app rather than the bare action: a screen-reader user moving through
 * twelve rows hears twelve identical "Mute" buttons otherwise.
 */
export const AppSpeaker: FC<AppSpeakerProps> = ({
  session,
  peakStream,
  isDisabled = false,
  onMuteToggle,
}) => {
  const { displayName, isMuted, sessionId, volume } = session;
  const Icon = isMuted ? VolumeX : volume > 0.5 ? Volume2 : Volume1;

  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-label={`${isMuted ? 'Unmute' : 'Mute'} ${displayName}`}
      aria-pressed={isMuted}
      onClick={onMuteToggle}
      data-testid="app-speaker"
      data-muted={isMuted}
      className="group/speaker relative shrink-0 rounded-md outline-none transition-transform duration-150 active:scale-90"
    >
      {/* A muted app has no level to show, and an expired one has no stream behind it. */}
      {peakStream && !isMuted && !isDisabled && (
        <SpeakerRing sessionId={sessionId} stream={peakStream} />
      )}

      <AppIcon session={session} className={cn(isMuted && 'opacity-40 grayscale')} />

      <span
        aria-hidden="true"
        data-testid="app-speaker-glyph"
        className={cn(
          'absolute inset-0 flex items-center justify-center rounded-md transition-opacity duration-[80ms] ease-[var(--ease-standard)]',
          isMuted
            ? 'text-destructive bg-destructive/10 opacity-100'
            : 'text-foreground bg-background/80 opacity-0 group-hover/speaker:opacity-100 group-focus-visible/speaker:opacity-100',
        )}
      >
        <Icon size={16} strokeWidth={1.75} />
      </span>
    </button>
  );
};
