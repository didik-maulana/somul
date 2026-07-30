#![deny(clippy::all)]

pub mod audio;
pub mod commands;
pub mod meter;
#[cfg(desktop)]
pub mod shortcut;
pub mod settings;
pub mod tray;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::tray::PanelState;

/// Selects the platform audio adapter at compile time.
///
/// A target with no adapter yet fails the build by name rather than falling back to
/// [`MockAudioBackend`](audio::mock::MockAudioBackend). A mock standing in for a real backend
/// inside a shipped binary would present working controls that move nothing, which is the same
/// dishonesty the trait forbids of an unsupported operation — one layer up.
#[cfg(target_os = "macos")]
fn platform_backend() -> std::sync::Arc<dyn audio::AudioBackend> {
    std::sync::Arc::new(audio::macos::MacOsAudioBackend::new())
}

#[cfg(target_os = "windows")]
compile_error!(
    "Somul has no Windows audio adapter yet. Implement `AudioBackend` over WASAPI in \
src-tauri/src/audio/windows.rs and select it here."
);

#[cfg(target_os = "linux")]
compile_error!(
    "Somul has no Linux audio adapter yet. Implement `AudioBackend` over PipeWire (with a \
PulseAudio fallback) in src-tauri/src/audio/linux/ and select it here."
);

pub const PANEL_LABEL: &str = "main";
pub const PANEL_WIDTH: f64 = 360.0;
pub const PANEL_HEIGHT: f64 = 520.0;

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
                focus_panel(app);
            }))
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(somul_command_handlers!())
        .manage(PanelState::default())
        .manage(shortcut::HotkeyState::default())
        .setup(|app| {
            // A tray-first panel is an accessory, not a Dock application. As a Regular app it
            // cannot take key focus over whatever is frontmost, so clicking the tray from inside
            // another app opens nothing at all. Accessory is also the macOS counterpart to
            // `skipTaskbar`, which is Windows and Linux only.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // One adapter instance, shared by the command layer and the meter loop. Two would
            // mean two OS enumerators whose views drift apart.
            let backend = platform_backend();
            let gate = std::sync::Arc::new(meter::MeterGate::new());

            app.manage(commands::AudioState::new(
                std::sync::Arc::clone(&backend),
                std::sync::Arc::clone(&gate),
            ));
            app.manage(meter::MeterLoop::start(
                backend,
                gate,
                std::sync::Arc::new(meter::TauriPanelEmitter::new(app.handle().clone())),
            ));

            // Ordering matters: the tray is registered first and is interactive from that point.
            // The WebView then boots behind a hidden window, so its cost never lands on the
            // 300 ms tray-ready measurement.
            let has_tray = tray::register(app.handle());
            let panel = build_panel(app.handle(), has_tray)?;

            panel.on_window_event({
                let panel = panel.clone();
                move |event| tray::handle_window_event(&panel, event)
            });

            // A hotkey another app already owns is a degraded state, not a startup
            // failure — the status is kept so the settings panel can warn about it.
            #[cfg(desktop)]
            shortcut::register(app.handle(), shortcut::DEFAULT_HOTKEY);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start the Somul application");
}

/// Builds the panel window hidden, so the WebView boot cost never lands on the tray-ready
/// measurement.
///
/// Without a tray — a Linux desktop missing `libayatana-appindicator3`, for instance — the panel
/// becomes an ordinary decorated window instead. Keeping it frameless and hidden there would
/// leave the user no way to reach the app at all.
fn build_panel(app: &AppHandle, has_tray: bool) -> tauri::Result<WebviewWindow> {
    let panel = WebviewWindowBuilder::new(app, PANEL_LABEL, WebviewUrl::default())
        .title("Somul")
        .inner_size(PANEL_WIDTH, PANEL_HEIGHT)
        .visible(!has_tray)
        .decorations(!has_tray)
        .resizable(false)
        .skip_taskbar(has_tray)
        .always_on_top(has_tray)
        .transparent(true)
        .build()?;

    apply_surface_blur(&panel);

    Ok(panel)
}

/// Wallpaper blur is an OS compositor feature: CSS `backdrop-filter` only blurs content inside
/// the WebView and can never reach the desktop behind the window. Platforms without a vibrancy
/// call keep the opaque `bg-popover` fallback, which must stay legible on its own — translucency
/// is never load-bearing for contrast.
fn apply_surface_blur(panel: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        let _ = window_vibrancy::apply_vibrancy(
            panel,
            window_vibrancy::NSVisualEffectMaterial::HudWindow,
            None,
            None,
        );
    }

    #[cfg(target_os = "windows")]
    {
        let _ = window_vibrancy::apply_acrylic(panel, None);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = panel;
}

#[cfg(desktop)]
fn focus_panel(app: &AppHandle) {
    if let Some(panel) = app.get_webview_window(PANEL_LABEL) {
        let _ = panel.show();
        let _ = panel.set_focus();
    }
}
