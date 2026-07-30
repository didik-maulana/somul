/**
 * The only file permitted to import from `@tauri-apps/api`, enforced by `no-restricted-imports`
 * in `eslint.config.js` rather than by convention. Everything else consumes these wrappers, which
 * is what lets the whole frontend be tested without a Tauri runtime.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type {
  AudioDevice,
  AudioError,
  AudioSession,
  DeviceChangedPayload,
  DeviceId,
  MasterState,
  PlatformCapabilities,
  SessionId,
  SessionPeak,
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

export const AUDIO_EVENT = {
  peaks: 'audio://peaks',
  sessionsChanged: 'audio://sessions-changed',
  masterChanged: 'audio://master-changed',
  masterResync: 'audio://master-resync',
  deviceChanged: 'audio://device-changed',
  backendError: 'audio://backend-error',
} as const;

/** One batch per tick covering every session — never one emit per session. */
export const onPeaks = (onEvent: (peaks: SessionPeak[]) => void): Promise<UnlistenFn> =>
  listen<SessionPeak[]>(AUDIO_EVENT.peaks, ({ payload }) => {
    onEvent(payload);
  });

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
