use tauri::State;

use crate::commands::AudioState;

/// ARCHITECTURE.md §7.1: this is not cosmetic. Flipping it to `false` stops the meter loop
/// entirely (§4.1), which is where the `< 0.1%` background CPU budget is enforced.
#[tauri::command]
pub fn set_panel_visibility(state: State<'_, AudioState>, is_visible: bool) {
    state.set_panel_visible(is_visible);
}
