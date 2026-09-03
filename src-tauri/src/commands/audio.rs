//! The IPC command surface.
//!
//! Every handler is one delegation to the [`AudioBackend`](crate::audio::AudioBackend) and
//! returns `Result<T, AudioError>`. No clamping, no diffing, no capability branching — all of
//! that belongs to the adapter, so a bug has exactly one place to live.

use tauri::State;

use crate::audio::{
    AudioDevice, AudioError, AudioSession, DeviceId, MasterState, PlatformCapabilities, SessionId,
};
use crate::commands::AudioState;

#[tauri::command]
pub fn get_platform_capabilities(state: State<'_, AudioState>) -> PlatformCapabilities {
    state.backend().capabilities()
}

#[tauri::command]
pub fn get_audio_sessions(state: State<'_, AudioState>) -> Result<Vec<AudioSession>, AudioError> {
    state.backend().list_sessions()
}

#[tauri::command]
pub fn set_session_volume(
    state: State<'_, AudioState>,
    session_id: SessionId,
    volume: f32,
) -> Result<(), AudioError> {
    state.backend().set_session_volume(&session_id, volume)
}

#[tauri::command]
pub fn set_session_mute(
    state: State<'_, AudioState>,
    session_id: SessionId,
    is_muted: bool,
) -> Result<(), AudioError> {
    state.backend().set_session_mute(&session_id, is_muted)
}

#[tauri::command]
pub fn get_master_state(state: State<'_, AudioState>) -> Result<MasterState, AudioError> {
    state.backend().master()
}

#[tauri::command]
pub fn set_master_volume(state: State<'_, AudioState>, volume: f32) -> Result<(), AudioError> {
    state.backend().set_master_volume(volume)
}

#[tauri::command]
pub fn set_master_mute(state: State<'_, AudioState>, is_muted: bool) -> Result<(), AudioError> {
    state.backend().set_master_mute(is_muted)
}

#[tauri::command]
pub fn list_output_devices(state: State<'_, AudioState>) -> Result<Vec<AudioDevice>, AudioError> {
    state.backend().list_output_devices()
}

#[tauri::command]
pub fn set_default_output_device(
    state: State<'_, AudioState>,
    device_id: DeviceId,
) -> Result<(), AudioError> {
    state.backend().set_default_output_device(&device_id)
}

/// A null `deviceId` puts the session back to following the system default.
#[tauri::command]
pub fn set_session_output_device(
    state: State<'_, AudioState>,
    session_id: SessionId,
    device_id: Option<DeviceId>,
) -> Result<(), AudioError> {
    state
        .backend()
        .set_session_output_device(&session_id, device_id.as_ref())
}
