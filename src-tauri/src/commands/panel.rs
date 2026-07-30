use tauri::{Manager, Runtime, State, Window};

use crate::commands::AudioState;

/// Not cosmetic. Flipping this to `false` stops the meter loop entirely, which is where the
/// background CPU budget is enforced — a hidden panel must cost no audio work at all.
#[tauri::command]
pub fn set_panel_visibility(state: State<'_, AudioState>, is_visible: bool) {
    state.set_panel_visible(is_visible);
}

/// Puts the panel on every Space, or back on just one.
///
/// The panel stays open until the tray or the hotkey closes it either way — pinning is about
/// *where* it exists, not how long. Unpinned it lives on the Space it was opened on, which is
/// what an ordinary window does; pinned it follows you across desktops, so a volume can be
/// adjusted from wherever the audio is playing.
#[tauri::command]
pub fn set_panel_pinned<R: Runtime>(window: Window<R>, is_pinned: bool) {
    crate::tray::apply_pin(window.app_handle(), is_pinned);
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
    if let Some(panel) = window.app_handle().get_webview_window(crate::PANEL_LABEL) {
        crate::set_macos_appearance(&panel, is_dark);
    }

    #[cfg(not(all(target_os = "macos", not(test))))]
    {
        let _ = window;
        let _ = is_dark;
    }
}
