import type { FC } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { UpdateProgressBar } from '@/features/update/components/UpdateProgressBar';
import type { UpdateStatus } from '@/features/update/types';

export interface UpdateNoticeProps {
  status: UpdateStatus;
  onInstall: () => void;
  onRestart: () => void;
  onShowNotes: () => void;
  onDismiss: () => void;
}

/**
 * The panel's update notice.
 *
 * Not a card. The panel already separates its own regions with a hairline — the header rule, the
 * footer rule — so the notice uses the same one and belongs to the panel instead of sitting on top
 * of it in a container of its own. Earlier versions boxed it, tinted the box, and ran a coloured
 * rule down its edge; none of that carried meaning, and colour spent on decoration is exactly what
 * makes a surface read as an advertisement rather than part of the app.
 *
 * The only colour left is the Update button, which is an action, and the progress fill, which is
 * data. Everything else is type and spacing.
 *
 * The changelog is not here. It lives in a window that survives the panel dismissing itself.
 */
export const UpdateNotice: FC<UpdateNoticeProps> = ({
  status,
  onInstall,
  onRestart,
  onShowNotes,
  onDismiss,
}) => {
  const isInstalling = status.phase === 'installing';
  const isInstalled = status.phase === 'installed';

  const headline = isInstalled
    ? 'Update ready'
    : isInstalling
      ? 'Downloading update'
      : 'Update available';

  const percent =
    status.downloadFraction === null ? null : Math.round(status.downloadFraction * 100);

  return (
    <div
      data-testid="update-notice"
      className="border-border animate-[update-notice-in_180ms_var(--ease-decelerate)] motion-reduce:animate-none mb-2 flex flex-col gap-1.5 border-b px-0.5 pb-2.5"
    >
      <div role="status" className="flex items-center gap-2">
        <p className="text-label min-w-0 flex-1 truncate">
          {headline}
          {status.availableVersion && (
            <span className="text-micro text-muted-foreground ml-1.5 font-mono">
              {status.availableVersion}
            </span>
          )}
        </p>

        {!isInstalling && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground -mr-1 shrink-0"
            aria-label="Dismiss update notice"
            onClick={onDismiss}
          >
            <X size={12} strokeWidth={2} aria-hidden="true" />
          </Button>
        )}
      </div>

      {isInstalling ? (
        <div className="flex items-center gap-2.5 py-1">
          <UpdateProgressBar fraction={status.downloadFraction} className="flex-1" />
          <span className="text-micro text-muted-foreground w-8 shrink-0 text-right font-mono">
            {percent === null ? '' : `${percent.toString()}%`}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="xs"
            className="transition-transform active:scale-95"
            onClick={isInstalled ? onRestart : onInstall}
          >
            {isInstalled ? 'Restart now' : 'Update'}
          </Button>

          {isInstalled ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground hover:text-foreground"
              onClick={onDismiss}
            >
              Later
            </Button>
          ) : (
            status.notes && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-muted-foreground hover:text-foreground"
                onClick={onShowNotes}
              >
                What's new
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
};
