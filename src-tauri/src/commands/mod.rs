pub mod audio;
pub mod panel;
pub mod settings;
#[cfg(test)]
mod tests;
pub mod update;

use std::sync::Arc;

use crate::audio::AudioBackend;
use crate::meter::MeterGate;

/// The whole command surface, declared once. `lib.rs` and the handler tests both expand this
/// macro, so a command that reaches production unregistered cannot pass the test suite.
#[macro_export]
macro_rules! somul_command_handlers {
    () => {
        tauri::generate_handler![
            $crate::commands::audio::get_platform_capabilities,
            $crate::commands::audio::get_audio_sessions,
            $crate::commands::audio::set_session_volume,
            $crate::commands::audio::set_session_mute,
            $crate::commands::audio::get_master_state,
            $crate::commands::audio::set_master_volume,
            $crate::commands::audio::set_master_mute,
            $crate::commands::audio::list_output_devices,
            $crate::commands::audio::set_default_output_device,
            $crate::commands::audio::set_session_output_device,
            $crate::commands::panel::set_panel_visibility,
            $crate::commands::panel::open_audio_permission_settings,
            $crate::commands::panel::relaunch_app,
            $crate::commands::panel::set_panel_appearance,
            $crate::commands::settings::get_settings,
            $crate::commands::settings::update_settings,
            $crate::commands::settings::set_hotkey_capture,
            $crate::commands::update::get_update_state,
            $crate::commands::update::check_for_update,
            $crate::commands::update::install_update,
            $crate::commands::update::open_update_window,
        ]
    };
}

/// The adapter selected for this platform, plus the flag that gates the meter loop.
///
/// Handlers stay thin: everything in `commands/` delegates here, and no audio logic lives above
/// the [`AudioBackend`] boundary. That keeps each behaviour in exactly one place.
pub struct AudioState {
    backend: Arc<dyn AudioBackend>,
    gate: Arc<MeterGate>,
}

impl AudioState {
    /// The backend is shared rather than owned: the meter loop and the command layer must drive
    /// the *same* adapter instance. Two owners would build two OS session enumerators, and their
    /// views of which sessions exist would drift apart.
    pub fn new(backend: Arc<dyn AudioBackend>, gate: Arc<MeterGate>) -> Self {
        Self { backend, gate }
    }

    pub fn backend(&self) -> &dyn AudioBackend {
        self.backend.as_ref()
    }

    pub fn is_panel_visible(&self) -> bool {
        self.gate.is_visible()
    }

    /// Flipping this to false stops the meter loop outright — see [`crate::meter`].
    pub fn set_panel_visible(&self, is_visible: bool) {
        self.gate.set_visible(is_visible);
    }
}
