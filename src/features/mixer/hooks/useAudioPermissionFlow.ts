import { useCallback, useState } from 'react';

import { openAudioPermissionSettings, relaunchApp } from '@/lib/ipc';
import type { PlatformCapabilities } from '@/types/ipc';

/**
 * Where the user is in the walk from a withheld permission to a working panel.
 *
 * `unrequested` — the notice has been shown and nothing has been asked for yet.
 * `awaiting` — System Settings was opened, and the backend is still re-asking macOS.
 * `relaunchRequired` — the retries came back with the same answer, so only a new process is left.
 */
export type AudioPermissionPhase = 'unrequested' | 'awaiting' | 'relaunchRequired';

export interface AudioPermissionFlow {
  phase: AudioPermissionPhase;
  openSettings: () => void;
  relaunch: () => void;
}

/**
 * Splits "the grant has not arrived yet" from "this process will never see it".
 *
 * Neither side can answer that alone. The backend knows whether asking macOS again has stopped
 * changing anything, and nothing else does; this hook knows whether the user was ever sent to
 * System Settings, and the backend has no way to find out. Offering a relaunch on the backend's
 * evidence alone would tell a user who has not granted anything to restart, which fixes nothing
 * and reads as the app flailing.
 *
 * Everything here is a consequence of one macOS behaviour: a tap that is refused capture is
 * created anyway, reports channels, and returns silence, and the refusal is settled per process.
 * So the panel cannot detect the grant directly, and cannot pick it up without restarting.
 */
export const useAudioPermissionFlow = (
  capabilities: PlatformCapabilities | null,
): AudioPermissionFlow => {
  const [hasOpenedSettings, setHasOpenedSettings] = useState(false);

  const needsPermission = capabilities?.needsAudioPermission ?? false;

  // Adjusted during render rather than in an effect. This is state derived from the permission,
  // and an effect would render the stale phase first and correct it on a second pass — which for
  // one frame is the relaunch offer shown to someone whose permission has just started working.
  const [wasNeedingPermission, setWasNeedingPermission] = useState(needsPermission);

  if (wasNeedingPermission !== needsPermission) {
    setWasNeedingPermission(needsPermission);

    // The permission landed, so the walk is over. Cleared rather than left set, because it can be
    // revoked again in the same run and the second notice has to start from the beginning — a
    // user who has not been to System Settings this time round is not waiting on anything.
    if (!needsPermission) {
      setHasOpenedSettings(false);
    }
  }

  const openSettings = useCallback(() => {
    setHasOpenedSettings(true);
    void openAudioPermissionSettings();
  }, []);

  const relaunch = useCallback(() => {
    void relaunchApp();
  }, []);

  const phase: AudioPermissionPhase = !needsPermission || !hasOpenedSettings
    ? 'unrequested'
    : capabilities?.hasExhaustedCaptureRetries
      ? 'relaunchRequired'
      : 'awaiting';

  return { phase, openSettings, relaunch };
};
