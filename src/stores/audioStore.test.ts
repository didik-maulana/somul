import { beforeEach, describe, expect, it } from 'vitest';

import { mergeSessions, useAudioStore } from '@/stores/audioStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { AudioSession, DeviceId, SessionId } from '@/types/ipc';

const spotify = 'mock:session:spotify' as SessionId;
const chrome = 'mock:session:chrome' as SessionId;

const session = (sessionId: SessionId, overrides: Partial<AudioSession> = {}): AudioSession => ({
  sessionId,
  pid: 4821,
  displayName: 'Spotify',
  processName: 'spotify.exe',
  iconDataUri: null,
  volume: 0.5,
  isMuted: false,
  outputDeviceId: 'mock:speakers' as DeviceId,
  state: 'active',
  ...overrides,
});

beforeEach(() => {
  useAudioStore.setState({
    sessions: [],
    devices: [],
    master: null,
    capabilities: null,
    draggingSessionIds: new Set<SessionId>(),
  });
});

describe('audioStore', () => {
  it('replaces the session list wholesale on a change event', () => {
    const { replaceSessions } = useAudioStore.getState();

    replaceSessions([session(spotify), session(chrome)]);

    expect(useAudioStore.getState().sessions).toHaveLength(2);

    replaceSessions([session(chrome)]);

    expect(useAudioStore.getState().sessions.map((each) => each.sessionId)).toEqual([chrome]);
  });

  it('tracks which sessions are being dragged', () => {
    const { startDragging, stopDragging } = useAudioStore.getState();

    startDragging(spotify);
    expect(useAudioStore.getState().draggingSessionIds.has(spotify)).toBe(true);

    stopDragging(spotify);
    expect(useAudioStore.getState().draggingSessionIds.has(spotify)).toBe(false);
  });

  /**
   * Written so that deleting the merge rule makes it fail: `mergeSessions` would return the
   * incoming 0.2 and the drag would visibly stutter backwards under the user's finger.
   */
  it('does not let an incoming event overwrite the volume of a dragging session', () => {
    const { replaceSessions, startDragging, setSessionVolume } = useAudioStore.getState();

    replaceSessions([session(spotify, { volume: 0.5 }), session(chrome, { volume: 0.5 })]);

    startDragging(spotify);
    setSessionVolume(spotify, 0.9);

    replaceSessions([session(spotify, { volume: 0.2 }), session(chrome, { volume: 0.2 })]);

    const sessions = useAudioStore.getState().sessions;

    expect(sessions.find((each) => each.sessionId === spotify)?.volume).toBe(0.9);
    expect(sessions.find((each) => each.sessionId === chrome)?.volume).toBe(0.2);
  });

  it('accepts backend volume again once the drag ends', () => {
    const { replaceSessions, startDragging, stopDragging, setSessionVolume } =
      useAudioStore.getState();

    replaceSessions([session(spotify, { volume: 0.5 })]);
    startDragging(spotify);
    setSessionVolume(spotify, 0.9);
    stopDragging(spotify);

    replaceSessions([session(spotify, { volume: 0.2 })]);

    expect(useAudioStore.getState().sessions[0]?.volume).toBe(0.2);
  });

  /** Only volume is held back — everything else about a dragging session still updates. */
  it('still applies non-volume updates to a dragging session', () => {
    const { replaceSessions, startDragging, setSessionVolume } = useAudioStore.getState();

    replaceSessions([session(spotify, { volume: 0.5 })]);
    startDragging(spotify);
    setSessionVolume(spotify, 0.9);

    replaceSessions([
      session(spotify, { volume: 0.2, isMuted: true, state: 'expired', displayName: 'Spotify Free' }),
    ]);

    const held = useAudioStore.getState().sessions[0];

    expect(held.volume).toBe(0.9);
    expect(held.isMuted).toBe(true);
    expect(held.state).toBe('expired');
    expect(held.displayName).toBe('Spotify Free');
  });

  it('drops a dragging session that disappeared from the incoming list', () => {
    const { replaceSessions, startDragging } = useAudioStore.getState();

    replaceSessions([session(spotify), session(chrome)]);
    startDragging(spotify);
    replaceSessions([session(chrome)]);

    expect(useAudioStore.getState().sessions.map((each) => each.sessionId)).toEqual([chrome]);
  });

  it('takes a newly appeared session as-is even while another drags', () => {
    const { replaceSessions, startDragging } = useAudioStore.getState();

    replaceSessions([session(spotify, { volume: 0.5 })]);
    startDragging(spotify);
    replaceSessions([session(spotify, { volume: 0.2 }), session(chrome, { volume: 0.7 })]);

    const sessions = useAudioStore.getState().sessions;

    expect(sessions.find((each) => each.sessionId === chrome)?.volume).toBe(0.7);
  });

  /** Peaks never enter the store — they would re-render every subscriber 30 times a second. */
  it('has no peak field anywhere in its state', () => {
    const keys = Object.keys(useAudioStore.getState());

    expect(keys.filter((key) => key.toLowerCase().includes('peak'))).toEqual([]);
  });
});

describe('mergeSessions', () => {
  it('returns the incoming list untouched when nothing is dragging', () => {
    const incoming = [session(spotify, { volume: 0.2 })];

    expect(mergeSessions(incoming, [session(spotify, { volume: 0.9 })], new Set())).toBe(incoming);
  });

  it('holds the previous volume for a dragging session', () => {
    const merged = mergeSessions(
      [session(spotify, { volume: 0.2 })],
      [session(spotify, { volume: 0.9 })],
      new Set([spotify]),
    );

    expect(merged[0]?.volume).toBe(0.9);
  });
});

describe('settingsStore', () => {
  it('defaults to the documented hotkey and system theme', () => {
    const state = useSettingsStore.getState();

    expect(state.hotkey).toBe('CmdOrCtrl+Shift+V');
    expect(state.theme).toBe('system');
    expect(state.hotkeyWarning).toBeNull();
  });

  it('records a hotkey registration warning', () => {
    useSettingsStore.getState().setHotkeyWarning('Another app owns that shortcut');

    expect(useSettingsStore.getState().hotkeyWarning).toBe('Another app owns that shortcut');

    useSettingsStore.getState().setHotkeyWarning(null);

    expect(useSettingsStore.getState().hotkeyWarning).toBeNull();
  });
});
