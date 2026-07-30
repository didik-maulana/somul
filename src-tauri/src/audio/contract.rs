//! The `AudioBackend` contract suite.
//!
//! ARCHITECTURE.md §14: written **once**, here, and run unchanged by every adapter. An adapter
//! that needs a relaxed variant of one of these checks has found a contract disagreement, not a
//! test to weaken.
//!
//! Invoke it from an adapter's test module with [`audio_backend_contract!`].

use super::{AudioBackend, AudioError, SessionId};

fn unknown_session() -> SessionId {
    SessionId::from_backend_identifier("contract:session:does-not-exist")
        .unwrap_or_else(|_| unreachable!("the probe identifier is namespaced"))
}

fn unknown_device() -> super::DeviceId {
    super::DeviceId::new("contract:device:does-not-exist")
}

fn is_unit_scalar(value: f32) -> bool {
    value.is_finite() && (0.0..=1.0).contains(&value)
}

/// §2.2.5: a backend without per-app support must supply the reason, because the UI renders it
/// verbatim in place of the session list. Reporting no capability and no reason leaves the panel
/// with nothing honest to say.
pub fn capabilities_are_self_consistent(backend: &dyn AudioBackend) {
    let capabilities = backend.capabilities();

    if capabilities.has_per_app_volume {
        assert!(
            capabilities.unsupported_reason.is_none(),
            "a fully capable backend must not carry an unsupported reason"
        );
    } else {
        let reason = capabilities
            .unsupported_reason
            .as_deref()
            .expect("a backend without per-app volume must explain why (§2.2.5)");

        assert!(
            !reason.trim().is_empty(),
            "the unsupported reason is rendered verbatim and must not be blank"
        );
    }

    assert!(
        !capabilities.has_per_app_routing,
        "per-app routing is v1.1 — no v1.0 adapter may advertise it (§1.2)"
    );
}

/// §2.4: an unsupported operation returns `Unsupported`, never `Ok(())` and never an empty
/// success. A silent no-op reaches the user as a control that appears to work.
pub fn unsupported_per_app_operations_fail_loudly(backend: &dyn AudioBackend) {
    if backend.capabilities().has_per_app_volume {
        return;
    }

    let session = unknown_session();

    for (label, result) in [
        ("list_sessions", backend.list_sessions().map(|_| ())),
        (
            "set_session_volume",
            backend.set_session_volume(&session, 0.5),
        ),
        (
            "set_session_mute",
            backend.set_session_mute(&session, true),
        ),
    ] {
        match result {
            Err(AudioError::Unsupported(reason)) => assert!(
                !reason.trim().is_empty(),
                "{label} returned Unsupported with a blank reason"
            ),
            Err(other) => panic!("{label} must return Unsupported, got {other:?}"),
            Ok(()) => panic!("{label} must not silently succeed on a master-only backend"),
        }
    }
}

/// §6.2: `sessionId` is opaque and backend-generated. A PID is neither stable nor unique per
/// session, so it must never appear as the identity key — not even stringified.
pub fn session_identities_are_never_pids(backend: &dyn AudioBackend) {
    let Ok(sessions) = backend.list_sessions() else {
        return;
    };

    for session in sessions {
        let identifier = session.session_id.as_str();

        assert_ne!(
            identifier,
            session.pid.to_string(),
            "session identifier is the stringified PID (§6.2)"
        );
        assert!(
            !identifier.chars().all(|character| character.is_ascii_digit()),
            "session identifier {identifier:?} is all digits — a PID or a raw index (§6.2)"
        );
    }
}

/// §6.1: volume is a linear scalar 0.0–1.0 across the whole IPC surface.
pub fn sessions_report_wire_legal_values(backend: &dyn AudioBackend) {
    let Ok(sessions) = backend.list_sessions() else {
        return;
    };

    for session in sessions {
        assert!(
            is_unit_scalar(session.volume),
            "session {} reports volume {} outside 0.0–1.0 (§6.1)",
            session.session_id,
            session.volume
        );
        assert!(
            !session.process_name.trim().is_empty(),
            "session {} has no process name — settings are keyed by it (§11)",
            session.session_id
        );
    }
}

pub fn session_volume_round_trips(backend: &dyn AudioBackend) {
    let Ok(sessions) = backend.list_sessions() else {
        return;
    };
    let Some(target) = sessions.first() else {
        return;
    };

    backend
        .set_session_volume(&target.session_id, 0.25)
        .expect("setting a session volume on a capable backend must succeed");

    let observed = backend
        .list_sessions()
        .expect("sessions")
        .into_iter()
        .find(|session| session.session_id == target.session_id)
        .expect("the session survived its own volume write");

    assert!(
        (observed.volume - 0.25).abs() < 0.01,
        "volume did not round trip: wrote 0.25, read {}",
        observed.volume
    );
}

