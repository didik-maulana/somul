use tauri::{AppHandle, Runtime, State, Window};

use crate::commands::AudioState;

/// Not cosmetic. Flipping this to `false` stops the meter loop entirely, which is where the
/// background CPU budget is enforced — a hidden panel must cost no audio work at all.
#[tauri::command]
pub fn set_panel_visibility(state: State<'_, AudioState>, is_visible: bool) {
    state.set_panel_visible(is_visible);
}

/// Matches the window's own appearance to the resolved theme, or hands it back to macOS.
///
/// The vibrancy material behind the panel follows the window appearance, not the CSS, so without
/// this a user who forces light while macOS is dark gets light content on a dark blur.
///
/// `None` means the user chose to follow the system. It has to clear the override rather than
/// resolve it here, because a forced appearance also pins `prefers-color-scheme` inside the
/// WebView: once the window was told to be light, the page could no longer see that macOS was
/// dark, and switching back to "system" left it stuck on whatever had been forced last.
#[tauri::command]
pub fn set_panel_appearance<R: Runtime>(window: Window<R>, is_dark: Option<bool>) {
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
/// Anchored at the audio-capture pane, with the Privacy root as a fallback.
///
/// The service Somul needs is `kTCCServiceAudioCapture`, which macOS presents under Screen &
/// System Audio Recording - not under Microphone, which is a different service entirely and the
/// one a user looking for an audio permission reaches for first. Landing them on the right pane
/// is most of the fix. The root is kept behind it because an anchor macOS does not recognise
/// opens nothing at all, and Settings not opening reads as the button being broken.
#[tauri::command]
pub fn open_audio_permission_settings() -> Result<(), crate::audio::AudioError> {
    #[cfg(all(target_os = "macos", not(test)))]
    {
        const AUDIO_CAPTURE_PANE: &str =
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture";
        const PRIVACY_PANE: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy";

        std::process::Command::new("open")
            .arg(AUDIO_CAPTURE_PANE)
            .spawn()
            .or_else(|_| std::process::Command::new("open").arg(PRIVACY_PANE).spawn())
            .map_err(|error| {
                crate::audio::AudioError::BackendFailure(format!(
                    "could not open System Settings: {error}"
                ))
            })?;
    }

    Ok(())
}

/// Restarts Somul so an audio-capture permission granted since launch can take effect.
///
/// The engine already rebuilds its taps to re-ask macOS, and that is enough for most of what can
/// go wrong. It cannot reach this case: macOS settles the capture question once per process, so a
/// grant that lands while Somul is running is invisible to every tap this process will ever
/// create. A new process is the only thing that gets a fresh answer.
///
/// The single-instance lock is released first. It is held for the lifetime of the process, and
/// the replacement starts while this one is still exiting — it would find the lock taken, hand its
/// arguments to a process on its way out, and quit, leaving no Somul running at all.
///
/// Never returns on success: the process is replaced mid-call, so the frontend's promise dies
/// with it rather than resolving.
#[tauri::command]
pub fn relaunch_app<R: Runtime>(app: AppHandle<R>) {
    // The mock runtime has no process to replace, and the handler test invokes this by name like
    // any other command — unguarded, it would restart the test binary.
    #[cfg(not(test))]
    {
        #[cfg(desktop)]
        tauri_plugin_single_instance::destroy(&app);

        app.restart();
    }

    #[cfg(test)]
    let _ = app;
}
