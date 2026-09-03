import { useCallback, useEffect } from 'react';

import {
  getAudioSessions,
  getPlatformCapabilities,
  onCapabilitiesChanged,
  onSessionsChanged,
  setSessionMute,
  setSessionOutputDevice,
  setSessionVolume,
  toAudioError,
} from '@/lib/ipc';
import { useAudioStore } from '@/stores/audioStore';
import type { AudioSession, DeviceId, SessionId } from '@/types/ipc';

export interface AudioSessions {
  sessions: AudioSession[];
  hasPerAppVolume: boolean;
  refresh: () => void;
  changeVolume: (sessionId: SessionId, volume: number) => void;
  commitVolume: (sessionId: SessionId, volume: number) => Promise<void>;
  toggleMute: (session: AudioSession) => Promise<void>;
  /** Null sends the app back to following the system default. */
  routeSession: (sessionId: SessionId, deviceId: DeviceId | null) => Promise<void>;
  startDragging: (sessionId: SessionId) => void;
  stopDragging: (sessionId: SessionId) => void;
}

/**
 * Owns the session list and its IPC traffic.
 *
 * Components never call `invoke`. Everything here goes through `lib/ipc.ts`, which is the only
 * file allowed to import `@tauri-apps/api`.
 */
export const useAudioSessions = (): AudioSessions => {
  const sessions = useAudioStore((state) => state.sessions);
  const capabilities = useAudioStore((state) => state.capabilities);
  const replaceSessions = useAudioStore((state) => state.replaceSessions);
  const setCapabilities = useAudioStore((state) => state.setCapabilities);
  const setSessionVolumeLocally = useAudioStore((state) => state.setSessionVolume);
  const setSessionMutedLocally = useAudioStore((state) => state.setSessionMuted);
  const startDragging = useAudioStore((state) => state.startDragging);
  const stopDragging = useAudioStore((state) => state.stopDragging);

  const hasPerAppVolume = capabilities?.hasPerAppVolume ?? false;

  const refresh = useCallback(() => {
    void getAudioSessions()
      .then(replaceSessions)
      .catch(() => {
        // An unsupported platform is expected here — the capability gate renders the
        // notice instead, and there is no session list to show.
        replaceSessions([]);
      });
  }, [replaceSessions]);

  useEffect(() => {
    void getPlatformCapabilities().then(setCapabilities).catch(() => undefined);
  }, [setCapabilities]);

  // The first read is a starting point, not the answer. Whether Somul has been allowed to hear
  // the apps it can see is settled seconds later, and only the backend knows when.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isCancelled = false;

    void onCapabilitiesChanged(setCapabilities)
      .then((stop) => {
        if (isCancelled) {
          stop();
          return;
        }

        unlisten = stop;
      })
      .catch(() => undefined);

    return () => {
      isCancelled = true;
      unlisten?.();
    };
  }, [setCapabilities]);

  useEffect(() => {
    if (!hasPerAppVolume) {
      return;
    }

    refresh();
  }, [hasPerAppVolume, refresh]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isCancelled = false;

    void onSessionsChanged(replaceSessions).then((stop) => {
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
  }, [replaceSessions]);

  /** Optimistic and authoritative during a drag — the pointer wins, with no round trip. */
  const changeVolume = useCallback(
    (sessionId: SessionId, volume: number) => {
      setSessionVolumeLocally(sessionId, volume);
    },
    [setSessionVolumeLocally],
  );

  const commitVolume = useCallback(async (sessionId: SessionId, volume: number) => {
    try {
      await setSessionVolume(sessionId, volume);
    } catch (thrown) {
      // SessionNotFound means the app closed mid-write. The row leaves on the next
      // sessions-changed event; surfacing an error here would be noise.
      if (toAudioError(thrown).kind !== 'sessionNotFound') {
        throw thrown;
      }
    }
  }, []);

  const toggleMute = useCallback(
    async (session: AudioSession) => {
      const next = !session.isMuted;

      setSessionMutedLocally(session.sessionId, next);

      try {
        await setSessionMute(session.sessionId, next);
      } catch (thrown) {
        if (toAudioError(thrown).kind !== 'sessionNotFound') {
          setSessionMutedLocally(session.sessionId, session.isMuted);
          throw thrown;
        }
      }
    },
    [setSessionMutedLocally],
  );

  // Refreshed rather than patched locally: routing rebuilds the mix, and the backend is the only
  // thing that knows where each app actually landed once a destination refuses.
  const routeSession = useCallback(
    async (sessionId: SessionId, deviceId: DeviceId | null) => {
      await setSessionOutputDevice(sessionId, deviceId);
      refresh();
    },
    [refresh],
  );

  return {
    sessions,
    hasPerAppVolume,
    refresh,
    routeSession,
    changeVolume,
    commitVolume,
    toggleMute,
    startDragging,
    stopDragging,
  };
};
