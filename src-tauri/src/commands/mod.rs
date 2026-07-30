pub mod audio;
pub mod panel;
#[cfg(test)]
mod tests;

use std::sync::Arc;

use crate::audio::AudioBackend;
use crate::meter::MeterGate;

/// The §7.1 command surface, declared once. `lib.rs` and the handler tests both expand this, so
/// a command that reaches production unregistered cannot pass the suite.
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
        ]
    };
}

/// The adapter selected for this platform, plus the flag that gates the meter loop.
///
/// ARCHITECTURE.md §5 keeps handlers thin: everything in `commands/` delegates here, and no
/// audio logic lives above the [`AudioBackend`] boundary.
pub struct AudioState {
    backend: Arc<dyn AudioBackend>,
    gate: Arc<MeterGate>,
}

impl AudioState {
    /// The backend is shared rather than owned: the meter loop and the command layer must drive
    /// the *same* adapter instance, or a WASAPI enumerator gets built twice and the two copies
    /// drift apart.
    pub fn new(backend: Arc<dyn AudioBackend>, gate: Arc<MeterGate>) -> Self {
        Self { backend, gate }
    }

    pub fn backend(&self) -> &dyn AudioBackend {
        self.backend.as_ref()
    }

    pub fn is_panel_visible(&self) -> bool {
        self.gate.is_visible()
    }

    /// §4.1: flipping this to false stops the meter loop outright.
    pub fn set_panel_visible(&self, is_visible: bool) {
        self.gate.set_visible(is_visible);
    }
}
