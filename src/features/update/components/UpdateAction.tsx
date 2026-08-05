import type { FC } from 'react';
import { Download, Loader2, RefreshCw, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { UpdateStatus } from '@/features/update/types';

export interface UpdateActionProps {
  status: UpdateStatus;
  onCheck: () => void;
  onInstall: () => void;
  onRestart: () => void;
}

/**
 * The single control in the settings row, following whatever the update needs next: check, then
 * install, then restart.
 *
 * One button rather than three, because no two of them are ever useful at once — offering the
 * check beside a waiting update invites the user to look for what the panel already found.
 *
 * Every state is the same width. The labels are not the same length, and a button that resizes as
 * it changes state drags the row's layout with it, which is the part that reads as flicker.
 */
export const UpdateAction: FC<UpdateActionProps> = ({
  status,
  onCheck,
  onInstall,
  onRestart,
}) => {
  const width = 'w-[5.5rem] shrink-0 justify-center';

  if (status.phase === 'checking' || status.phase === 'installing') {
    return (
      <Button type="button" variant="secondary" size="xs" className={width} disabled>
        <Loader2
          size={12}
          strokeWidth={2}
          aria-hidden="true"
          className="animate-spin motion-reduce:animate-none"
        />
        {status.phase === 'checking' ? 'Checking' : 'Installing'}
      </Button>
    );
  }

  if (status.phase === 'installed') {
    return (
      <Button
        type="button"
        size="xs"
        className={`${width} transition-transform active:scale-95`}
        aria-label="Restart to finish the update"
        onClick={onRestart}
      >
        <RotateCw size={12} strokeWidth={2} aria-hidden="true" />
        Restart
      </Button>
    );
  }

  return status.phase === 'available' ? (
    <Button
      type="button"
      size="xs"
      className={`${width} transition-transform active:scale-95`}
      aria-label="Install update"
      onClick={onInstall}
    >
      <Download size={12} strokeWidth={2} aria-hidden="true" />
      Install
    </Button>
  ) : (
    <Button
      type="button"
      variant="secondary"
      size="xs"
      className={`group ${width} transition-transform active:scale-95`}
      aria-label="Check for updates"
      onClick={onCheck}
    >
      <RefreshCw
        size={12}
        strokeWidth={2}
        aria-hidden="true"
        className="transition-transform duration-500 ease-out group-hover:rotate-180"
      />
      Check
    </Button>
  );
};