/// Out-of-range input is clamped at the adapter boundary rather than propagated (§6.1).
pub fn session_volume_is_clamped(backend: &dyn AudioBackend) {
    let Ok(sessions) = backend.list_sessions() else {
        return;
    };
    let Some(target) = sessions.first() else {
        return;
    };

    for written in [-1.5_f32, 4.0_f32] {
        backend
            .set_session_volume(&target.session_id, written)
            .expect("an out-of-range write is clamped, not rejected");

        let observed = backend
            .list_sessions()
            .expect("sessions")
            .into_iter()
            .find(|session| session.session_id == target.session_id)
            .expect("session still present");

        assert!(
            is_unit_scalar(observed.volume),
            "writing {written} left the session at {} (§6.1)",
            observed.volume
        );
    }
}

pub fn session_mute_round_trips(backend: &dyn AudioBackend) {
    let Ok(sessions) = backend.list_sessions() else {
        return;
    };
    let Some(target) = sessions.first() else {
        return;
    };

    for written in [true, false] {
        backend
            .set_session_mute(&target.session_id, written)
            .expect("setting a session mute on a capable backend must succeed");

        let observed = backend
            .list_sessions()
            .expect("sessions")
            .into_iter()
            .find(|session| session.session_id == target.session_id)
            .expect("session still present");

        assert_eq!(observed.is_muted, written, "mute did not round trip");
    }
}

/// §7.3: the app closed mid-write. The UI drops the row silently, which it can only do if the
/// adapter distinguishes this from a generic failure.
pub fn writes_to_a_dead_session_report_session_not_found(backend: &dyn AudioBackend) {
    if !backend.capabilities().has_per_app_volume {
        return;
    }

    let ghost = unknown_session();

    assert!(
        matches!(
            backend.set_session_volume(&ghost, 0.5),
            Err(AudioError::SessionNotFound(_))
        ),
        "a volume write to a dead session must report SessionNotFound"
    );
    assert!(
        matches!(
            backend.set_session_mute(&ghost, true),
            Err(AudioError::SessionNotFound(_))
        ),
        "a mute write to a dead session must report SessionNotFound"
    );
}

pub fn master_state_is_wire_legal(backend: &dyn AudioBackend) {
    let master = backend
        .master()
        .expect("master volume is supported on every platform (§2)");

    assert!(
        is_unit_scalar(master.volume),
        "master volume {} is outside 0.0–1.0 (§6.1)",
        master.volume
    );
    assert!(
        !master.device_name.trim().is_empty(),
        "master state must name its device — the UI renders it"
    );
}

/// A hardware-gain device — an aggregate, most HDMI outputs, many USB DACs — exposes no software
/// volume or mute. §2.4 says the answer there is `Unsupported`, never a no-op, so that is the one
/// alternative outcome the suite accepts. Any other error, or a write that reports success without
/// taking effect, still fails.
fn assert_supported_or_refused(result: Result<(), AudioError>, operation: &str) -> bool {
    match result {
        Ok(()) => true,
        Err(AudioError::Unsupported(reason)) => {
            assert!(
                !reason.trim().is_empty(),
                "{operation} returned Unsupported with a blank reason"
            );
            false
        }
        Err(other) => panic!("{operation} failed with {other:?}"),
    }
}

pub fn master_volume_round_trips_and_clamps(backend: &dyn AudioBackend) {
    if !assert_supported_or_refused(backend.set_master_volume(0.4), "set_master_volume") {
        return;
    }

    let observed = backend.master().expect("master").volume;
    assert!(
        (observed - 0.4).abs() < 0.01,
        "master volume did not round trip: wrote 0.4, read {observed}"
    );

    backend
        .set_master_volume(9.0)
        .expect("an out-of-range write is clamped, not rejected");

    assert!(
        is_unit_scalar(backend.master().expect("master").volume),
        "master volume escaped 0.0–1.0 after an out-of-range write"
    );
}

pub fn master_mute_round_trips(backend: &dyn AudioBackend) {
    if !assert_supported_or_refused(backend.set_master_mute(true), "set_master_mute") {
        return;
    }

    for written in [true, false] {
        backend.set_master_mute(written).expect("master mute write");

        assert_eq!(
            backend.master().expect("master").is_muted,
            written,
            "master mute did not round trip"
        );
    }
}

