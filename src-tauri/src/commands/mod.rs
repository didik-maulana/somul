pub mod audio;
pub mod panel;
#[cfg(test)]
mod tests;

use std::sync::atomic::{AtomicBool, Ordering};

use crate::audio::AudioBackend;

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
    backend: Box<dyn AudioBackend>,
    is_panel_visible: AtomicBool,
}

impl AudioState {
    pub fn new(backend: Box<dyn AudioBackend>) -> Self {
        Self {
            backend,
            is_panel_visible: AtomicBool::new(false),
        }
    }

    pub fn backend(&self) -> &dyn AudioBackend {
        self.backend.as_ref()
    }

    /// §4.1: the meter loop reads this every tick and does no audio work while it is false.
    pub fn is_panel_visible(&self) -> bool {
        self.is_panel_visible.load(Ordering::Acquire)
    }

    pub fn set_panel_visible(&self, is_visible: bool) {
        self.is_panel_visible.store(is_visible, Ordering::Release);
    }
}
