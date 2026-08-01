//! Tray icon, menu, and panel placement.
//!
//! Startup is ordered so the tray is interactive before the WebView exists — that ordering *is*
//! the tray-ready budget. [`register`] therefore runs ahead of the window builder, and it
//! reports failure instead of aborting so a desktop without tray support can fall back to a
//! normal decorated window.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

use crate::commands::AudioState;

const TOGGLE_ITEM_ID: &str = "toggle-panel";
const TRAY_ID: &str = "somul-tray";

/// Clicking the tray while the panel is open takes focus away from it first, so the focus-loss
/// rule hides the panel *before* the click event arrives. A toggle would then see a hidden panel
/// and reopen it, and the panel could never be dismissed from the tray.
///
/// Within this window, a toggle treats the panel as still open and leaves it closed.
const FOCUS_HIDE_GRACE: Duration = Duration::from_millis(300);

/// Opening the panel activates the application, and the activation can flap for a moment before
/// it settles. A dismiss arriving inside this window is that flap rather than the user leaving,
/// and acting on it would hide the panel the instant it appeared.
///
/// Deliberately short. At 400 ms it also swallowed genuine dismisses from a user who opened the
/// panel and switched window straight away.
const SHOW_SETTLE: Duration = Duration::from_millis(120);

/// How long the panel takes to fade away when it is dismissed.
///
/// Short enough that the panel is gone by the time attention has moved to whatever was clicked,
/// long enough to read as the window receding rather than being cut. Cutting the window straight
/// to hidden is what made an ordinary click outside feel like a glitch.
#[cfg(all(target_os = "macos", not(test)))]
const DISMISS_DURATION: Duration = Duration::from_millis(140);

/// Alpha steps across [`DISMISS_DURATION`]. Enough that the ramp reads as continuous at 60 Hz
/// without posting a main-thread task per frame.
const DISMISS_STEPS: u32 = 10;

/// Where the panel should hang from: the horizontal centre of the tray icon and its lower edge,
/// in the global coordinate space that spans every display.
#[derive(Clone, Copy)]
pub struct TrayAnchor {
    pub center_x: f64,
    pub bottom_y: f64,
}

/// Panel interaction state: the tray anchor the panel positions against, the timestamps that keep
/// the show and the focus-loss dismiss from fighting each other, and the in-flight fade.
#[derive(Default)]
pub struct PanelState {
    tray_anchor: Mutex<Option<TrayAnchor>>,
    last_focus_hide: Mutex<Option<Instant>>,
    last_shown: Mutex<Option<Instant>>,
    is_dismissing: AtomicBool,
    /// Bumped on every show, so a fade still running knows it has been superseded and must not
    /// carry on dimming a panel the user has just reopened.
    show_generation: AtomicU64,
}

impl PanelState {
    fn instant(slot: &Mutex<Option<Instant>>) -> std::sync::MutexGuard<'_, Option<Instant>> {
        slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// True once a dismiss has begun, for as long as the fade is still running.
    ///
    /// The window is still on screen throughout, so `is_visible` alone would call a fading panel
    /// open and a tray click would try to dismiss it a second time.
    fn is_dismissing(&self) -> bool {
        self.is_dismissing.load(Ordering::Acquire)
    }

