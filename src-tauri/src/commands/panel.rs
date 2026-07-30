use tauri::{Manager, Runtime, State, Window};

use crate::commands::AudioState;
use crate::tray::PanelState;

/// Not cosmetic. Flipping this to `false` stops the meter loop entirely, which is where the
/// background CPU budget is enforced — a hidden panel must cost no audio work at all.
#[tauri::command]
pub fn set_panel_visibility(state: State<'_, AudioState>, is_visible: bool) {
    state.set_panel_visible(is_visible);
}

/// Keeps the panel open when it loses focus.
///
/// Without this the panel hides the moment you click anything else, which makes it impossible to
/// adjust a volume while watching the app you are adjusting. Pinning is the escape hatch: the
/// focus-loss rule is skipped until it is turned back off.
#[tauri::command]
pub fn set_panel_pinned<R: Runtime>(window: Window<R>, is_pinned: bool) {
    if let Some(state) = window.app_handle().try_state::<PanelState>() {
        state.set_pinned(is_pinned);
    }
}
