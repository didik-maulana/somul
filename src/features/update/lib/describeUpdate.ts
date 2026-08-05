import type { UpdateStatus } from '@/features/update/types';

/**
 * One line of plain language for whatever the updater is doing, or nothing when it has nothing to
 * report.
 *
 * Kept out of the components because it is the whole user-visible contract of a state machine with
 * seven states — a `switch` in JSX would be tested only through a rendered button.
 */
export const describeUpdate = (status: UpdateStatus): string | undefined => {
  switch (status.phase) {
    // Says nothing until the launch check answers: the row would otherwise open on a claim the
    // app has not checked, and "Up to date" is exactly the claim not to guess at.
    case 'idle':
      return undefined;
    // No version here. The footer already names the running build, and a row repeating it turns
    // the one line the user reads for update news into a second copy of something else.
    case 'upToDate':
      return 'Up to date';
    case 'checking':
      return 'Checking for a newer version…';
    case 'available':
      return status.availableVersion
        ? `Version ${status.availableVersion} is ready to install`
        : 'A new version is ready to install';
    case 'installing':
      return 'Downloading the update…';
    case 'installed':
      return status.availableVersion
        ? `Version ${status.availableVersion} installed — restart to use it`
        : 'Installed — restart to use it';
    // An unreachable endpoint and a rejected download are both "we could not get you the
    // update", and the difference between them is nothing the user can act on.
    case 'failed':
      return 'Could not reach the update server';
  }
};
