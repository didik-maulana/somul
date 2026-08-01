use tauri::{Runtime, State, Window};

use crate::commands::AudioState;

/// Not cosmetic. Flipping this to `false` stops the meter loop entirely, which is where the
/// background CPU budget is enforced — a hidden panel must cost no audio work at all.
#[tauri::command]
pub fn set_panel_visibility(state: State<'_, AudioState>, is_visible: bool) {
    state.set_panel_visible(is_visible);
}

/// Matches the window's own appearance to the resolved theme.
///
/// The vibrancy material behind the panel follows the window appearance, not the CSS, so without
/// this a user who forces light while macOS is dark gets light content on a dark blur.
#[tauri::command]
pub fn set_panel_appearance<R: Runtime>(window: Window<R>, is_dark: bool) {
    // `not(test)` for the same reason as `tray::apply_pin`: AppKit calls made against a mock
    // window crash the test binary inside Tauri's own handle lookup.
    #[cfg(all(target_os = "macos", not(test)))]
    {
        use tauri::Manager;

        if let Some(panel) = window.app_handle().get_webview_window(crate::PANEL_LABEL) {
            crate::set_macos_appearance(&panel, is_dark);
        }
    }

    #[cfg(not(all(target_os = "macos", not(test))))]
    {
        let _ = window;
        let _ = is_dark;
    }
}

/// Opens the Privacy & Security pane where audio capture is granted.
///
/// The panel offers this instead of printing a path for the user to walk: the permission is the
/// one thing standing between a listed app and a working slider, and a notice with no action is
/// how a user concludes the app is broken.
///
/// Anchored at Privacy rather than a named service. macOS moves audio capture between anchors
/// across releases, and a stale anchor opens nothing at all, where the root pane always opens.
#[tauri::command]
pub fn open_audio_permission_settings() -> Result<(), crate::audio::AudioError> {
    #[cfg(all(target_os = "macos", not(test)))]
    {
        const PRIVACY_PANE: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy";

        std::process::Command::new("open")
            .arg(PRIVACY_PANE)
            .spawn()
            .map_err(|error| {
                crate::audio::AudioError::BackendFailure(format!(
                    "could not open System Settings: {error}"
                ))
            })?;
    }

    Ok(())
}
