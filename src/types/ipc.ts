/**
 * Field-for-field mirror of the Rust types in `src-tauri/src/audio/`.
 * ARCHITECTURE.md §6 — Rust is the source of truth; this file follows it.
 */

declare const sessionIdBrand: unique symbol;
declare const deviceIdBrand: unique symbol;

/**
 * Opaque, backend-generated. NEVER a PID (§6.2). Branded so a raw string — a stringified
 * PID above all — cannot be passed where a session key is expected.
 */
export type SessionId = string & { readonly [sessionIdBrand]: true };

export type DeviceId = string & { readonly [deviceIdBrand]: true };

export type SessionState = 'active' | 'inactive' | 'expired';

export interface AudioSession {
  sessionId: SessionId;
  /** Display and debug metadata only — never an identity key (§6.2). */
  pid: number;
  displayName: string;
  processName: string;
  iconDataUri: string | null;
  /** Linear scalar 0.0–1.0. Not a percentage, not dB (§6.1). */
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
  /** Linear scalar 0.0–1.0 (§6.1). */
  volume: number;
  isMuted: boolean;
}

export interface SessionPeak {
  sessionId: SessionId;
  /** Linear amplitude 0.0–1.0 (§6.1). */
  peak: number;
}

export interface PlatformCapabilities {
  hasPerAppVolume: boolean;
  hasPerAppMute: boolean;
  hasPerAppMeter: boolean;
  hasPerAppRouting: boolean;
  /** Rendered verbatim in the macOS empty state (§2.2.5). */
  unsupportedReason: string | null;
}

export type AudioErrorKind =
  | 'sessionNotFound'
  | 'deviceNotFound'
  | 'deviceInvalidated'
  | 'permissionDenied'
  | 'unsupported'
  | 'backendFailure';

/** Tagged union mirroring the `#[serde(tag = "kind", content = "detail")]` shape of §7.3. */
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
