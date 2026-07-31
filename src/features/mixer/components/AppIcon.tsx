import { useState, type FC } from 'react';

import { cn } from '@/lib/utils';
import type { AudioSession } from '@/types/ipc';

export interface AppIconProps {
  session: AudioSession;
  className?: string;
}

const initialOf = (session: AudioSession): string => {
  const source = session.displayName.trim() || session.processName.trim();

  return source.charAt(0).toUpperCase() || '?';
};

/**
 * The OS-supplied process icon, with a tile fallback.
 *
 * Two different failures land on the same tile: the backend reports no icon at all, and the data
 * URI it does report fails to decode. Only the first is visible to a null check, so `onError` is
 * what catches the second — otherwise a broken URI leaves a torn-image glyph in the row.
 */
export const AppIcon: FC<AppIconProps> = ({ session, className }) => {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const { iconDataUri } = session;

  if (iconDataUri !== null && iconDataUri !== failedUri) {
    return (
      <img
        src={iconDataUri}
        alt=""
        aria-hidden="true"
        data-testid="app-icon"
        onError={() => {
          setFailedUri(iconDataUri);
        }}
        className={cn('size-8 rounded-md object-contain', className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      data-testid="app-icon-fallback"
      className={cn(
        'relative flex size-8 items-center justify-center overflow-hidden rounded-md',
        className,
      )}
    >
      {/* A surface rather than a stroke icon, which is why §8 permits the signature gradient here.
          The 20% belongs to the gradient layer alone — on the tile it would fade the initial with
          it and leave the letter below the contrast floor. */}
      <span className="bg-signature absolute inset-0 opacity-20" />
      <span className="text-label text-foreground relative">{initialOf(session)}</span>
    </span>
  );
};