    /// Claims the dismiss, returning the generation the fade must stay on to remain current.
    /// `None` when a fade is already running, so a second dismiss does not start a second one.
    fn begin_dismiss(&self) -> Option<u64> {
        self.is_dismissing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| self.show_generation.load(Ordering::Acquire))
    }

    fn end_dismiss(&self) {
        self.is_dismissing.store(false, Ordering::Release);
    }

    /// True when the panel has been shown since `generation` was taken — the fade holding it is
    /// stale and must leave the window alone.
    fn is_superseded(&self, generation: u64) -> bool {
        self.show_generation.load(Ordering::Acquire) != generation
    }

    fn record_shown(&self) {
        self.show_generation.fetch_add(1, Ordering::AcqRel);
        self.end_dismiss();
        *Self::instant(&self.last_shown) = Some(Instant::now());
    }

    /// True while the panel is still settling into key focus after being shown.
    fn is_settling(&self) -> bool {
        Self::instant(&self.last_shown).is_some_and(|at| at.elapsed() < SHOW_SETTLE)
    }

    fn record_focus_hide(&self) {
        *Self::instant(&self.last_focus_hide) = Some(Instant::now());
    }

    /// True when a focus-loss dismiss just fired — i.e. this click is a dismiss, not a reopen.
    fn has_just_hidden_on_focus_loss(&self) -> bool {
        let mut last = Self::instant(&self.last_focus_hide);

        let is_recent = last.is_some_and(|at| at.elapsed() < FOCUS_HIDE_GRACE);

        // Consumed either way: a stale timestamp must not suppress the next genuine open.
        *last = None;

        is_recent
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

/// The alpha a fade sits at `progress` of the way through, smoothstepped so it leaves 1.0 and
/// arrives at 0.0 gently instead of starting and stopping abruptly.
fn dismiss_alpha(progress: f64) -> f64 {
    let progress = progress.clamp(0.0, 1.0);

    1.0 - progress * progress * (3.0 - 2.0 * progress)
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

    live.or_else(|| {
        app.try_state::<PanelState>()
            .and_then(|state| state.tray_anchor())
    })
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

/// Toggles the panel, treating a dismiss that has already happened as this click's work.
///
/// The panel dismisses on focus loss, and clicking the tray takes focus away from it first — so
/// by the time the click arrives the panel is already going away. Reading `is_visible` alone
/// would call that a reopen, and the panel could never be dismissed from the tray.
pub fn toggle_panel<R: Runtime>(app: &AppHandle<R>) {
    let Some(panel) = panel(app) else {
        return;
    };

    let state = app.try_state::<PanelState>();

    let was_dismissed_by_this_click = state
        .as_ref()
        .is_some_and(|state| state.has_just_hidden_on_focus_loss());

    // A fading panel is still on screen but on its way out, so it counts as closed. Otherwise a
    // click landing mid-fade would ask for a second dismiss and the panel would never reopen.
    let is_fading = state.as_ref().is_some_and(|state| state.is_dismissing());
    let is_open = panel.is_visible().unwrap_or(false) && !is_fading;

    if is_open {
        hide_panel(&panel);
    } else if !was_dismissed_by_this_click {
        show_panel(&panel);
    }
}

/// Dismisses the panel because the user moved to another application.
///
/// Separate from [`hide_panel`] so the guards below apply only to this path — the tray, the
/// hotkey and the menu are deliberate and must always be obeyed.
pub fn dismiss_on_resign_active<R: Runtime>(panel: &WebviewWindow<R>) {
    if leaving_is_premature(panel) {
        return;
    }

    hide_panel(panel);
}

/// Dismisses the panel because the user moved to another desktop.
///
/// Without the fade, unlike every other dismiss. The Space transition is itself a half-second of
/// sliding animation, and a panel dissolving *during* it does not read as a fade — it reads as
/// the flicker the animation was already threatening to look like. Gone before the slide starts
/// is the only thing that looks deliberate.
pub fn dismiss_on_desktop_change<R: Runtime>(panel: &WebviewWindow<R>) {
    if leaving_is_premature(panel) {
        return;
    }

    finish_hide(panel);
}

/// Shared guard for the two "the user left" dismisses.
///
/// Records the dismiss as it allows one through, so a tray click arriving immediately afterwards
/// can tell "the user dismissed this" from "the user wants it open".
fn leaving_is_premature<R: Runtime>(panel: &WebviewWindow<R>) -> bool {
    let Some(state) = panel.app_handle().try_state::<PanelState>() else {
        return true;
    };

    // Opening the panel activates the application, and that can flap before it settles. Acting on
    // a dismiss inside that window would hide the panel the instant it appeared.
    if state.is_settling() {
        return true;
    }

    state.record_focus_hide();

    false
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

    let anchor = tray_anchor(app);

    // Placed before the window appears, so it is never seen arriving at the wrong spot.
    if let Some(anchor) = anchor {
        position_under_tray(panel, anchor);
    }

    // A dismiss that was interrupted leaves the window part-way through its fade, and `show`
    // alone would bring it back translucent or invisible. Restored before the window appears, so
    // the panel is never seen at anything but full opacity.
    restore_alpha(panel);

    let _ = panel.show();
    let _ = panel.set_focus();

    // Placed a second time, after the window is on screen. Ordering a hidden window front can
    // move it, and this call is cheap and idempotent. It is *not* a fix for the corner-placement
    // defect — that is still open, and this does not close it.
    if let Some(anchor) = anchor {
        position_under_tray(panel, anchor);
    }

    set_panel_visibility(app, true);
}

/// Places the panel under the tray icon, on the display that icon lives on.
///
/// Coordinate units are the whole difficulty here, and Tauri is not consistent about them:
///
/// - the tray rect and `Monitor::position/size` are **physical** pixels
/// - `monitor_from_point` expects **logical** points, so feeding it physical coordinates finds
///   nothing on a Retina display and silently skips the clamp
///
/// So the monitor is looked up by hand in physical space, and the arithmetic stays in that space
/// until [`place_panel`] hands it to whichever placement the platform can do reliably.
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

    place_panel(panel, x, anchor.bottom_y, scale);
}

/// Puts the panel's top-left corner at a physical global point, through AppKit.
///
/// Going native is what makes the placement deterministic — see [`crate::place_macos_panel`] for
/// why `set_position` could not be trusted across displays.
#[cfg(all(target_os = "macos", not(test)))]
fn place_panel<R: Runtime>(panel: &WebviewWindow<R>, x: f64, top: f64, scale: f64) {
    let panel = panel.clone();

    let _ = panel
        .app_handle()
        .clone()
        .run_on_main_thread(move || crate::place_macos_panel(&panel, x, top, scale));
}

/// Elsewhere, Tauri's own placement is all there is. It reads a logical position, so the physical
/// point is converted against the display it is going to.
#[cfg(not(all(target_os = "macos", not(test))))]
fn place_panel<R: Runtime>(panel: &WebviewWindow<R>, x: f64, top: f64, scale: f64) {
    let _ = panel.set_position(tauri::LogicalPosition::new(x / scale, top / scale));
}

/// Finds the display containing a point, in physical pixels.
///
/// Done by hand because `monitor_from_point` takes logical points; mixing the two returns `None`
/// on any display whose scale factor is not 1.
fn monitor_containing<R: Runtime>(app: &AppHandle<R>, x: f64, y: f64) -> Option<tauri::Monitor> {
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

/// Dismisses the panel by fading it out, then taking it off the screen.
///
/// The fade is on the window's own alpha rather than anything in the WebView, because the
/// wallpaper blur behind the panel is an AppKit view: fading the content in CSS would leave the
/// blurred rectangle behind, which reads worse than no animation at all.
pub fn hide_panel<R: Runtime>(panel: &WebviewWindow<R>) {
    // With no state to coordinate through there is nothing to animate against, so the panel goes
    // straight off the screen rather than not going at all.
    let Some(state) = panel.app_handle().try_state::<PanelState>() else {
        finish_hide(panel);
        return;
    };

    // A fade already in flight is on its way to hidden; restarting it would only reset the ramp.
    let Some(generation) = state.begin_dismiss() else {
        return;
    };

    fade_out(panel, generation);
}

/// Runs the alpha ramp off the main thread, then hands the actual hide back to [`finish_hide`].
///
/// Off-thread because the ramp is mostly sleeping, and the main thread has a 60 fps meter to
/// serve. Each step is a short task posted back to it, which is also the only place AppKit may be
/// touched.
#[cfg(all(target_os = "macos", not(test)))]
fn fade_out<R: Runtime>(panel: &WebviewWindow<R>, generation: u64) {
    let panel = panel.clone();

    std::thread::spawn(move || {
        for step in 1..=DISMISS_STEPS {
            std::thread::sleep(DISMISS_DURATION / DISMISS_STEPS);

            if is_superseded(&panel, generation) {
                return;
            }

            apply_fade_step(
                &panel,
                dismiss_alpha(f64::from(step) / f64::from(DISMISS_STEPS)),
                generation,
            );
        }

        if !is_superseded(&panel, generation) {
            finish_hide(&panel);
        }
    });
}

/// Without a window alpha to animate, a dismiss is the hide it always was.
#[cfg(not(all(target_os = "macos", not(test))))]
fn fade_out<R: Runtime>(panel: &WebviewWindow<R>, _generation: u64) {
    finish_hide(panel);
}

/// True once the panel has been reopened since this fade started, which retires the fade.
#[cfg(all(target_os = "macos", not(test)))]
fn is_superseded<R: Runtime>(panel: &WebviewWindow<R>, generation: u64) -> bool {
    panel
        .app_handle()
        .try_state::<PanelState>()
        .is_some_and(|state| state.is_superseded(generation))
}

/// Takes the window off the screen and releases the dismiss.
fn finish_hide<R: Runtime>(panel: &WebviewWindow<R>) {
    let _ = panel.hide();

    set_panel_visibility(panel.app_handle(), false);

    if let Some(state) = panel.app_handle().try_state::<PanelState>() {
        state.end_dismiss();
    }
}

/// Dims the window one fade step, on the main thread where AppKit requires it.
///
/// The generation is re-checked *inside* the task rather than only before posting it. A step can
/// be posted just as the panel is reopened, landing after the restore below and leaving the panel
/// on screen but dimmed — checking at the point of application is what closes that window.
///
/// `not(test)` for the same reason as the rest of the native layer: the mock runtime answers
/// `ns_window` with a pointer to a dangling zero-sized value, and Tauri dereferences it looking
/// for the enclosing window, so an AppKit call reached from a mock window kills the test binary
/// with SIGSEGV rather than failing an assertion.
#[cfg(all(target_os = "macos", not(test)))]
fn apply_fade_step<R: Runtime>(panel: &WebviewWindow<R>, alpha: f64, generation: u64) {
    let panel = panel.clone();

    let _ = panel.app_handle().clone().run_on_main_thread(move || {
        if !is_superseded(&panel, generation) {
            crate::set_macos_window_alpha(&panel, alpha);
        }
    });
}

/// Returns the window to full opacity, before it is shown.
#[cfg(all(target_os = "macos", not(test)))]
fn restore_alpha<R: Runtime>(panel: &WebviewWindow<R>) {
    let panel = panel.clone();

    let _ = panel
        .app_handle()
        .clone()
        .run_on_main_thread(move || crate::set_macos_window_alpha(&panel, 1.0));
}

#[cfg(not(all(target_os = "macos", not(test))))]
fn restore_alpha<R: Runtime>(panel: &WebviewWindow<R>) {
    let _ = panel;
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
///
/// Showing also tells the panel itself. The window is shown by this process rather than by the
/// user clicking into it, and an accessory window that never takes key focus gives the webview
/// no `focus` or `visibilitychange` to hang anything on — so anything in the UI that has to
/// restart when the panel appears has this event and nothing else.
fn set_panel_visibility<R: Runtime>(app: &AppHandle<R>, is_visible: bool) {
    if let Some(state) = app.try_state::<AudioState>() {
        state.set_panel_visible(is_visible);
    }

    if is_visible {
        let _ = app.emit(crate::PANEL_SHOWN_EVENT, ());
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
        assert_eq!(
            centered_under(4930.0, 360.0, Some((3024.0, 1920.0))),
            4584.0
        );
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

    /// The fade leaves at full opacity and arrives at none, or the panel would jump at one end.
    #[test]
    fn the_dismiss_fade_spans_the_whole_alpha_range() {
        assert_eq!(dismiss_alpha(0.0), 1.0);
        assert_eq!(dismiss_alpha(1.0), 0.0);
    }

    #[test]
    fn the_dismiss_fade_falls_the_whole_way() {
        let mut previous = dismiss_alpha(0.0);

        for step in 1..=DISMISS_STEPS {
            let alpha = dismiss_alpha(f64::from(step) / f64::from(DISMISS_STEPS));

            assert!(alpha < previous, "the fade stalled at step {step}");
            previous = alpha;
        }
    }

    /// Progress is a ratio of elapsed steps, so a value outside the range means arithmetic drift.
    /// Clamping keeps that from reaching `setAlphaValue`, which would take it literally.
    #[test]
    fn the_dismiss_fade_holds_the_unit_range() {
        assert_eq!(dismiss_alpha(-1.0), 1.0);
        assert_eq!(dismiss_alpha(2.0), 0.0);
    }

    /// The panel is only ever dismissed once at a time: the second caller gets nothing to run,
    /// so two fades cannot fight over the same alpha.
    #[test]
    fn only_one_dismiss_runs_at_a_time() {
        let state = PanelState::default();

        assert!(state.begin_dismiss().is_some());
        assert!(state.begin_dismiss().is_none());

        state.end_dismiss();
        assert!(state.begin_dismiss().is_some());
    }

    /// Reopening mid-fade retires the fade, or it would carry on dimming the panel the user just
    /// asked for and finish by hiding it.
    #[test]
    fn showing_the_panel_retires_a_running_dismiss() {
        let state = PanelState::default();

        let generation = state.begin_dismiss().expect("the first dismiss claims it");
        assert!(!state.is_superseded(generation));

        state.record_shown();

        assert!(state.is_superseded(generation));
        assert!(!state.is_dismissing(), "a show must release the dismiss");
    }
}
