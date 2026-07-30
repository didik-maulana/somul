import { useCallback, useEffect } from 'react';

import {
  getAudioSessions,
  getPlatformCapabilities,
  onSessionsChanged,
  setSessionMute,
  setSessionVolume,
  toAudioError,
} from '@/lib/ipc';
import { useAudioStore } from '@/stores/audioStore';
import type { AudioSession, SessionId } from '@/types/ipc';

export interface AudioSessions {
  sessions: AudioSession[];
  hasPerAppVolume: boolean;
  refresh: () => void;
  changeVolume: (sessionId: SessionId, volume: number) => void;
  commitVolume: (sessionId: SessionId, volume: number) => Promise<void>;
  toggleMute: (session: AudioSession) => Promise<void>;
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

  return {
    sessions,
    hasPerAppVolume,
    refresh,
    changeVolume,
    commitVolume,
    toggleMute,
    startDragging,
    stopDragging,
  };
};
