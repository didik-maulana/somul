//! Global panel-toggle hotkey.
//!
//! Registration can fail when another application already owns the combination. That is a normal outcome, not a fatal one — the app keeps running, surfaces a
//! settings warning, and never retries in a loop.

use std::sync::Mutex;

use tauri::{AppHandle, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const DEFAULT_HOTKEY: &str = "CmdOrCtrl+Shift+V";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HotkeyStatus {
    Registered(String),
    /// Surfaced as a settings warning. The app stays usable through the tray.
    Unavailable { accelerator: String, reason: String },
}

impl HotkeyStatus {
    pub fn is_registered(&self) -> bool {
        matches!(self, Self::Registered(_))
    }

    pub fn warning(&self) -> Option<String> {
        match self {
            Self::Registered(_) => None,
            Self::Unavailable {
                accelerator,
                reason,
            } => Some(format!(
                "The shortcut {accelerator} could not be registered: {reason}. \
Another application may already own it. Open the panel from the tray, or pick a different shortcut."
            )),
        }
    }
}

/// The current binding. `None` until the first registration attempt completes.
#[derive(Default)]
pub struct HotkeyState(Mutex<Option<HotkeyStatus>>);

impl HotkeyState {
    pub fn status(&self) -> Option<HotkeyStatus> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn set(&self, status: HotkeyStatus) {
        *self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(status);
    }
}

fn parse(accelerator: &str) -> Result<Shortcut, String> {
    accelerator
        .parse::<Shortcut>()
        .map_err(|error| format!("{accelerator} is not a valid accelerator ({error})"))
}

/// Registers `accelerator`, replacing any previous binding.
///
/// Returns the outcome rather than an error: a hotkey the user cannot have is a degraded state,
/// not a startup failure.
pub fn register<R: Runtime>(app: &AppHandle<R>, accelerator: &str) -> HotkeyStatus {
    let manager = app.global_shortcut();
    let status = match parse(accelerator) {
        Err(reason) => HotkeyStatus::Unavailable {
            accelerator: accelerator.to_owned(),
            reason,
        },
        Ok(shortcut) => {
            let _ = manager.unregister_all();

            match manager.on_shortcut(shortcut, |app, _shortcut, event| {
                // Fire once per press. Without this the panel toggles again on key release.
                if event.state() == ShortcutState::Pressed {
                    crate::tray::toggle_panel(app);
                }
            }) {
                Ok(()) => HotkeyStatus::Registered(accelerator.to_owned()),
                Err(error) => HotkeyStatus::Unavailable {
                    accelerator: accelerator.to_owned(),
                    reason: error.to_string(),
                },
            }
        }
    };

    if let Some(state) = tauri::Manager::try_state::<HotkeyState>(app) {
        state.set(status.clone());
    }

    status
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_the_documented_accelerator() {
        assert_eq!(DEFAULT_HOTKEY, "CmdOrCtrl+Shift+V");
    }

    #[test]
    fn the_default_accelerator_parses() {
        assert!(parse(DEFAULT_HOTKEY).is_ok());
    }

    #[test]
    fn rejects_a_malformed_accelerator() {
        assert!(parse("NotAKey+++").is_err());
    }

    #[test]
    fn accepts_a_user_rebinding() {
        assert!(parse("Alt+Shift+M").is_ok());
    }

    /// A lost hotkey surfaces a warning and leaves the app running.
    #[test]
    fn an_unavailable_hotkey_produces_a_settings_warning() {
        let status = HotkeyStatus::Unavailable {
            accelerator: DEFAULT_HOTKEY.to_owned(),
            reason: "already registered".to_owned(),
        };

        let warning = status.warning().expect("an unavailable hotkey warns");

        assert!(!status.is_registered());
        assert!(warning.contains(DEFAULT_HOTKEY));
        assert!(warning.contains("tray"));
    }

    #[test]
    fn a_registered_hotkey_produces_no_warning() {
        let status = HotkeyStatus::Registered(DEFAULT_HOTKEY.to_owned());

        assert!(status.is_registered());
        assert_eq!(status.warning(), None);
    }

    #[test]
    fn state_starts_empty_and_records_the_last_attempt() {
        let state = HotkeyState::default();
        assert_eq!(state.status(), None);

        state.set(HotkeyStatus::Registered(DEFAULT_HOTKEY.to_owned()));

        assert_eq!(
            state.status(),
            Some(HotkeyStatus::Registered(DEFAULT_HOTKEY.to_owned()))
        );
    }
}
