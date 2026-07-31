//! Tray icon, menu, and panel placement.
//!
//! Startup is ordered so the tray is interactive before the WebView exists — that ordering *is*
//! the tray-ready budget. [`register`] therefore runs ahead of the window builder, and it
//! reports failure instead of aborting so a desktop without tray support can fall back to a
//! normal decorated window.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

use crate::commands::AudioState;

const TOGGLE_ITEM_ID: &str = "toggle-panel";
const TRAY_ID: &str = "somul-tray";

/// Where the panel should hang from: the horizontal centre of the tray icon and its lower edge,
/// in the global coordinate space that spans every display.
#[derive(Clone, Copy)]
pub struct TrayAnchor {
    pub center_x: f64,
    pub bottom_y: f64,
}

/// Panel interaction state: the user's pin, and the tray anchor the panel positions against.
#[derive(Default)]
pub struct PanelState {
    is_pinned: AtomicBool,
    tray_anchor: Mutex<Option<TrayAnchor>>,
}

impl PanelState {
    pub fn is_pinned(&self) -> bool {
        self.is_pinned.load(Ordering::Acquire)
    }

    pub fn set_pinned(&self, is_pinned: bool) {
        self.is_pinned.store(is_pinned, Ordering::Release);
    }

    fn tray_anchor(&self) -> Option<TrayAnchor> {
        *self
            .tray_anchor
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn set_tray_anchor(&self, anchor: TrayAnchor) {
        *self
            .tray_anchor
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(anchor);
    }

}

/// Records the pin and puts the window on every Space, or back on just one.
///
/// The stored flag and the window's collection behaviour have to move together: the flag is only
/// a record, and the native call is the entire user-visible effect of pinning.
pub fn apply_pin<R: Runtime>(app: &AppHandle<R>, is_pinned: bool) {
    if let Some(state) = app.try_state::<PanelState>() {
        state.set_pinned(is_pinned);
    }

    // `not(test)` because the mock runtime the command tests use answers `ns_window` with a
    // pointer to a dangling zero-sized value. Tauri dereferences it to find the enclosing window
    // before this code sees it, so any AppKit call taken from a mock window kills the test binary
    // with SIGSEGV rather than failing an assertion. The state half above is the part the tests
    // assert on; the native half has no meaning without a real window behind it.
    #[cfg(all(target_os = "macos", not(test)))]
    if let Some(panel) = app.get_webview_window(crate::PANEL_LABEL) {
        crate::set_macos_collection_behavior(&panel, is_pinned);
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

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Somul")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(|tray, event| {
            // `Click` fires twice per click — once for Down, once for Up. Matching the variant
            // alone toggles the panel open on press and shut again on release, so it only
            // appeared to work while the button was held.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                remember_tray_anchor(tray.app_handle(), &rect);
                toggle_panel(tray.app_handle());
            }
        })
        .build(app)
        .is_ok()
}

/// Records where the tray icon sits, from the click that just happened.
///
/// Only a fallback: [`tray_anchor`] asks the icon directly, and a click is the one moment a
/// platform that cannot answer that question still reports the rect.
fn remember_tray_anchor<R: Runtime>(app: &AppHandle<R>, rect: &tauri::Rect) {
    if let Some(state) = app.try_state::<PanelState>() {
        state.set_tray_anchor(anchor_from_rect(app, rect));
    }
}

/// Where the panel should hang from right now.
///
/// Asked of the tray icon rather than remembered from a click, because a click is not the only
/// way the panel opens: the hotkey, the tray menu, and a second launch all reach [`show_panel`]
/// without one. Reading only the stored anchor left those paths with nothing to position against
/// on the first open, so the panel appeared wherever the window builder had left it — the middle
/// of the primary display — and only moved to the tray once the icon had been clicked at least
/// once. Asking every time also keeps the anchor honest when the menu bar's layout shifts.
///
/// The stored anchor remains the fallback for a platform that cannot report the rect on demand.
fn tray_anchor<R: Runtime>(app: &AppHandle<R>) -> Option<TrayAnchor> {
    let live = app
        .tray_by_id(TRAY_ID)
        .and_then(|tray| tray.rect().ok().flatten())
        .map(|rect| anchor_from_rect(app, &rect));

    live.or_else(|| app.try_state::<PanelState>().and_then(|state| state.tray_anchor()))
}

/// Reduces a tray rect to the point the panel hangs from, in physical pixels.
///
/// The rect arrives in whichever unit the platform reports, so it is normalised against the
/// panel's scale factor — mixing logical and physical coordinates across a Retina and a
/// non-Retina display puts the panel roughly twice as far from the tray as intended.
fn anchor_from_rect<R: Runtime>(app: &AppHandle<R>, rect: &tauri::Rect) -> TrayAnchor {
    let scale = panel(app)
        .and_then(|panel| panel.scale_factor().ok())
        .unwrap_or(1.0);

    let position = rect.position.to_physical::<f64>(scale);
    let size = rect.size.to_physical::<f64>(scale);

    TrayAnchor {
        center_x: position.x + size.width / 2.0,
        bottom_y: position.y + size.height,
    }
}

