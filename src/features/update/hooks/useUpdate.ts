import { useCallback, useEffect, useState } from 'react';

import {
  checkForUpdate,
  getUpdateState,
  installUpdate,
  onUpdateChanged,
  onUpdateProgress,
  openUpdateWindow,
  relaunchApp,
} from '@/lib/ipc';
import type { UpdateStatus } from '@/features/update/types';
import type { UpdateSnapshot } from '@/types/ipc';

export interface UpdateOptions {
  /**
   * Whether mounting starts a check.
   *
   * The panel does; the release-notes window must not. That window is opened *from* a result, so
   * checking again on the way in would replace what it was opened to show — reopening it after an
   * install would find the same release still on the endpoint and offer to install it a second
   * time.
   */
  checksOnMount?: boolean;
}

export interface Update {
  status: UpdateStatus;
  /** Whether the panel should carry the "a new version exists" notice. */
  isNoticeVisible: boolean;
  check: () => void;
  install: () => void;
  restart: () => void;
  showNotes: () => void;
  dismissNotice: () => void;
}

/**
 * How long a requested check stays on screen at minimum.
 *
 * A check against a nearby endpoint answers in tens of milliseconds, and a spinner that appears
 * and vanishes inside one frame reads as a glitch rather than as work. Holding the state briefly
 * makes the answer legible; it is a floor on the *display*, never a delay on the result.
 */
const CHECK_MIN_VISIBLE_MS = 600;

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

/**
 * The update, as this window sees it.
 *
 * The phase itself lives in Rust. Two windows show the update — the panel's notice and the
 * release-notes window — and each has its own WebView, so a phase kept in JavaScript would exist
 * twice and disagree with itself the moment one of them installed something.
 *
 * The one piece of state that stays local is the check spinner. A check is something *this*
 * window is waiting on, and announcing it would have the other window flash a spinner for work
 * the user did not ask it to do.
 */
export const useUpdate = ({ checksOnMount = false }: UpdateOptions = {}): Update => {
  const [snapshot, setSnapshot] = useState<UpdateSnapshot | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [downloadFraction, setDownloadFraction] = useState<number | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  const ask = useCallback((minimumVisibleMs = 0) => {
    void Promise.all([checkForUpdate(), wait(minimumVisibleMs)])
      .then(([next]) => {
        setSnapshot(next);
      })
      .catch(() => undefined)
      .finally(() => {
        setIsChecking(false);
      });
  }, []);

  useEffect(() => {
    void getUpdateState()
      .then(setSnapshot)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isCancelled = false;

    void onUpdateChanged(setSnapshot).then((stop) => {
      if (isCancelled) {
        stop();
        return;
      }

      unlisten = stop;
    });

    return () => {
      isCancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isCancelled = false;

    void onUpdateProgress(({ downloaded, total }) => {
      setDownloadFraction(total ? Math.min(downloaded / total, 1) : null);
    }).then((stop) => {
      if (isCancelled) {
        stop();
        return;
      }

      unlisten = stop;
    });

    return () => {
      isCancelled = true;
      unlisten?.();
    };
  }, []);

  // The launch check reports nothing while it runs. It is work the user did not ask for, and
  // announcing it means the settings row opens on a spinner every time the panel is opened early.
  useEffect(() => {
    if (checksOnMount) {
      ask();
    }
  }, [ask, checksOnMount]);

  const check = useCallback(() => {
    setIsDismissed(false);
    setIsChecking(true);
    ask(CHECK_MIN_VISIBLE_MS);
  }, [ask]);

  const install = useCallback(() => {
    setDownloadFraction(null);

    // The phase change comes back as an event, from Rust, so both windows move together.
    void installUpdate().catch(() => undefined);
  }, []);

  const restart = useCallback(() => {
    // Settles only when the restart failed: a successful one replaces this process.
    void relaunchApp().catch(() => undefined);
  }, []);

  const showNotes = useCallback(() => {
    void openUpdateWindow().catch(() => undefined);
  }, []);

  const dismissNotice = useCallback(() => {
    setIsDismissed(true);
  }, []);

  const phase = isChecking ? 'checking' : (snapshot?.phase ?? 'idle');

  return {
    status: {
      phase,
      currentVersion: snapshot?.currentVersion ?? null,
      availableVersion: snapshot?.availableVersion ?? null,
      notes: snapshot?.notes ?? null,
      downloadFraction,
      reason: snapshot?.reason ?? null,
    },
    isNoticeVisible:
      !isDismissed && (phase === 'available' || phase === 'installing' || phase === 'installed'),
    check,
    install,
    restart,
    showNotes,
    dismissNotice,
  };
};
