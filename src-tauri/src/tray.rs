//! Tray icon, menu, and panel placement.
//!
//! Startup is ordered so the tray is interactive before the WebView exists — that ordering *is*
//! the tray-ready budget. [`register`] therefore runs ahead of the window builder, and it
//! reports failure instead of aborting so a desktop without tray support can fall back to a
//! normal decorated window.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow, WindowEvent};
use tauri_plugin_positioner::{Position, WindowExt};

use crate::commands::AudioState;

const TOGGLE_ITEM_ID: &str = "toggle-panel";

/// Clicking the tray while the panel is open takes focus away from it first, so the focus-loss
/// rule hides the panel *before* the click event arrives. A toggle would then see a
/// hidden panel and reopen it, and the panel could never be dismissed from the tray.
///
/// Within this window, a toggle treats the panel as still open and leaves it closed.
const FOCUS_HIDE_GRACE: Duration = Duration::from_millis(300);

/// Showing the panel while another application is frontmost takes a moment to become key, and
/// macOS delivers a spurious `Focused(false)` in the gap. Hiding on that would make the panel
/// openable only from the desktop — every click from inside another app would flash and vanish.
const SHOW_SETTLE: Duration = Duration::from_millis(400);

/// Panel interaction state: the user's pin, plus the timestamps that keep show and hide from
/// fighting each other.
#[derive(Default)]
pub struct PanelState {
    is_pinned: AtomicBool,
    last_focus_hide: Mutex<Option<Instant>>,
    last_shown: Mutex<Option<Instant>>,
}

impl PanelState {
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

    fn shown_guard(&self) -> std::sync::MutexGuard<'_, Option<Instant>> {
        self.last_shown
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn record_shown(&self) {
        *self.shown_guard() = Some(Instant::now());
    }

    /// True while the panel is still settling into key focus after being shown.
    fn is_settling(&self) -> bool {
        self.shown_guard()
            .is_some_and(|at| at.elapsed() < SHOW_SETTLE)
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
/// `libayatana-appindicator3`, or GNOME without the AppIndicator extension. The caller
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
            // The positioner needs every tray event forwarded, or TrayBottomCenter has no
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
        .try_state::<PanelState>()
        .is_some_and(|pin| pin.has_just_hidden_on_focus_loss());

    if panel.is_visible().unwrap_or(false) {
        hide_panel(&panel);
    } else if !was_dismissed_by_this_click {
        show_panel(&panel);
    }
}

pub fn show_panel<R: Runtime>(panel: &WebviewWindow<R>) {
    let app = panel.app_handle();

    if let Some(state) = app.try_state::<PanelState>() {
        state.record_shown();
    }

    // Before the window appears, not after. The system volume may have moved while the panel was
    // closed, and the WebView still holds the value from last time. Emitting first lets it repaint
    // while hidden, so the panel opens already showing the truth instead of correcting itself in
    // front of the user.
    resync_master(app);

    // The constrained variant clamps to screen bounds, which is what keeps the panel
    // on-screen with a multi-monitor layout or a tray near a display edge.
    let _ = panel.move_window_constrained(Position::TrayBottomCenter);
    let _ = panel.show();
    let _ = panel.set_focus();

    set_panel_visibility(app, true);
}

pub fn hide_panel<R: Runtime>(panel: &WebviewWindow<R>) {
    let _ = panel.hide();

    set_panel_visibility(panel.app_handle(), false);
}

/// Pushes the current system output state to the WebView.
///
/// The meter loop also emits a resync on its first tick after opening, which covers paths that do
/// not go through [`show_panel`]. This one exists to beat the window to the screen.
fn resync_master<R: Runtime>(app: &AppHandle<R>) {
    use tauri::Emitter;

    let Some(state) = app.try_state::<AudioState>() else {
        return;
    };

    if let Ok(master) = state.backend().master() {
        let _ = app.emit(crate::meter::MASTER_RESYNC_EVENT, &master);
    }
}

/// Hiding must stop the meter loop. Going through the shared state rather than the IPC
/// command keeps the tray path and the frontend path on one gate.
fn set_panel_visibility<R: Runtime>(app: &AppHandle<R>, is_visible: bool) {
    if let Some(state) = app.try_state::<AudioState>() {
        state.set_panel_visible(is_visible);
    }
}

/// Focus loss hides the panel unless the user pinned it, and hiding stops the meter loop.
pub fn handle_window_event<R: Runtime>(panel: &WebviewWindow<R>, event: &WindowEvent) {
    let WindowEvent::Focused(false) = event else {
        return;
    };

    let Some(state) = panel.app_handle().try_state::<PanelState>() else {
        return;
    };

    if state.is_pinned() {
        return;
    }

    // Opening over another application does not make the panel key immediately, and macOS
    // reports a `Focused(false)` in that gap. Acting on it would hide the panel the instant it
    // appeared — which is exactly the "only opens from the desktop" symptom.
    if state.is_settling() {
        return;
    }

    // Stamped before hiding so a tray click arriving right after can tell "the user dismissed
    // this" from "the user wants it open".
    state.record_focus_hide();
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
        let pin = PanelState::default();

        pin.record_focus_hide();

        assert!(pin.has_just_hidden_on_focus_loss());
    }

    /// One suppression per hide — otherwise the tray icon stops opening the panel entirely.
    #[test]
    fn the_suppression_is_consumed_by_the_first_click() {
        let pin = PanelState::default();

        pin.record_focus_hide();

        assert!(pin.has_just_hidden_on_focus_loss());
        assert!(!pin.has_just_hidden_on_focus_loss());
    }

    #[test]
    fn a_click_with_no_preceding_focus_hide_opens_the_panel() {
        assert!(!PanelState::default().has_just_hidden_on_focus_loss());
    }

    #[test]
    fn a_stale_focus_hide_no_longer_suppresses_the_open() {
        let pin = PanelState::default();

        *pin.guard() = Some(Instant::now() - FOCUS_HIDE_GRACE - Duration::from_millis(50));

        assert!(!pin.has_just_hidden_on_focus_loss());
    }

    /// Opening over another app does not make the panel key at once, and macOS reports a
    /// `Focused(false)` in the gap. Hiding on that is the "only opens from the desktop" bug.
    #[test]
    fn a_freshly_shown_panel_ignores_the_focus_loss_that_follows_it() {
        let state = PanelState::default();

        state.record_shown();

        assert!(state.is_settling());
    }

    #[test]
    fn a_panel_that_was_never_shown_is_not_settling() {
        assert!(!PanelState::default().is_settling());
    }

    /// The window is bounded — a genuine click-away after it elapses must still dismiss.
    #[test]
    fn focus_loss_hides_the_panel_once_it_has_settled() {
        let state = PanelState::default();

        *state.shown_guard() = Some(Instant::now() - SHOW_SETTLE - Duration::from_millis(50));

        assert!(!state.is_settling());
    }

    #[test]
    fn starts_unpinned_so_focus_loss_hides_the_panel() {
        assert!(!PanelState::default().is_pinned());
    }

    #[test]
    fn tracks_the_pin_toggle() {
        let pin = PanelState::default();

        pin.set_pinned(true);
        assert!(pin.is_pinned());

        pin.set_pinned(false);
        assert!(!pin.is_pinned());
    }
}
