import type { FC } from 'react';

import { Button } from '@/components/ui/button';
import { ReleaseNotes } from '@/features/update/components/ReleaseNotes';
import { UpdateProgressBar } from '@/features/update/components/UpdateProgressBar';
import { useUpdate } from '@/features/update/hooks/useUpdate';

/**
 * The release-notes window.
 *
 * A separate window rather than a panel view, because the panel dismisses itself whenever focus
 * moves elsewhere. A changelog is read at the reader's pace, usually beside whatever they were
 * already doing, and one that vanishes on the first click into another application cannot be read
 * at all.
 *
 * Fixed header, scrolling notes, fixed action bar: the decision the window exists to support
 * stays reachable however long the notes run.
 */
export const UpdateWindow: FC = () => {
  const update = useUpdate();
  const { phase, currentVersion, availableVersion, notes, downloadFraction } = update.status;

  const isInstalled = phase === 'installed';
  const isInstalling = phase === 'installing';

  return (
    <div className="bg-background text-foreground flex h-[100dvh] flex-col">
      <header
        data-tauri-drag-region
        className="border-border flex shrink-0 flex-col gap-1 border-b px-5 pt-5 pb-4"
      >
        <h1 className="text-title font-semibold">
          {isInstalled ? 'Update installed' : 'Somul update'}
        </h1>

        <p className="text-caption text-muted-foreground">
          {availableVersion ? (
            <>
              <span className="font-mono">{availableVersion}</span>
              {currentVersion && (
                <>
                  {' is available. You have '}
                  <span className="font-mono">{currentVersion}</span>.
                </>
              )}
            </>
          ) : (
            'No update is waiting.'
          )}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {notes ? (
          <ReleaseNotes notes={notes} />
        ) : (
          <p className="text-caption text-muted-foreground">
            This release was published without notes.
          </p>
        )}
      </div>

      <footer className="border-border flex shrink-0 items-center gap-2 border-t px-5 py-3.5">
        {isInstalling && (
          <div className="flex flex-1 items-center gap-3">
            <UpdateProgressBar fraction={downloadFraction} className="flex-1" />
            <span className="text-caption text-muted-foreground w-9 shrink-0 text-right font-mono">
              {downloadFraction === null
                ? ''
                : `${Math.round(downloadFraction * 100).toString()}%`}
            </span>
          </div>
        )}

        {isInstalled && (
          <>
            <p className="text-caption text-muted-foreground flex-1">
              Restart to start using it.
            </p>
            <Button type="button" size="sm" onClick={update.restart}>
              Restart now
            </Button>
          </>
        )}

        {!isInstalling && !isInstalled && availableVersion && (
          <>
            <p className="text-caption text-muted-foreground flex-1">
              Somul keeps running while it downloads.
            </p>
            <Button type="button" size="sm" onClick={update.install}>
              Install update
            </Button>
          </>
        )}

        {!isInstalling && !isInstalled && !availableVersion && (
          <>
            <p className="text-caption text-muted-foreground flex-1">
              {phase === 'failed'
                ? 'Could not reach the update server.'
                : 'Somul is up to date.'}
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={update.check}>
              Check again
            </Button>
          </>
        )}
      </footer>
    </div>
  );
};