pub fn exactly_one_output_device_is_default(backend: &dyn AudioBackend) {
    let devices = backend
        .list_output_devices()
        .expect("device enumeration is supported on every platform (§2)");

    assert!(
        !devices.is_empty(),
        "a machine playing audio has at least one output device"
    );

    let defaults = devices.iter().filter(|device| device.is_default).count();

    assert_eq!(
        defaults, 1,
        "expected exactly one default output device, found {defaults}"
    );
}

pub fn default_output_device_switches(backend: &dyn AudioBackend) {
    let devices = backend.list_output_devices().expect("devices");
    let Some(target) = devices.iter().find(|device| !device.is_default) else {
        return;
    };

    backend
        .set_default_output_device(&target.device_id)
        .expect("switching to an enumerated device must succeed");

    let observed = backend
        .list_output_devices()
        .expect("devices")
        .into_iter()
        .find(|device| device.is_default)
        .expect("a default device survives the switch");

    assert_eq!(
        observed.device_id, target.device_id,
        "the requested device did not become default"
    );
}

pub fn switching_to_an_unknown_device_reports_device_not_found(backend: &dyn AudioBackend) {
    assert!(
        matches!(
            backend.set_default_output_device(&unknown_device()),
            Err(AudioError::DeviceNotFound(_))
        ),
        "an unknown device id must report DeviceNotFound, not a generic failure"
    );
}

/// §1.2: per-app routing is v1.1. No v1.0 adapter may quietly accept it.
pub fn per_app_routing_is_unsupported_in_v1(backend: &dyn AudioBackend) {
    let session = backend
        .list_sessions()
        .ok()
        .and_then(|sessions| sessions.first().map(|session| session.session_id.clone()))
        .unwrap_or_else(unknown_session);
    let device = backend
        .list_output_devices()
        .ok()
        .and_then(|devices| devices.first().map(|device| device.device_id.clone()))
        .unwrap_or_else(unknown_device);

    match backend.set_session_output_device(&session, &device) {
        Err(AudioError::Unsupported(reason)) => assert!(
            !reason.trim().is_empty(),
            "per-app routing returned Unsupported with a blank reason"
        ),
        Err(other) => panic!("per-app routing must return Unsupported, got {other:?}"),
        Ok(()) => panic!("per-app routing is v1.1 and must not succeed in v1.0 (§1.2)"),
    }
}

/// §6.1 plus §4.1: peaks are linear amplitudes, and one tick covers every session at once.
pub fn peaks_cover_every_session_exactly_once(backend: &dyn AudioBackend) {
    let peaks = backend.read_peaks().expect("peak read");

    for peak in &peaks {
        assert!(
            is_unit_scalar(peak.peak),
            "session {} reports peak {} outside 0.0–1.0 (§6.1)",
            peak.session_id,
            peak.peak
        );
    }

    let Ok(sessions) = backend.list_sessions() else {
        return;
    };

    let mut reported: Vec<&str> = peaks.iter().map(|peak| peak.session_id.as_str()).collect();
    reported.sort_unstable();
    let mut expected: Vec<&str> = sessions
        .iter()
        .map(|session| session.session_id.as_str())
        .collect();
    expected.sort_unstable();

    assert_eq!(
        reported, expected,
        "one batched read must cover every session exactly once (§4.1)"
    );
}

/// Runs the full contract suite against an adapter.
///
/// `$factory` is re-evaluated for every check, so each one starts from a fresh backend and the
/// suite carries no ordering dependency.
#[macro_export]
macro_rules! audio_backend_contract {
    ($suite:ident, $factory:expr) => {
        mod $suite {
            use super::*;

            macro_rules! contract_check {
                ($check:ident) => {
                    #[test]
                    fn $check() {
                        $crate::audio::contract::$check(&$factory);
                    }
                };
            }

            contract_check!(capabilities_are_self_consistent);
            contract_check!(unsupported_per_app_operations_fail_loudly);
            contract_check!(session_identities_are_never_pids);
            contract_check!(sessions_report_wire_legal_values);
            contract_check!(session_volume_round_trips);
            contract_check!(session_volume_is_clamped);
            contract_check!(session_mute_round_trips);
            contract_check!(writes_to_a_dead_session_report_session_not_found);
            contract_check!(master_state_is_wire_legal);
            contract_check!(master_volume_round_trips_and_clamps);
            contract_check!(master_mute_round_trips);
            contract_check!(exactly_one_output_device_is_default);
            contract_check!(default_output_device_switches);
            contract_check!(switching_to_an_unknown_device_reports_device_not_found);
            contract_check!(per_app_routing_is_unsupported_in_v1);
            contract_check!(peaks_cover_every_session_exactly_once);
        }
    };
}
