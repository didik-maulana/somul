/**
 * The only file permitted to import from `@tauri-apps/api`, enforced by `no-restricted-imports`
 * in `eslint.config.js` rather than by convention. Everything else consumes these wrappers, which
 * is what lets the whole frontend be tested without a Tauri runtime.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type {
  AppSettings,
  AudioDevice,
  AudioError,
  AudioSession,
  DeviceChangedPayload,
  DeviceId,
  MasterState,
  PlatformCapabilities,
  SessionId,
  SettingsUpdate,
  UpdateProgress,
  UpdateSnapshot,
} from '@/types/ipc';

/**
 * Mirrors the guard on the Rust `SessionId`. An all-digit identifier is a PID or a raw backend
 * index, and neither is stable enough to key a write — the OS reuses both.
 */
export const parseSessionId = (raw: string): SessionId => {
  const trimmed = raw.trim();

  if (trimmed === '') {
    throw new Error('Session identifier is empty');
  }

  if (/^\d+$/.test(trimmed)) {
    throw new Error(
      `Session identifier "${trimmed}" is all digits — a PID is not a session key`,
    );
  }

  return trimmed as SessionId;
};

export const parseDeviceId = (raw: string): DeviceId => raw as DeviceId;

const AUDIO_ERROR_KINDS = [
  'sessionNotFound',
  'deviceNotFound',
  'deviceInvalidated',
  'permissionDenied',
  'unsupported',
  'backendFailure',
] as const;

export const isAudioError = (candidate: unknown): candidate is AudioError => {
  if (typeof candidate !== 'object' || candidate === null || !('kind' in candidate)) {
    return false;
  }

  const { kind } = candidate;

  return AUDIO_ERROR_KINDS.some((known) => known === kind);
};

const describe = (error: AudioError): string =>
  'detail' in error ? `${error.kind}: ${error.detail}` : error.kind;

/**
 * A rejected command carries a structured `AudioError`, never a bare string. The structure
 * travels on `audioError`; the `Error` shell exists so rejections keep a stack trace and behave
 * like every other thrown value in the app.
 */
export class AudioCommandError extends Error {
  readonly audioError: AudioError;

  constructor(audioError: AudioError) {
    super(describe(audioError));
    this.name = 'AudioCommandError';
    this.audioError = audioError;
  }
}

/**
 * Normalizes anything caught at the IPC boundary into an `AudioError`, so callers only ever
 * branch on `kind`. Anything else reaching here is a bug in the handler layer.
 */
export const toAudioError = (thrown: unknown): AudioError => {
  if (thrown instanceof AudioCommandError) {
    return thrown.audioError;
  }

  if (isAudioError(thrown)) {
    return thrown;
  }

  return {
    kind: 'backendFailure',
    detail: thrown instanceof Error ? thrown.message : String(thrown),
  };
};

const command = async <TResult>(
  name: string,
  args?: Record<string, unknown>,
): Promise<TResult> => {
  try {
    return await invoke<TResult>(name, args);
  } catch (thrown) {
    throw new AudioCommandError(toAudioError(thrown));
  }
};

const mutation = async (name: string, args?: Record<string, unknown>): Promise<void> => {
  await command<null>(name, args);
};

export const getPlatformCapabilities = (): Promise<PlatformCapabilities> =>
  command<PlatformCapabilities>('get_platform_capabilities');

export const getAudioSessions = (): Promise<AudioSession[]> =>
  command<AudioSession[]>('get_audio_sessions');

/** `volume` is a linear scalar 0.0–1.0, not a percentage. */
export const setSessionVolume = (sessionId: SessionId, volume: number): Promise<void> =>
  mutation('set_session_volume', { sessionId, volume });

export const setSessionMute = (sessionId: SessionId, isMuted: boolean): Promise<void> =>
  mutation('set_session_mute', { sessionId, isMuted });

export const getMasterState = (): Promise<MasterState> => command<MasterState>('get_master_state');

/** `volume` is a linear scalar 0.0–1.0, not a percentage. */
export const setMasterVolume = (volume: number): Promise<void> =>
  mutation('set_master_volume', { volume });

export const setMasterMute = (isMuted: boolean): Promise<void> =>
  mutation('set_master_mute', { isMuted });

export const listOutputDevices = (): Promise<AudioDevice[]> =>
  command<AudioDevice[]>('list_output_devices');

export const setDefaultOutputDevice = (deviceId: DeviceId): Promise<void> =>
  mutation('set_default_output_device', { deviceId });

/**
 * Starts and stops the meter loop. Not cosmetic — a hidden panel must do no audio work at all,
 * and this call is where that is enforced.
 */
export const setPanelVisibility = (isVisible: boolean): Promise<void> =>
  mutation('set_panel_visibility', { isVisible });

/** v1.1. Present for contract completeness; v1.0 backends reject it with `unsupported`. */
export const setSessionOutputDevice = (
  sessionId: SessionId,
  deviceId: DeviceId,
): Promise<void> => mutation('set_session_output_device', { sessionId, deviceId });

export const getSettings = (): Promise<AppSettings> => command<AppSettings>('get_settings');

/**
 * Persists settings and applies their side effects — registering the hotkey, toggling
 * launch-at-login, updating the pin.
 *
 * Returns what was actually applied, which can differ from what was sent when the OS refuses a
 * hotkey. Render the returned settings, not the ones you passed in.
 */
export const updateSettings = (settings: AppSettings): Promise<SettingsUpdate> =>
  command<SettingsUpdate>('update_settings', { settings });

