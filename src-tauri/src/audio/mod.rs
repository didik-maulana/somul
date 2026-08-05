#[cfg(test)]
pub mod contract;
pub mod error;
#[cfg(target_os = "macos")]
pub mod macos;
pub mod mock;

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize};

pub use error::AudioError;

/// Opaque, backend-generated session handle.
///
/// A PID is **not** an identity key. One process routinely owns several concurrent sessions
/// (Chrome one per tab, Discord one for input and one for output), and the OS recycles PIDs, so
/// a PID-keyed write can land on an unrelated process after a session dies.
///
/// A newtype alone does not prevent `SessionId::from(pid.to_string())`, so construction rejects
/// any all-digit identifier: a bare integer is either a PID or a raw backend index, and neither
/// is stable enough to key a write. Adapters namespace their identifiers instead —
/// `wasapi:{guid}|spotify.exe`, `pw:node:56`, `pulse:sink-input:12`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct SessionId(String);

impl SessionId {
    pub fn from_backend_identifier(identifier: &str) -> Result<Self, AudioError> {
        let trimmed = identifier.trim();

        if trimmed.is_empty() {
            return Err(AudioError::BackendFailure(
                "adapter produced an empty session identifier".to_owned(),
            ));
        }

        if trimmed.chars().all(|character| character.is_ascii_digit()) {
            return Err(AudioError::BackendFailure(format!(
                "session identifier {trimmed:?} is all digits — a PID or raw index is not a stable session key"
            )));
        }

        Ok(Self(trimmed.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for SessionId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// Deserialization runs the same guard as construction so the IPC boundary cannot smuggle a PID
/// back in as a session key.
impl<'de> Deserialize<'de> for SessionId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;

        Self::from_backend_identifier(&raw).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DeviceId(String);

impl DeviceId {
    pub fn new(identifier: impl Into<String>) -> Self {
        Self(identifier.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for DeviceId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionState {
    Active,
    Inactive,
    Expired,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSession {
    pub session_id: SessionId,
    /// Display and debug metadata only — never an identity key. See [`SessionId`].
    pub pid: u32,
    pub display_name: String,
    pub process_name: String,
    pub icon_data_uri: Option<String>,
    /// Linear scalar 0.0–1.0. Not a percentage, and not dB.
    pub volume: f32,
    pub is_muted: bool,
    pub output_device_id: Option<DeviceId>,
    pub state: SessionState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub device_id: DeviceId,
    pub name: String,
    pub is_default: bool,
    pub is_available: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterState {
    pub device_id: DeviceId,
    pub device_name: String,
    /// Linear scalar 0.0–1.0. Not a percentage, and not dB.
    pub volume: f32,
    pub is_muted: bool,
    /// False when the device publishes no software volume at all.
    ///
    /// Aggregates, most HDMI outputs, and many USB DACs keep their gain in hardware. `volume`
    /// then reports unity because nothing is attenuating, but writing to it does nothing. The UI
    /// needs to tell those apart, or it shows a slider at 100% that silently refuses to move.
    pub is_volume_controllable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPeak {
    pub session_id: SessionId,
    /// Linear amplitude 0.0–1.0.
    pub peak: f32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCapabilities {
    pub has_per_app_volume: bool,
    pub has_per_app_mute: bool,
    pub has_per_app_meter: bool,
    pub has_per_app_routing: bool,
    /// Rendered verbatim by the UI in place of the session list. Populated whenever a per-app
    /// capability is missing, so the panel can explain the limit instead of showing dead controls.
    pub unsupported_reason: Option<String>,
    /// The platform can do per-app volume, but the OS has not granted the permission it needs.
    ///
    /// Distinct from an absent capability: nothing is missing except the user's consent, and the
    /// panel can offer the one action that fixes it rather than a dead end. Never true on a
    /// platform that could not do per-app volume in the first place.
    pub needs_audio_permission: bool,
    /// The permission has been asked for again since, and the answer has not changed.
    ///
    /// Only ever true alongside [`Self::needs_audio_permission`]. It separates a grant that has
    /// simply not landed yet from one this process will never see: macOS settles audio capture
    /// once per process, so a permission granted after launch needs a new one. The panel offers
    /// waiting for the first and a relaunch for the second.
    pub has_exhausted_capture_retries: bool,
}

impl PlatformCapabilities {
    /// Windows and Linux. Per-app routing stays false in v1.0: it is planned for v1.1 on Linux
    /// and remains an unproven spike on Windows, which has no public routing API.
    pub fn full_per_app() -> Self {
        Self {
            has_per_app_volume: true,
            has_per_app_mute: true,
            has_per_app_meter: true,
            has_per_app_routing: false,
            unsupported_reason: None,
            needs_audio_permission: false,
            has_exhausted_capture_retries: false,
        }
    }

    /// Per-app volume is available and switched off by the OS until the user consents.
    ///
    /// The capability flags stay true. Nothing about the platform changed; a checkbox did, and
    /// reporting the platform as incapable would send the user looking for the wrong fix.
    ///
    /// `has_exhausted_capture_retries` is what the panel branches on to decide whether it can
    /// still promise that waiting will do it.
    pub fn awaiting_audio_permission(
        reason: impl Into<String>,
        has_exhausted_capture_retries: bool,
    ) -> Self {
        Self {
            unsupported_reason: Some(reason.into()),
            needs_audio_permission: true,
            has_exhausted_capture_retries,
            ..Self::full_per_app()
        }
    }

    /// macOS in v1. The reason is rendered verbatim by the UI, which is why it is required here
    /// rather than optional — a platform that reports no capability must also say why.
    pub fn master_only(reason: impl Into<String>) -> Self {
        Self {
            has_per_app_volume: false,
            has_per_app_mute: false,
            has_per_app_meter: false,
            has_per_app_routing: false,
            unsupported_reason: Some(reason.into()),
            needs_audio_permission: false,
            has_exhausted_capture_retries: false,
        }
    }
}

/// One trait, every platform adapter.
///
/// An operation the platform does not support returns [`AudioError::Unsupported`] — never
/// `Ok(())`, never a silent no-op. The frontend gates on [`AudioBackend::capabilities`] rather
/// than sniffing the OS, so a silent no-op here surfaces to the user as a control that appears
/// to work and does nothing.
pub trait AudioBackend: Send + Sync {
    fn capabilities(&self) -> PlatformCapabilities;

    fn list_sessions(&self) -> Result<Vec<AudioSession>, AudioError>;
    fn set_session_volume(&self, id: &SessionId, volume: f32) -> Result<(), AudioError>;
    fn set_session_mute(&self, id: &SessionId, is_muted: bool) -> Result<(), AudioError>;

    fn master(&self) -> Result<MasterState, AudioError>;
    fn set_master_volume(&self, volume: f32) -> Result<(), AudioError>;
    fn set_master_mute(&self, is_muted: bool) -> Result<(), AudioError>;

    fn list_output_devices(&self) -> Result<Vec<AudioDevice>, AudioError>;
    fn set_default_output_device(&self, device: &DeviceId) -> Result<(), AudioError>;
    fn set_session_output_device(
        &self,
        id: &SessionId,
        device: &DeviceId,
    ) -> Result<(), AudioError>;

    fn read_peaks(&self) -> Result<Vec<SessionPeak>, AudioError>;

    /// Whether the session list may have changed since this was last asked.
    ///
    /// Enumeration is the expensive half of a meter tick, and on macOS it also decides whether the
    /// tap graph is rebuilt — so the loop must not do it on a hunch. A backend the OS notifies can
    /// answer precisely, and the panel then follows an app starting playback within a tick rather
    /// than on the next poll.
    ///
    /// `None` — the default — means this backend has no notification to answer from and must be
    /// re-enumerated on the loop's own timer. That is deliberately distinct from `Some(false)`,
    /// which is a backend stating that nothing has changed: reading "I don't know" as "nothing
    /// happened" would stop a polling backend from ever refreshing.
    ///
    /// Asking is expected to consume the change, so two calls without an intervening change do not
    /// both report one.
    fn sessions_may_have_changed(&self) -> Option<bool> {
        None
    }
}

/// Volume and peak are linear scalars on the wire. Adapters clamp at the boundary so an
/// out-of-range value from the OS or the UI never reaches the other side.
///
/// NaN maps to silence rather than propagating: it reaches the UI as a slider with no position
/// and the backend as an unwritable gain.
pub fn clamp_unit_scalar(value: f32) -> f32 {
    if value.is_nan() {
        return 0.0;
    }

    value.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session_id(identifier: &str) -> SessionId {
        SessionId::from_backend_identifier(identifier).expect("namespaced identifier is accepted")
    }

    #[test]
    fn accepts_a_namespaced_backend_identifier() {
        let id = session_id("wasapi:{0.0.0.00000000}.{f4a1}|spotify.exe");

        assert_eq!(id.as_str(), "wasapi:{0.0.0.00000000}.{f4a1}|spotify.exe");
    }

    #[test]
    fn rejects_a_stringified_pid() {
        let error = SessionId::from_backend_identifier("4821")
            .expect_err("an all-digit identifier is a PID or a raw index");

        assert!(matches!(error, AudioError::BackendFailure(_)));
    }

    #[test]
    fn rejects_a_pid_with_surrounding_whitespace() {
        assert!(SessionId::from_backend_identifier(" 4821 ").is_err());
    }

    #[test]
    fn rejects_an_empty_identifier() {
        assert!(SessionId::from_backend_identifier("   ").is_err());
    }

    #[test]
    fn rejects_a_pid_arriving_over_ipc() {
        let error = serde_json::from_str::<SessionId>(r#""4821""#)
            .expect_err("deserialization runs the same guard as construction");

        assert!(error.to_string().contains("all digits"));
    }

    #[test]
    fn accepts_a_namespaced_identifier_arriving_over_ipc() {
        let id: SessionId = serde_json::from_str(r#""pw:node:56""#).expect("namespaced identifier");

        assert_eq!(id.as_str(), "pw:node:56");
    }

    #[test]
    fn serializes_a_session_in_camel_case() {
        let session = AudioSession {
            session_id: session_id("wasapi:{f4a1}|spotify.exe"),
            pid: 4821,
            display_name: "Spotify".to_owned(),
            process_name: "spotify.exe".to_owned(),
            icon_data_uri: None,
            volume: 0.74,
            is_muted: false,
            output_device_id: Some(DeviceId::new("wasapi:{speakers}")),
            state: SessionState::Active,
        };

        let json = serde_json::to_value(&session).expect("AudioSession must serialize");

        assert_eq!(json["sessionId"], "wasapi:{f4a1}|spotify.exe");
        assert_eq!(json["pid"], 4821);
        assert_eq!(json["displayName"], "Spotify");
        assert_eq!(json["processName"], "spotify.exe");
        assert_eq!(json["iconDataUri"], serde_json::Value::Null);
        assert_eq!(json["isMuted"], false);
        assert_eq!(json["outputDeviceId"], "wasapi:{speakers}");
        assert_eq!(json["state"], "active");
    }

    #[test]
    fn serializes_every_session_state_in_camel_case() {
        let states = [
            SessionState::Active,
            SessionState::Inactive,
            SessionState::Expired,
        ];

        let encoded: Vec<serde_json::Value> = states
            .iter()
            .map(|state| serde_json::to_value(state).expect("SessionState must serialize"))
            .collect();

        assert_eq!(encoded, ["active", "inactive", "expired"]);
    }

    #[test]
    fn serializes_a_device_in_camel_case() {
        let device = AudioDevice {
            device_id: DeviceId::new("coreaudio:74"),
            name: "MacBook Pro Speakers".to_owned(),
            is_default: true,
            is_available: true,
        };

        let json = serde_json::to_value(&device).expect("AudioDevice must serialize");

        assert_eq!(json["deviceId"], "coreaudio:74");
        assert_eq!(json["isDefault"], true);
        assert_eq!(json["isAvailable"], true);
    }

    #[test]
    fn serializes_master_state_in_camel_case() {
        let master = MasterState {
            device_id: DeviceId::new("coreaudio:74"),
            device_name: "MacBook Pro Speakers".to_owned(),
            volume: 0.5,
            is_muted: false,
            is_volume_controllable: true,
        };

        let json = serde_json::to_value(&master).expect("MasterState must serialize");

        assert_eq!(json["deviceId"], "coreaudio:74");
        assert_eq!(json["deviceName"], "MacBook Pro Speakers");
        assert_eq!(json["isMuted"], false);
    }

    #[test]
    fn serializes_a_peak_in_camel_case() {
        let peak = SessionPeak {
            session_id: session_id("pw:node:56"),
            peak: 0.31,
        };

        let json = serde_json::to_value(&peak).expect("SessionPeak must serialize");

        assert_eq!(json["sessionId"], "pw:node:56");
    }

    #[test]
    fn full_per_app_keeps_routing_off_until_v1_1() {
        let capabilities = PlatformCapabilities::full_per_app();

        assert!(capabilities.has_per_app_volume);
        assert!(capabilities.has_per_app_mute);
        assert!(capabilities.has_per_app_meter);
        assert!(!capabilities.has_per_app_routing);
        assert_eq!(capabilities.unsupported_reason, None);
    }

    #[test]
    fn master_only_reports_no_per_app_capability_and_carries_a_reason() {
        let capabilities = PlatformCapabilities::master_only("macOS per-app control is v1.2");

        assert!(!capabilities.has_per_app_volume);
        assert!(!capabilities.has_per_app_mute);
        assert!(!capabilities.has_per_app_meter);
        assert!(!capabilities.has_per_app_routing);
        assert_eq!(
            capabilities.unsupported_reason.as_deref(),
            Some("macOS per-app control is v1.2")
        );
    }

    #[test]
    fn clamps_scalars_into_the_unit_range() {
        assert_eq!(clamp_unit_scalar(-0.4), 0.0);
        assert_eq!(clamp_unit_scalar(0.0), 0.0);
        assert_eq!(clamp_unit_scalar(0.62), 0.62);
        assert_eq!(clamp_unit_scalar(1.0), 1.0);
        assert_eq!(clamp_unit_scalar(1.8), 1.0);
    }

    #[test]
    fn treats_a_nan_scalar_as_silence() {
        assert_eq!(clamp_unit_scalar(f32::NAN), 0.0);
    }

    #[test]
    fn serializes_capabilities_in_camel_case() {
        let capabilities = PlatformCapabilities {
            has_per_app_volume: false,
            has_per_app_mute: false,
            has_per_app_meter: false,
            has_per_app_routing: false,
            unsupported_reason: Some("macOS exposes master volume only in v1".to_owned()),
            needs_audio_permission: false,
            has_exhausted_capture_retries: false,
        };

        let json = serde_json::to_value(&capabilities).expect("capabilities must serialize");

        assert_eq!(json["hasPerAppVolume"], false);
        assert_eq!(json["hasPerAppMute"], false);
        assert_eq!(json["hasPerAppMeter"], false);
        assert_eq!(json["hasPerAppRouting"], false);
        assert_eq!(
            json["unsupportedReason"],
            "macOS exposes master volume only in v1"
        );
        assert_eq!(json["needsAudioPermission"], false);
        assert_eq!(json["hasExhaustedCaptureRetries"], false);
    }
}
