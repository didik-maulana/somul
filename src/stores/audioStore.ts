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
  /** True while the master slider is under the pointer. Same rule as `draggingSessionIds`. */
  isDraggingMaster: boolean;

  replaceSessions: (sessions: AudioSession[]) => void;
  setSessionVolume: (sessionId: SessionId, volume: number) => void;
  setSessionMuted: (sessionId: SessionId, isMuted: boolean) => void;
  setDevices: (devices: AudioDevice[]) => void;
  setMaster: (master: MasterState) => void;
  setMasterVolume: (volume: number) => void;
  startDraggingMaster: () => void;
  stopDraggingMaster: () => void;
  setCapabilities: (capabilities: PlatformCapabilities) => void;
  startDragging: (sessionId: SessionId) => void;
  stopDragging: (sessionId: SessionId) => void;
}

/**
 * The reconciliation rule. While a session is being dragged, an incoming
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

/**
 * The master counterpart to {@link mergeSessions}.
 *
 * The backend polls the system output while the panel is open, so an external volume change
 * arrives as an event. During a drag that event carries the *previous* value and would yank the
 * thumb backwards under the pointer, so volume is held until the drag ends. Mute and device still
 * apply — only the value the user is actively holding is protected.
 */
export const mergeMaster = (
  incoming: MasterState,
  previous: MasterState | null,
  isDraggingMaster: boolean,
): MasterState => {
  if (!isDraggingMaster || previous === null) {
    return incoming;
  }

  return { ...incoming, volume: previous.volume };
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
  isDraggingMaster: false,

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
    set((state) => ({
      master: mergeMaster(master, state.master, state.isDraggingMaster),
    }));
  },

  /** Optimistic write from the user's own drag — bypasses the merge rule by design. */
  setMasterVolume: (volume) => {
    set((state) => ({
      master: state.master ? { ...state.master, volume } : null,
    }));
  },

  startDraggingMaster: () => {
    set({ isDraggingMaster: true });
  },

  stopDraggingMaster: () => {
    set({ isDraggingMaster: false });
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
