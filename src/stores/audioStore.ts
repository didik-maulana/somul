import { create } from 'zustand';

import type {
  AudioDevice,
  AudioSession,
  DeviceId,
  MasterState,
  PlatformCapabilities,
  SessionId,
} from '@/types/ipc';

/**
 * ARCHITECTURE.md §9.
 *
 * Peaks are **absent from this store by construction**. They arrive at 30 Hz, and routing them
 * through Zustand would re-render every subscriber thirty times a second. They live in refs
 * driven by the shared rAF loop instead — see `usePeakStream`.
 */
export interface AudioStoreState {
  sessions: AudioSession[];
  devices: AudioDevice[];
  master: MasterState | null;
  capabilities: PlatformCapabilities | null;
  /** Sessions currently under the pointer. Incoming events must not overwrite their volume. */
  draggingSessionIds: ReadonlySet<SessionId>;

  replaceSessions: (sessions: AudioSession[]) => void;
  setSessionVolume: (sessionId: SessionId, volume: number) => void;
  setSessionMuted: (sessionId: SessionId, isMuted: boolean) => void;
  setDevices: (devices: AudioDevice[]) => void;
  setMaster: (master: MasterState) => void;
  setCapabilities: (capabilities: PlatformCapabilities) => void;
  startDragging: (sessionId: SessionId) => void;
  stopDragging: (sessionId: SessionId) => void;
}

/**
 * The reconciliation rule (§9). While a session is being dragged, an incoming
 * `audio://sessions-changed` must not overwrite that session's volume — the pointer is
 * authoritative until release. Without this the backend's echo of the *previous* value lands
 * mid-drag and the slider stutters backwards under the user's finger.
 *
 * Everything else about the session still updates: name, mute, state, and device all come from
 * the event. Only `volume` is held back, and only for sessions being dragged.
 */
export const mergeSessions = (
  incoming: AudioSession[],
  previous: AudioSession[],
  draggingSessionIds: ReadonlySet<SessionId>,
): AudioSession[] => {
  if (draggingSessionIds.size === 0) {
    return incoming;
  }

  const previousById = new Map(previous.map((session) => [session.sessionId, session]));

  return incoming.map((session) => {
    if (!draggingSessionIds.has(session.sessionId)) {
      return session;
    }

    const held = previousById.get(session.sessionId);

    return held === undefined ? session : { ...session, volume: held.volume };
  });
};

const withSession = (
  sessions: AudioSession[],
  sessionId: SessionId,
  update: (session: AudioSession) => AudioSession,
): AudioSession[] =>
  sessions.map((session) => (session.sessionId === sessionId ? update(session) : session));

export const useAudioStore = create<AudioStoreState>()((set) => ({
  sessions: [],
  devices: [],
  master: null,
  capabilities: null,
  draggingSessionIds: new Set<SessionId>(),

  replaceSessions: (sessions) => {
    set((state) => ({
      sessions: mergeSessions(sessions, state.sessions, state.draggingSessionIds),
    }));
  },

  setSessionVolume: (sessionId, volume) => {
    set((state) => ({
      sessions: withSession(state.sessions, sessionId, (session) => ({ ...session, volume })),
    }));
  },

  setSessionMuted: (sessionId, isMuted) => {
    set((state) => ({
      sessions: withSession(state.sessions, sessionId, (session) => ({ ...session, isMuted })),
    }));
  },

  setDevices: (devices) => {
    set({ devices });
  },

  setMaster: (master) => {
    set({ master });
  },

  setCapabilities: (capabilities) => {
    set({ capabilities });
  },

  startDragging: (sessionId) => {
    set((state) => {
      const next = new Set(state.draggingSessionIds);
      next.add(sessionId);
      return { draggingSessionIds: next };
    });
  },

  stopDragging: (sessionId) => {
    set((state) => {
      const next = new Set(state.draggingSessionIds);
      next.delete(sessionId);
      return { draggingSessionIds: next };
    });
  },
}));

export const selectDefaultDeviceId = (state: AudioStoreState): DeviceId | null =>
  state.devices.find((device) => device.isDefault)?.deviceId ?? null;
