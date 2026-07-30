//! Reading and writing persisted settings.
//!
//! Every setting has a side effect somewhere outside the store — the hotkey has to be registered
//! with the OS, launch-at-login has to be toggled, the pin has to reach the window handler. The
//! store is written only after those succeed, so a rejected change is never persisted as though
//! it had worked.

use serde::Serialize;
use tauri::{AppHandle, Runtime};

use crate::settings::{self, AppSettings};
use crate::shortcut::{self, HotkeyStatus};
use crate::tray::PanelState;

/// The result of applying a settings change.
///
/// Carries a warning rather than failing when the hotkey is unavailable: another application
/// owning the combination is a normal outcome, and the rest of the change should still stick.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdate {
    pub settings: AppSettings,
    pub hotkey_warning: Option<String>,
}

#[tauri::command]
pub fn get_settings<R: Runtime>(app: AppHandle<R>) -> AppSettings {
    settings::load(&app)
}

#[tauri::command]
pub fn update_settings<R: Runtime>(
    app: AppHandle<R>,
    settings: AppSettings,
) -> Result<SettingsUpdate, String> {
    let previous = crate::settings::load(&app);
    let mut applied = settings;

    let hotkey_warning = apply_hotkey(&app, &previous, &mut applied);
    apply_launch_at_login(&app, &previous, &applied);
    apply_pin(&app, &applied);

    crate::settings::save(&app, &applied)?;

    Ok(SettingsUpdate {
        settings: applied,
        hotkey_warning,
    })
}

/// Re-registers the shortcut when it changed, falling back to the previous one if the new
/// combination is unavailable — losing the old shortcut *and* not gaining the new one would leave
/// the panel reachable only from the tray.
fn apply_hotkey<R: Runtime>(
    app: &AppHandle<R>,
    previous: &AppSettings,
    applied: &mut AppSettings,
) -> Option<String> {
    if applied.hotkey == previous.hotkey {
        return shortcut::status(app).and_then(|status| status.warning());
    }

    match shortcut::register(app, &applied.hotkey) {
        HotkeyStatus::Registered(_) => None,
        unavailable => {
            let warning = unavailable.warning();

            shortcut::register(app, &previous.hotkey);
            applied.hotkey.clone_from(&previous.hotkey);

            warning
        }
    }
}

fn apply_launch_at_login<R: Runtime>(
    app: &AppHandle<R>,
    previous: &AppSettings,
    applied: &AppSettings,
) {
    if applied.should_launch_at_login == previous.should_launch_at_login {
        return;
    }

    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;

        let manager = app.autolaunch();

        let _ = if applied.should_launch_at_login {
            manager.enable()
        } else {
            manager.disable()
        };
    }

    #[cfg(not(desktop))]
    let _ = app;
}

fn apply_pin<R: Runtime>(app: &AppHandle<R>, applied: &AppSettings) {
    use tauri::Manager;

    if let Some(state) = app.try_state::<PanelState>() {
        state.set_pinned(applied.is_panel_pinned);
    }
}

/// Frees the global shortcut while the user records a replacement, and restores it afterwards.
#[tauri::command]
pub fn set_hotkey_capture<R: Runtime>(app: AppHandle<R>, is_capturing: bool) {
    if is_capturing {
        shortcut::suspend(&app);
    } else {
        shortcut::resume(&app);
    }
}
