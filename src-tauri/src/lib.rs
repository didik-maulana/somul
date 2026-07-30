#![deny(clippy::all)]

pub mod audio;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

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
        .setup(|app| {
            build_panel(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start the SOMUL application");
}

/// ARCHITECTURE.md §8.1: the window is built hidden so the WebView boot cost never lands
/// on the 300 ms tray-ready measurement.
fn build_panel(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let panel = WebviewWindowBuilder::new(app, PANEL_LABEL, WebviewUrl::default())
        .title("SOMUL")
        .inner_size(PANEL_WIDTH, PANEL_HEIGHT)
        .visible(false)
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .transparent(true)
        .build()?;

    apply_surface_blur(&panel);

    Ok(panel)
}

/// DESIGN.md §6: wallpaper blur is an OS compositor feature — `backdrop-filter` only blurs
/// content inside the WebView. Platforms without a vibrancy call keep the opaque
/// `bg-popover` fallback, which must stay legible on its own.
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
