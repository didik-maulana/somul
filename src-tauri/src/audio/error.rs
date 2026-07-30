use std::fmt;

use serde::Serialize;

use super::{DeviceId, SessionId};

/// ARCHITECTURE.md §7.3. Every IPC command resolves to `Result<T, AudioError>`; a rejected
/// promise carries this structure, never a bare string.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum AudioError {
    SessionNotFound(SessionId),
    DeviceNotFound(DeviceId),
    DeviceInvalidated,
    PermissionDenied(String),
    Unsupported(String),
    BackendFailure(String),
}

impl fmt::Display for AudioError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SessionNotFound(id) => write!(formatter, "audio session {id} no longer exists"),
            Self::DeviceNotFound(id) => write!(formatter, "audio device {id} no longer exists"),
            Self::DeviceInvalidated => {
                formatter.write_str("the default output device changed mid-operation")
            }
            Self::PermissionDenied(reason) => write!(formatter, "permission denied: {reason}"),
            Self::Unsupported(reason) => write!(formatter, "unsupported on this platform: {reason}"),
            Self::BackendFailure(reason) => write!(formatter, "audio backend failure: {reason}"),
        }
    }
}

impl std::error::Error for AudioError {}

#[cfg(test)]
mod tests {
    use super::*;

    fn json(error: &AudioError) -> String {
        serde_json::to_string(error).expect("AudioError must serialize")
    }

    #[test]
    fn tags_variants_in_camel_case() {
        let error = AudioError::DeviceInvalidated;

        assert_eq!(json(&error), r#"{"kind":"deviceInvalidated"}"#);
    }

    #[test]
    fn carries_the_payload_under_detail() {
        let error = AudioError::Unsupported("per-app volume needs macOS 14.4".to_owned());

        assert_eq!(
            json(&error),
            r#"{"kind":"unsupported","detail":"per-app volume needs macOS 14.4"}"#
        );
    }

    #[test]
    fn serializes_identifier_payloads_as_plain_strings() {
        let session = SessionId::from_backend_identifier("wasapi:{f4a1}|spotify.exe")
            .expect("identifier is not numeric");
        let error = AudioError::SessionNotFound(session);

        assert_eq!(
            json(&error),
            r#"{"kind":"sessionNotFound","detail":"wasapi:{f4a1}|spotify.exe"}"#
        );
    }

    #[test]
    fn every_kind_from_the_error_table_serializes() {
        let device = DeviceId::new("coreaudio:74");
        let kinds = [
            AudioError::SessionNotFound(
                SessionId::from_backend_identifier("pw:node:56").expect("prefixed identifier"),
            ),
            AudioError::DeviceNotFound(device),
            AudioError::DeviceInvalidated,
            AudioError::PermissionDenied("TCC consent refused".to_owned()),
            AudioError::Unsupported("per-app routing is v1.1".to_owned()),
            AudioError::BackendFailure("PipeWire disconnected".to_owned()),
        ];

        let tags: Vec<String> = kinds
            .iter()
            .map(|error| {
                serde_json::from_str::<serde_json::Value>(&json(error))
                    .expect("valid json")
                    .get("kind")
                    .and_then(serde_json::Value::as_str)
                    .expect("kind tag")
                    .to_owned()
            })
            .collect();

        assert_eq!(
            tags,
            [
                "sessionNotFound",
                "deviceNotFound",
                "deviceInvalidated",
                "permissionDenied",
                "unsupported",
                "backendFailure",
            ]
        );
    }
}
