//! Handler tests that go through the real IPC path.
//!
//! Calling the functions directly would prove nothing about registration or argument decoding —
//! a command missing from `generate_handler!`, or a parameter whose name does not match the
//! §7.1 payload, would still pass. These invoke by command name, the way the frontend does.

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::audio::mock::MockAudioBackend;
use crate::audio::AudioBackend;
use crate::commands::AudioState;
use crate::meter::MeterGate;
use std::sync::Arc;

fn webview_with(backend: Arc<dyn AudioBackend>) -> WebviewWindow<MockRuntime> {
    let app = mock_builder()
        .manage(AudioState::new(backend, Arc::new(MeterGate::new())))
        .invoke_handler(crate::somul_command_handlers!())
        .build(mock_context(noop_assets()))
        .expect("the mock app builds");

    WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
        .build()
        .expect("the mock webview builds")
}

fn invoke(webview: &WebviewWindow<MockRuntime>, cmd: &str, body: Value) -> Result<Value, Value> {
    let url = if cfg!(any(windows, target_os = "android")) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    };

    tauri::test::get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.to_owned(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: url.parse().expect("a valid invoke origin"),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_owned(),
        },
    )
    .map(|response| {
        response
            .deserialize::<Value>()
            .expect("a command response is JSON")
    })
}

fn full_per_app() -> WebviewWindow<MockRuntime> {
    webview_with(Arc::new(MockAudioBackend::full_per_app()))
}

fn first_session_id(webview: &WebviewWindow<MockRuntime>) -> String {
    invoke(webview, "get_audio_sessions", json!({}))
        .expect("sessions")[0]["sessionId"]
        .as_str()
        .expect("a session id")
        .to_owned()
}

#[test]
fn starts_with_the_panel_hidden_so_no_metering_happens_at_boot() {
    let state = AudioState::new(
        Arc::new(MockAudioBackend::full_per_app()),
        Arc::new(MeterGate::new()),
    );

    assert!(!state.is_panel_visible());
}

#[test]
fn every_v1_command_is_registered_and_reachable_by_name() {
    let webview = full_per_app();
    let session_id = first_session_id(&webview);

    let calls: [(&str, Value); 11] = [
        ("get_platform_capabilities", json!({})),
        ("get_audio_sessions", json!({})),
        (
            "set_session_volume",
            json!({ "sessionId": session_id, "volume": 0.5 }),
        ),
        (
            "set_session_mute",
            json!({ "sessionId": session_id, "isMuted": true }),
        ),
        ("get_master_state", json!({})),
        ("set_master_volume", json!({ "volume": 0.5 })),
        ("set_master_mute", json!({ "isMuted": false })),
        ("list_output_devices", json!({})),
        (
            "set_default_output_device",
            json!({ "deviceId": "mock:headphones" }),
        ),
        (
            "set_session_output_device",
            json!({ "sessionId": session_id, "deviceId": "mock:headphones" }),
        ),
        ("set_panel_visibility", json!({ "isVisible": true })),
    ];

    for (cmd, body) in calls {
        let response = invoke(&webview, cmd, body);

        // set_session_output_device is v1.1 and legitimately rejects; what matters here is that
        // the command resolved rather than coming back as "command not found".
        if let Err(error) = &response {
            assert_eq!(
                error.get("kind").and_then(Value::as_str),
                Some("unsupported"),
                "{cmd} failed for a reason other than the v1.1 gate: {error}"
            );
        }
    }
}

#[test]
fn an_unregistered_command_is_rejected() {
    let webview = full_per_app();

    assert!(
        invoke(&webview, "set_session_eq", json!({})).is_err(),
        "an unknown command must not resolve"
    );
}

#[test]
fn capabilities_reach_the_frontend_in_camel_case() {
    let webview = full_per_app();

    let capabilities = invoke(&webview, "get_platform_capabilities", json!({}))
        .expect("capabilities never fail — every platform reports something");

    assert_eq!(capabilities["hasPerAppVolume"], json!(true));
    assert_eq!(capabilities["unsupportedReason"], Value::Null);
}

#[test]
fn a_volume_write_round_trips_through_the_command_layer() {
    let webview = full_per_app();
    let session_id = first_session_id(&webview);

    invoke(
        &webview,
        "set_session_volume",
        json!({ "sessionId": session_id, "volume": 0.31 }),
    )
    .expect("volume write");

    let sessions = invoke(&webview, "get_audio_sessions", json!({})).expect("sessions");
    let written = sessions
        .as_array()
        .expect("sessions are an array")
        .iter()
        .find(|session| session["sessionId"] == json!(session_id))
        .expect("the session survived its own write");

    assert_eq!(written["volume"], json!(0.31));
}

/// §7.3: the row is dropped silently by the UI, which needs the kind to be distinguishable.
#[test]
fn a_write_to_a_dead_session_surfaces_session_not_found() {
    let webview = full_per_app();

    let error = invoke(
        &webview,
        "set_session_volume",
        json!({ "sessionId": "mock:session:closed", "volume": 0.5 }),
    )
    .expect_err("writing to a dead session must fail");

    assert_eq!(error["kind"], json!("sessionNotFound"));
}

/// §6.2: the guard lives on the Rust `SessionId`, so a PID is refused during argument decoding —
/// before any handler body runs.
#[test]
fn a_stringified_pid_is_refused_at_the_ipc_boundary() {
    let webview = full_per_app();

    assert!(
        invoke(
            &webview,
            "set_session_volume",
            json!({ "sessionId": "4821", "volume": 0.5 }),
        )
        .is_err(),
        "a PID must never decode into a SessionId"
    );
}

/// §2.2.5: the macOS shape reports no per-app capability and refuses the per-app commands
/// loudly, so the UI can render the notice instead of dead sliders.
#[test]
fn the_master_only_shape_refuses_per_app_commands() {
    let webview = webview_with(Arc::new(MockAudioBackend::master_only()));

    let capabilities = invoke(&webview, "get_platform_capabilities", json!({}))
        .expect("capabilities are always available");
    assert_eq!(capabilities["hasPerAppVolume"], json!(false));
    assert!(capabilities["unsupportedReason"].is_string());

    let error = invoke(&webview, "get_audio_sessions", json!({}))
        .expect_err("a master-only backend must not return an empty session list");
    assert_eq!(error["kind"], json!("unsupported"));

    invoke(&webview, "get_master_state", json!({})).expect("master state still works");
}

#[test]
fn panel_visibility_is_the_only_command_that_touches_the_meter_gate() {
    let webview = full_per_app();

    invoke(&webview, "set_panel_visibility", json!({ "isVisible": true }))
        .expect("visibility write");

    let state = webview.state::<AudioState>();
    assert!(state.is_panel_visible());

    invoke(
        &webview,
        "set_panel_visibility",
        json!({ "isVisible": false }),
    )
    .expect("visibility write");

    assert!(!state.is_panel_visible());
}
