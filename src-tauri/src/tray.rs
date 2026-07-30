//! Tray icon, menu, and panel placement.
//!
//! ARCHITECTURE.md §8.1 orders startup so the tray is interactive before the WebView exists —
//! that ordering *is* the 300 ms tray-ready budget. [`register`] therefore runs ahead of the
//! window builder, and it reports failure instead of aborting so the §8.2 Linux fallback can
//! open a normal decorated window.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow, WindowEvent};
use tauri_plugin_positioner::{Position, WindowExt};

use crate::commands::AudioState;

const TOGGLE_ITEM_ID: &str = "toggle-panel";

/// §8.2: the panel hides on focus loss unless the user pinned it.
#[derive(Default)]
pub struct PanelPin(AtomicBool);

impl PanelPin {
    pub fn is_pinned(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }

    pub fn set_pinned(&self, is_pinned: bool) {
        self.0.store(is_pinned, Ordering::Release);
    }
}

/// Registers the tray icon and menu.
///
/// Returns `false` when the platform refuses one — a Linux desktop without
/// `libayatana-appindicator3`, or GNOME without the AppIndicator extension (§8.2). The caller
/// falls back to a normal window; exiting would leave the user with no way to reach the app.
pub fn register<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Ok(menu) = build_menu(app) else {
        return false;
    };
    let Some(icon) = app.default_window_icon().cloned() else {
        return false;
    };

    TrayIconBuilder::with_id("somul-tray")
        .icon(icon)
        .tooltip("SOMUL")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(|tray, event| {
            // §8.2: the positioner needs every tray event forwarded, or TrayBottomCenter has no
            // tray rectangle to anchor against and silently falls back to the screen center.
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);

            if let TrayIconEvent::Click { .. } = event {
                toggle_panel(tray.app_handle());
            }
        })
        .build(app)
        .is_ok()
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let toggle = MenuItem::with_id(app, TOGGLE_ITEM_ID, "Show SOMUL", true, None::<&str>)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit SOMUL"))?;
    let separator = PredefinedMenuItem::separator(app)?;

    Menu::with_items(app, &[&toggle, &separator, &quit])
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    if event.id() == TOGGLE_ITEM_ID {
        toggle_panel(app);
    }
}

fn panel<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(crate::PANEL_LABEL)
}

pub fn toggle_panel<R: Runtime>(app: &AppHandle<R>) {
    let Some(panel) = panel(app) else {
        return;
    };

    if panel.is_visible().unwrap_or(false) {
        hide_panel(&panel);
    } else {
        show_panel(&panel);
    }
}

pub fn show_panel<R: Runtime>(panel: &WebviewWindow<R>) {
    // §8.2: the constrained variant clamps to screen bounds, which is what keeps the panel
    // on-screen with a multi-monitor layout or a tray near a display edge.
    let _ = panel.move_window_constrained(Position::TrayBottomCenter);
    let _ = panel.show();
    let _ = panel.set_focus();

    set_panel_visibility(panel.app_handle(), true);
}

pub fn hide_panel<R: Runtime>(panel: &WebviewWindow<R>) {
    let _ = panel.hide();

    set_panel_visibility(panel.app_handle(), false);
}

/// §4.1: hiding must stop the meter loop. Going through the shared state rather than the IPC
/// command keeps the tray path and the frontend path on one gate.
fn set_panel_visibility<R: Runtime>(app: &AppHandle<R>, is_visible: bool) {
    if let Some(state) = app.try_state::<AudioState>() {
        state.set_panel_visible(is_visible);
    }
}

/// §8.2: focus loss hides the panel unless it is pinned, and hiding stops the meter loop.
pub fn handle_window_event<R: Runtime>(panel: &WebviewWindow<R>, event: &WindowEvent) {
    let WindowEvent::Focused(false) = event else {
        return;
    };

    let is_pinned = panel
        .app_handle()
        .try_state::<PanelPin>()
        .is_some_and(|pin| pin.is_pinned());

    if !is_pinned {
        hide_panel(panel);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_unpinned_so_focus_loss_hides_the_panel() {
        assert!(!PanelPin::default().is_pinned());
    }

    #[test]
    fn tracks_the_pin_toggle() {
        let pin = PanelPin::default();

        pin.set_pinned(true);
        assert!(pin.is_pinned());

        pin.set_pinned(false);
        assert!(!pin.is_pinned());
    }
}