/// Centres a panel of `panel_width` under `center_x`, held inside the display when one is known.
///
/// Split out from the window call so the arithmetic can be tested — it is the part that decides
/// whether the panel lands on the right screen, and it is easy to get subtly wrong at the seam
/// between two displays.
fn centered_under(center_x: f64, panel_width: f64, monitor: Option<(f64, f64)>) -> f64 {
    let centered = center_x - panel_width / 2.0;

    let Some((left, width)) = monitor else {
        return centered;
    };

    let right = left + width - panel_width;

    // A panel wider than the display cannot be contained; pin it to the left edge rather than
    // letting `clamp` panic on an inverted range.
    if right <= left {
        return left;
    }

    centered.clamp(left, right)
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let toggle = MenuItem::with_id(app, TOGGLE_ITEM_ID, "Show Somul", true, None::<&str>)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit Somul"))?;
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

/// The tray icon and the hotkey are the only things that close the panel, so this is a plain
/// toggle. It used to need a grace period to tell "the user is dismissing an open panel" from
/// "the user is reopening a closed one", because focus loss had already hidden the panel by the
/// time the click arrived. Nothing hides on focus loss any more, so `is_visible` is the truth.
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
    let app = panel.app_handle();

    // Before the window appears, not after. The system volume may have moved while the panel was
    // closed, and the WebView still holds the value from last time. Emitting first lets it repaint
    // while hidden, so the panel opens already showing the truth instead of correcting itself in
    // front of the user.
    resync_master(app);

    if let Some(anchor) = tray_anchor(app) {
        position_under_tray(panel, anchor);
    }

    let _ = panel.show();
    let _ = panel.set_focus();

    set_panel_visibility(app, true);
}

/// Places the panel under the tray icon, on the display that icon lives on.
///
/// Coordinate units are the whole difficulty here, and Tauri is not consistent about them:
///
/// - the tray rect and `Monitor::position/size` are **physical** pixels
/// - `monitor_from_point` expects **logical** points, so feeding it physical coordinates finds
///   nothing on a Retina display and silently skips the clamp
/// - `set_position` treats even a `PhysicalPosition` as logical and scales it by the current
///   monitor's factor, so a physical value lands at twice the intended offset on a Retina screen
///
/// So the monitor is looked up by hand in physical space, and the final position is converted to
/// logical against the *target* display's scale rather than whatever the window sits on now.
fn position_under_tray<R: Runtime>(panel: &WebviewWindow<R>, anchor: TrayAnchor) {
    let Some(monitor) = monitor_containing(panel.app_handle(), anchor.center_x, anchor.bottom_y)
    else {
        return;
    };

    let scale = monitor.scale_factor();
    let origin = monitor.position();
    let size = monitor.size();

    // The panel is 360 logical pixels wide whichever display it lands on, so its physical width
    // depends on the *target* monitor. `outer_size()` reports the width for the display the panel
    // currently occupies, which is the wrong one exactly when it matters.
    let panel_width = crate::PANEL_WIDTH * scale;

    let x = centered_under(
        anchor.center_x,
        panel_width,
        Some((f64::from(origin.x), f64::from(size.width))),
    );

    // Converted against the target display, then applied twice. The first call carries the window
    // onto that display; only then does `set_position` scale by the right factor, so the second
    // call lands where it was asked to.
    let logical = tauri::LogicalPosition::new(x / scale, anchor.bottom_y / scale);

    let _ = panel.set_position(logical);
    let _ = panel.set_position(logical);
}

/// Finds the display containing a point, in physical pixels.
///
/// Done by hand because `monitor_from_point` takes logical points; mixing the two returns `None`
/// on any display whose scale factor is not 1.
fn monitor_containing<R: Runtime>(
    app: &AppHandle<R>,
    x: f64,
    y: f64,
) -> Option<tauri::Monitor> {
    let monitors = app.available_monitors().ok()?;

    monitors.into_iter().find(|monitor| {
        let origin = monitor.position();
        let size = monitor.size();
        let left = f64::from(origin.x);
        let top = f64::from(origin.y);

        x >= left
            && x < left + f64::from(size.width)
            && y >= top
            && y < top + f64::from(size.height)
    })
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

    /// The panel hangs centred under the tray icon when it fits.
    #[test]
    fn centres_the_panel_under_the_tray_icon() {
        assert_eq!(centered_under(1000.0, 360.0, Some((0.0, 1920.0))), 820.0);
    }

    /// A tray near the right edge would otherwise push half the panel off the display.
    #[test]
    fn holds_the_panel_inside_the_right_edge() {
        assert_eq!(centered_under(1900.0, 360.0, Some((0.0, 1920.0))), 1560.0);
    }

    #[test]
    fn holds_the_panel_inside_the_left_edge() {
        assert_eq!(centered_under(10.0, 360.0, Some((0.0, 1920.0))), 0.0);
    }

    /// A second display sits at a non-zero origin in the global coordinate space. Clamping to
    /// 0-based bounds is what dragged the panel back onto the primary screen.
    #[test]
    fn respects_a_secondary_display_offset_from_the_origin() {
        let x = centered_under(4000.0, 360.0, Some((3024.0, 1920.0)));

        assert_eq!(x, 3820.0);
        assert!(x >= 3024.0, "panel escaped onto the primary display");
    }

    #[test]
    fn holds_the_panel_inside_a_secondary_display_right_edge() {
        assert_eq!(centered_under(4930.0, 360.0, Some((3024.0, 1920.0))), 4584.0);
    }

    #[test]
    fn centres_without_clamping_when_the_display_is_unknown() {
        assert_eq!(centered_under(1000.0, 360.0, None), 820.0);
    }

    /// `clamp` panics on an inverted range, which a panel wider than the display would produce.
    #[test]
    fn pins_to_the_left_edge_when_the_panel_exceeds_the_display() {
        assert_eq!(centered_under(150.0, 360.0, Some((0.0, 320.0))), 0.0);
    }

    /// Unpinned is the ordinary single-Space window; the pin is what opts into every Space.
    #[test]
    fn starts_unpinned() {
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
