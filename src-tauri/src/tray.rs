//! Tray icon, menu, and panel placement.
//!
//! ARCHITECTURE.md §8.1 orders startup so the tray is interactive before the WebView exists —
//! that ordering *is* the 300 ms tray-ready budget. [`register`] therefore runs ahead of the
//! window builder, and it reports failure instead of aborting so the §8.2 Linux fallback can
//! open a normal decorated window.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow, WindowEvent};
use tauri_plugin_positioner::{Position, WindowExt};

use crate::commands::AudioState;

const TOGGLE_ITEM_ID: &str = "toggle-panel";

/// Clicking the tray while the panel is open takes focus away from it first, so the §8.2
/// focus-loss rule hides the panel *before* the click event arrives. A toggle would then see a
/// hidden panel and reopen it, and the panel could never be dismissed from the tray.
///
/// Within this window, a toggle treats the panel as still open and leaves it closed.
const FOCUS_HIDE_GRACE: Duration = Duration::from_millis(300);

/// §8.2: the panel hides on focus loss unless the user pinned it.
#[derive(Default)]
pub struct PanelPin {
    is_pinned: AtomicBool,
    last_focus_hide: Mutex<Option<Instant>>,
}

impl PanelPin {
    pub fn is_pinned(&self) -> bool {
        self.is_pinned.load(Ordering::Acquire)
    }

    pub fn set_pinned(&self, is_pinned: bool) {
        self.is_pinned.store(is_pinned, Ordering::Release);
    }

    fn guard(&self) -> std::sync::MutexGuard<'_, Option<Instant>> {
        self.last_focus_hide
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn record_focus_hide(&self) {
        *self.guard() = Some(Instant::now());
    }

    /// True when a focus-loss hide just fired — i.e. this click is a dismiss, not a reopen.
    fn has_just_hidden_on_focus_loss(&self) -> bool {
        let mut last = self.guard();

        let is_recent = last.is_some_and(|at| at.elapsed() < FOCUS_HIDE_GRACE);

        // Consumed either way: a stale timestamp must not suppress the next genuine open.
        *last = None;

        is_recent
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

            // `Click` fires twice per click — once for Down, once for Up. Matching the variant
            // alone toggles the panel open on press and shut again on release, so it only
            // appeared to work while the button was held.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
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

    let was_dismissed_by_this_click = app
        .try_state::<PanelPin>()
        .is_some_and(|pin| pin.has_just_hidden_on_focus_loss());

    if panel.is_visible().unwrap_or(false) {
        hide_panel(&panel);
    } else if !was_dismissed_by_this_click {
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

    let Some(pin) = panel.app_handle().try_state::<PanelPin>() else {
        return;
    };

    if pin.is_pinned() {
        return;
    }

    // Stamped before hiding so a tray click arriving right after can tell "the user dismissed
    // this" from "the user wants it open".
    pin.record_focus_hide();
    hide_panel(panel);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A quick click delivers Down and Up. Toggling on both opens the panel on press and shuts
    /// it on release, which is why the panel only stayed up while the button was held.
    #[test]
    fn only_the_button_release_counts_as_a_click() {
        let is_toggle = |button: MouseButton, button_state: MouseButtonState| {
            matches!(
                (button, button_state),
                (MouseButton::Left, MouseButtonState::Up)
            )
        };

        assert!(is_toggle(MouseButton::Left, MouseButtonState::Up));
        assert!(!is_toggle(MouseButton::Left, MouseButtonState::Down));
        assert!(!is_toggle(MouseButton::Right, MouseButtonState::Up));
        assert!(!is_toggle(MouseButton::Middle, MouseButtonState::Up));
    }

    /// Clicking the tray with the panel open hides it via focus loss first; the toggle must read
    /// that as a dismiss rather than reopening a panel the user just closed.
    #[test]
    fn a_focus_loss_hide_suppresses_the_reopen_that_follows_it() {
        let pin = PanelPin::default();

        pin.record_focus_hide();

        assert!(pin.has_just_hidden_on_focus_loss());
    }

    /// One suppression per hide — otherwise the tray icon stops opening the panel entirely.
    #[test]
    fn the_suppression_is_consumed_by_the_first_click() {
        let pin = PanelPin::default();

        pin.record_focus_hide();

        assert!(pin.has_just_hidden_on_focus_loss());
        assert!(!pin.has_just_hidden_on_focus_loss());
    }

    #[test]
    fn a_click_with_no_preceding_focus_hide_opens_the_panel() {
        assert!(!PanelPin::default().has_just_hidden_on_focus_loss());
    }

    #[test]
    fn a_stale_focus_hide_no_longer_suppresses_the_open() {
        let pin = PanelPin::default();

        *pin.guard() = Some(Instant::now() - FOCUS_HIDE_GRACE - Duration::from_millis(50));

        assert!(!pin.has_just_hidden_on_focus_loss());
    }

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
