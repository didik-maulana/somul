import type { FC } from 'react';

import { cn } from '@/lib/utils';

export interface UpdateProgressBarProps {
  /** 0–1, or null for a download the server gave no length for. */
  fraction: number | null;
  className?: string;
}

/**
 * Shared by the panel's notice and the release-notes window, so a download looks the same
 * wherever the user happens to be watching it.
 */
export const UpdateProgressBar: FC<UpdateProgressBarProps> = ({ fraction, className }) => {
  const percent = fraction === null ? null : Math.round(fraction * 100);

  return (
    <div
      role="progressbar"
      aria-label="Downloading the update"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(percent === null ? {} : { 'aria-valuenow': percent })}
      className={cn('bg-secondary h-[3px] overflow-hidden rounded-full', className)}
    >
      {/* An unmeasured download animates instead of sitting at zero: the server sent no length,
          and a bar frozen at the left edge reads as a stalled transfer. */}
      <div
        data-testid="update-progress"
        className={cn(
          'bg-primary h-full rounded-full',
          percent === null
            ? 'w-1/3 animate-[update-progress-sweep_1.4s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:animate-none'
            : 'transition-[width] duration-300 ease-out motion-reduce:transition-none',
        )}
        style={percent === null ? undefined : { width: `${percent.toString()}%` }}
      />
    </div>
  );
};
