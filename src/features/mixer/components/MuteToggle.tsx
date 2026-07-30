import type React from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface MuteToggleProps {
  isMuted: boolean;
  /** Linear scalar 0.0–1.0 — picks the glyph below or above 50% (DESIGN.md §9.7). */
  volume: number;
  /** The app this control belongs to. Names the button "Mute Spotify", not "Mute" (§11). */
  appName: string;
  isDisabled?: boolean;
  onMuteToggle: () => void;
  className?: string;
}

/**
 * DESIGN.md §9.7 — a 28 px icon button at `radius-sm`.
 *
 * The `aria-label` names the app rather than the bare action (§11): a screen-reader user moving
 * through twelve rows hears twelve identical "Mute" buttons otherwise.
 */
export const MuteToggle: React.FC<MuteToggleProps> = ({
  isMuted,
  volume,
  appName,
  isDisabled = false,
  onMuteToggle,
  className,
}) => {
  const Icon = isMuted ? VolumeX : volume > 0.5 ? Volume2 : Volume1;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={isDisabled}
      aria-label={`${isMuted ? 'Unmute' : 'Mute'} ${appName}`}
      aria-pressed={isMuted}
      onClick={onMuteToggle}
      className={cn(
        'hover:bg-accent size-7 rounded-sm transition-transform duration-[260ms] ease-[var(--ease-spring)]',
        isMuted && 'text-destructive bg-destructive/10 hover:bg-destructive/10',
        className,
      )}
    >
      <Icon size={16} strokeWidth={1.75} />
    </Button>
  );
};