/**
 * Frees the global shortcut while the user records a replacement.
 *
 * Without this the OS intercepts the currently bound combination and toggles the panel, so the
 * window disappears in the middle of rebinding it.
 */
export const setHotkeyCapture = (isCapturing: boolean): Promise<void> =>
  mutation('set_hotkey_capture', { isCapturing });

/**
 * Matches the window's appearance to the resolved theme.
 *
 * The blur behind the panel follows the window's appearance rather than the CSS, so forcing a
 * theme has to reach the native window too or the surface stays on the other one.
 */
/** `null` hands the window's appearance back to macOS. */
export const setPanelAppearance = (isDark: boolean | null): Promise<void> =>
  mutation('set_panel_appearance', { isDark });

/**
 * What the backend currently knows about the update.
 *
 * Read on mount by both windows: the release-notes window opens after the panel has already
 * checked, so without this it would have to check again to learn what it is showing notes for.
 */
export const getUpdateState = (): Promise<UpdateSnapshot> =>
  command<UpdateSnapshot>('get_update_state');

/** Asks the release endpoint whether a newer signed build exists. */
export const checkForUpdate = (): Promise<UpdateSnapshot> =>
  command<UpdateSnapshot>('check_for_update');

/** Fires in every window whenever the update reaches a new resting state. */
export const onUpdateChanged = (
  onEvent: (snapshot: UpdateSnapshot) => void,
): Promise<UnlistenFn> =>
  listen<UpdateSnapshot>('update://changed', ({ payload }) => {
    onEvent(payload);
  });

/** Opens the release-notes window, or brings the open one forward. */
export const openUpdateWindow = (): Promise<void> => mutation('open_update_window');

/**
 * Installs the update found by the last {@link checkForUpdate}, leaving the running process alone.
 *
 * Resolving means the new build is on disk, not that it is running — {@link relaunchApp} is what
 * puts the user on it, whenever they choose.
 */
export const installUpdate = (): Promise<void> => mutation('install_update');

/** Fires roughly once per percent while {@link installUpdate} downloads. */
export const onUpdateProgress = (
  onEvent: (progress: UpdateProgress) => void,
): Promise<UnlistenFn> =>
  listen<UpdateProgress>('update://progress', ({ payload }) => {
    onEvent(payload);
  });

/**
 * Restarts Somul into a new process.
 *
 * The updater's "Restart now": an installed update sits on disk while the old build keeps running.
 *
 * Settles only when the restart failed — a successful one replaces the running process, taking
 * the promise with it. Treat a resolution as "nothing happened".
 */
export const relaunchApp = (): Promise<void> => mutation('relaunch_app');

/** Opens the Privacy & Security pane where macOS grants audio capture. */
export const openAudioPermissionSettings = (): Promise<void> =>
  mutation('open_audio_permission_settings');

/** Fires every time the tray puts the panel on screen. */
export const PANEL_SHOWN_EVENT = 'panel://shown';

export const onPanelShown = (onEvent: () => void): Promise<UnlistenFn> =>
  listen(PANEL_SHOWN_EVENT, () => {
    onEvent();
  });

export const AUDIO_EVENT = {
  sessionsChanged: 'audio://sessions-changed',
  capabilitiesChanged: 'audio://capabilities-changed',
  masterChanged: 'audio://master-changed',
  masterResync: 'audio://master-resync',
  deviceChanged: 'audio://device-changed',
  backendError: 'audio://backend-error',
} as const;

/**
 * Capabilities are pushed, not polled once.
 *
 * What they report changes on its own: whether an app has been heard yet is a fact about elapsed
 * time rather than about anything the panel did. Read once at startup, the permission state could
 * never appear, because at that moment the taps had only just been created.
 */
export const onCapabilitiesChanged = (
  onEvent: (capabilities: PlatformCapabilities) => void,
): Promise<UnlistenFn> =>
  listen<PlatformCapabilities>(AUDIO_EVENT.capabilitiesChanged, ({ payload }) => {
    onEvent(payload);
  });

/** One batch per tick covering every session — never one emit per session. */
export const onSessionsChanged = (
  onEvent: (sessions: AudioSession[]) => void,
): Promise<UnlistenFn> =>
  listen<AudioSession[]>(AUDIO_EVENT.sessionsChanged, ({ payload }) => {
    onEvent(payload);
  });

export const onMasterChanged = (onEvent: (master: MasterState) => void): Promise<UnlistenFn> =>
  listen<MasterState>(AUDIO_EVENT.masterChanged, ({ payload }) => {
    onEvent(payload);
  });

/**
 * Fires once when the panel opens, carrying the current system state.
 *
 * Separate from {@link onMasterChanged} because the UI applies it instantly rather than easing
 * into it — see the `hasSmoothMotion` prop on the slider.
 */
export const onMasterResync = (onEvent: (master: MasterState) => void): Promise<UnlistenFn> =>
  listen<MasterState>(AUDIO_EVENT.masterResync, ({ payload }) => {
    onEvent(payload);
  });

export const onDeviceChanged = (
  onEvent: (payload: DeviceChangedPayload) => void,
): Promise<UnlistenFn> =>
  listen<DeviceChangedPayload>(AUDIO_EVENT.deviceChanged, ({ payload }) => {
    onEvent(payload);
  });

export const onBackendError = (onEvent: (error: AudioError) => void): Promise<UnlistenFn> =>
  listen<AudioError>(AUDIO_EVENT.backendError, ({ payload }) => {
    onEvent(payload);
  });
