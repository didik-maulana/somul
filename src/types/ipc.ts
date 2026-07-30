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

export interface SessionPeak {
  sessionId: SessionId;
  /** Linear amplitude 0.0–1.0. */
  peak: number;
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
