/**
 * Field-for-field mirror of the Rust types in `src-tauri/src/audio/`.
 *
 * Rust is the source of truth. When a payload changes, change it there first and follow here —
 * these two definitions drifting apart is a runtime failure no compiler will catch.
 */

declare const sessionIdBrand: unique symbol;
declare const deviceIdBrand: unique symbol;

/**
 * Opaque, backend-generated. **Never a PID.** Branded so a raw string — a stringified PID above
 * all — cannot be passed where a session key is expected.
 */
export type SessionId = string & { readonly [sessionIdBrand]: true };

export type DeviceId = string & { readonly [deviceIdBrand]: true };

export type SessionState = 'active' | 'inactive' | 'expired';

export interface AudioSession {
  sessionId: SessionId;
  /** Display and debug metadata only. Never use this as an identity key; see {@link SessionId}. */
  pid: number;
  displayName: string;
  processName: string;
  iconDataUri: string | null;
  /** Linear scalar 0.0–1.0. Not a percentage, and not dB. */
  volume: number;
  isMuted: boolean;
  outputDeviceId: DeviceId | null;
  state: SessionState;
}

/**
 * One session's loudest sample since the panel last read it.
 *
 * Never held in a store. Peaks arrive at 30 Hz and are routed straight to the meter engine, which
 * writes to the DOM — see `meterEngine.ts`.
 */
export interface SessionPeak {
  sessionId: SessionId;
  /** Linear amplitude 0.0-1.0. Convert to dB before drawing it. */
  peak: number;
}

export interface AudioDevice {
  deviceId: DeviceId;
  name: string;
  isDefault: boolean;
  isAvailable: boolean;
}

export interface MasterState {
  deviceId: DeviceId;
  deviceName: string;
  /** Linear scalar 0.0–1.0. Not a percentage, and not dB. */
  volume: number;
  isMuted: boolean;
  /**
   * False when the device publishes no software volume at all — common for aggregates, HDMI
   * outputs, and USB DACs that keep gain in hardware. `volume` reads as unity there because
   * nothing is attenuating, so the UI must use this flag rather than the value to decide whether
   * the slider can do anything.
   */
  isVolumeControllable: boolean;
}

export interface PlatformCapabilities {
  hasPerAppVolume: boolean;
  hasPerAppMute: boolean;
  hasPerAppMeter: boolean;
  hasPerAppRouting: boolean;
  /** Rendered verbatim by the UI in place of the session list. */
  unsupportedReason: string | null;
}

export type AudioErrorKind =
  | 'sessionNotFound'
  | 'deviceNotFound'
  | 'deviceInvalidated'
  | 'permissionDenied'
  | 'unsupported'
  | 'backendFailure';

/** Tagged union mirroring the Rust `#[serde(tag = "kind", content = "detail")]` representation. */
export type AudioError =
  | { kind: 'sessionNotFound'; detail: SessionId }
  | { kind: 'deviceNotFound'; detail: DeviceId }
  | { kind: 'deviceInvalidated' }
  | { kind: 'permissionDenied'; detail: string }
  | { kind: 'unsupported'; detail: string }
  | { kind: 'backendFailure'; detail: string };

export interface DeviceChangedPayload {
  devices: AudioDevice[];
  defaultDeviceId: DeviceId;
}

export type Theme = 'dark' | 'light' | 'system';

/** Mirrors `AppSettings` in `src-tauri/src/settings.rs`. */
export interface AppSettings {
  schemaVersion: number;
  /** Tauri accelerator, e.g. `CmdOrCtrl+Shift+V`. */
  hotkey: string;
  theme: Theme;
  shouldLaunchAtLogin: boolean;
  /** Whether app rows carry a peak meter. Off also stops the backend publishing peaks at all. */
  shouldShowPeakMeter: boolean;
  /** processName -> deviceId. Reserved for per-app routing. */
  routingPresets: Record<string, string>;
  /**
   * processName -> last volume scalar 0.0-1.0.
   *
   * Backend-owned: written as the user mixes and applied when an app is next seen. `update_settings`
   * keeps what is on disk, so sending a stale copy back is harmless — and pointless.
   */
  volumeMemory: Record<string, number>;
  /** processName -> last mute state. Same ownership as {@link AppSettings.volumeMemory}. */
  muteMemory: Record<string, boolean>;
}

/**
 * Mirrors `UpdatePhase` in `src-tauri/src/commands/update.rs`.
 *
 * No `checking`: a check in flight is something one window says about itself while the user waits
 * on it, not a fact about the app.
 */
export type BackendUpdatePhase =
  | 'idle'
  | 'upToDate'
  | 'available'
  | 'installing'
  | 'installed'
  | 'failed';

/** Mirrors `UpdateSnapshot` in `src-tauri/src/commands/update.rs`. */
export interface UpdateSnapshot {
  phase: BackendUpdatePhase;
  currentVersion: string;
  /** Null when the running build is already the newest published one. */
  availableVersion: string | null;
  /** Release notes as published in the manifest. */
  notes: string | null;
}

/** Mirrors `UpdateProgress` in `src-tauri/src/commands/update.rs`. */
export interface UpdateProgress {
  downloaded: number;
  /** Null when the server sent no `Content-Length` — the download then has no percentage. */
  total: number | null;
}

export interface SettingsUpdate {
  /**
   * What was actually applied. May differ from what was sent — a hotkey the OS refused is rolled
   * back to the previous one, so the UI must render this rather than its own optimistic guess.
   */
  settings: AppSettings;
  hotkeyWarning: string | null;
}
