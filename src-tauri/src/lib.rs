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

/// Corner radius of the panel, in logical pixels.
///
/// Shared by the CSS surface and the macOS vibrancy layer. The vibrancy view is a real NSView
/// filling the whole window, so it has to be rounded natively — a rounded div on top of a square
/// view leaves the material showing through as four hard corners.
pub const PANEL_RADIUS: f64 = 20.0;

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
            build_panel(app.handle(), has_tray)?;

            // Settings are applied here rather than left to the UI: the hotkey has to work before
            // the panel is ever opened, and the panel is what would otherwise apply it.
            let stored = settings::load(app.handle());

            // A hotkey another app already owns is a degraded state, not a startup failure — the
            // status is kept so the settings view can warn about it.
            #[cfg(desktop)]
            shortcut::register(app.handle(), &stored.hotkey);

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
        // Spaces are handled natively on macOS — see `set_macos_collection_behavior`. This flag
        // would put a copy of the panel on every Space, which is the opposite of a popover that
        // dismisses the moment you move away from it.
        .visible_on_all_workspaces(false)
        .transparent(true)
        .build()?;

    apply_surface_blur(&panel);

    #[cfg(target_os = "macos")]
    {
        set_macos_collection_behavior(&panel);
        dismiss_when_user_leaves(&panel);
    }

    Ok(panel)
}

/// Wallpaper blur is an OS compositor feature: CSS `backdrop-filter` only blurs content inside
/// the WebView and can never reach the desktop behind the window. Platforms without a vibrancy
/// call keep the opaque `bg-popover` fallback, which must stay legible on its own — translucency
/// is never load-bearing for contrast.
fn apply_surface_blur(panel: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        // `Popover` follows the system appearance; `HudWindow` is a permanently dark HUD
        // material, which is why the light theme came out grey no matter what the palette said.
        // `Active` rather than the default `FollowsWindowActiveState`. Left to follow, macOS
        // desaturates the material whenever the panel is not key, so the panel would visibly
        // change colour as it fades out — most obvious in light theme. Its surface should not
        // depend on which window has focus.
        let _ = window_vibrancy::apply_vibrancy(
            panel,
            window_vibrancy::NSVisualEffectMaterial::Popover,
            Some(window_vibrancy::NSVisualEffectState::Active),
            Some(PANEL_RADIUS),
        );

        round_macos_window_corners(panel);
    }

    #[cfg(target_os = "windows")]
    {
        let _ = window_vibrancy::apply_acrylic(panel, None);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = panel;
}

/// Clips the window's content to the panel's rounded rectangle.
///
/// `apply_vibrancy` takes a radius, but it forwards to a private `setCornerRadius:` on
/// `NSVisualEffectView` that current macOS ignores, so the material stays square and shows behind
/// the rounded CSS surface as four hard corners.
///
/// Rounding the content view's own layer with `masksToBounds` clips every subview — the vibrancy
/// view and the WebView alike — using documented Core Animation API instead of a private one.
#[cfg(target_os = "macos")]
/// Borrows the panel's underlying `NSWindow`, or `None` when there is not a real one behind it.
///
/// Every AppKit tweak below needs the same three lines — fetch the handle, reject a missing one,
/// cast — so they live here once rather than three times over.
#[cfg(target_os = "macos")]
fn macos_window<R: tauri::Runtime>(panel: &WebviewWindow<R>) -> Option<&objc2_app_kit::NSWindow> {
    let handle = panel.ns_window().ok()?;

    if handle.is_null() {
        return None;
    }

    // SAFETY: a non-null `ns_window` is the panel's live `NSWindow`, which Tauri keeps alive for
    // as long as the window exists — so the borrow cannot outlive it. Callers are on the main
    // thread: `setup` runs there, and so do synchronous `#[tauri::command]` handlers.
    Some(unsafe { &*handle.cast::<objc2_app_kit::NSWindow>() })
}

/// Dismisses the panel when the user moves away from it — to another application, or to another
/// desktop.
///
/// The dismiss used to hang off the window's own `Focused(false)`, which is a much noisier signal
/// than it looks. On a multi-display setup macOS resigns the panel's key status merely for moving
/// the pointer onto another screen, so the panel closed itself when the user had done nothing but
/// look away — and an application switch produced a burst of focus changes rather than one.
///
/// Resigning *active* is the event that actually means "the user has gone somewhere else": it
/// fires for a click on another app or on the desktop, and for Cmd-Tab, but never for a pointer
/// crossing a screen boundary. Leaving for another desktop is a second, separate signal — see
/// below — because it changes no application's activation at all.
#[cfg(target_os = "macos")]
fn dismiss_when_user_leaves(panel: &WebviewWindow) {
    use objc2_app_kit::NSApplicationDidResignActiveNotification;
    use objc2_foundation::NSNotificationCenter;

    let on_resign = panel.clone();
    let on_space_change = panel.clone();

    let resigned = unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(NSApplicationDidResignActiveNotification),
            None,
            None,
            &block2::RcBlock::new(move |_: core::ptr::NonNull<objc2_foundation::NSNotification>| {
                tray::dismiss_on_resign_active(&on_resign);
            }),
        )
    };

    // Switching desktop is the other way of leaving the panel behind, and it is not an activation
    // change — the frontmost application need not change, so nothing resigns. Without this the
    // panel would stay open on the desktop it was left on, waiting to be found again.
    //
    // Space notifications come from the workspace's own centre, not the default one.
    let space_changed = unsafe {
        objc2_app_kit::NSWorkspace::sharedWorkspace()
            .notificationCenter()
            .addObserverForName_object_queue_usingBlock(
                Some(objc2_app_kit::NSWorkspaceActiveSpaceDidChangeNotification),
                None,
                None,
                &block2::RcBlock::new(
                    move |_: core::ptr::NonNull<objc2_foundation::NSNotification>| {
                        tray::dismiss_on_desktop_change(&on_space_change);
                    },
                ),
            )
    };

    // Observers live only while something holds them, and these have to outlive every caller —
    // they are the panel's dismiss for the whole run. There is no later point that would remove
    // them, so both registrations are deliberately never released.
    std::mem::forget(resigned);
    std::mem::forget(space_changed);
}

fn round_macos_window_corners(panel: &WebviewWindow) {
    let Some(window) = macos_window(panel) else {
        return;
    };

    let Some(content) = window.contentView() else {
        return;
    };

    content.setWantsLayer(true);

    let Some(layer) = content.layer() else {
        return;
    };

    layer.setCornerRadius(PANEL_RADIUS);
    layer.setMasksToBounds(true);

    // The shadow is cached from the old square path and would otherwise outline the corners.
    window.invalidateShadow();
}

/// Decides which Spaces the panel exists on — the standard menu-bar popover arrangement.
///
/// `moveToActiveSpace` was the obvious choice and was wrong. It does not merely decide where the
/// panel *reopens*: while the panel is on screen, activating an application on another Space has
/// the window server pick the window up and carry it there, and that migration is animated, so
/// the panel visibly slid away rather than fading. None of that shows up in `frame` — AppKit
/// reports the window where it was put while the compositor draws it elsewhere.
///
/// `canJoinAllSpaces` was the obvious answer to that and is wrong for the opposite reason: a
/// window that exists on *every* Space is drawn on the desktop you are sliding towards as well as
/// the one you are leaving, so a three-finger swipe made the panel flash across the transition.
///
/// So neither flag. An ordinary managed window belongs to the Space it was opened on: nothing
/// carries it anywhere, and nothing draws it on a desktop it does not belong to. Leaving it
/// behind is not a problem, because moving to another desktop dismisses it outright — see
/// `dismiss_when_user_leaves`.
///
/// `fullScreenAuxiliary` stays, so the panel can sit over a fullscreen app — adjusting audio
/// during fullscreen video is exactly when a mixer is wanted.
#[cfg(target_os = "macos")]
pub fn set_macos_collection_behavior<R: tauri::Runtime>(panel: &WebviewWindow<R>) {
    use objc2_app_kit::NSWindowCollectionBehavior;

    let Some(window) = macos_window(panel) else {
        return;
    };

    window.setCollectionBehavior(NSWindowCollectionBehavior::FullScreenAuxiliary);
}

/// Sets the window's opacity, which is what the dismiss animates.
///
/// Must be called on the main thread — [`tray::hide_panel`] posts it there.
#[cfg(target_os = "macos")]
pub fn set_macos_window_alpha<R: tauri::Runtime>(panel: &WebviewWindow<R>, alpha: f64) {
    if let Some(window) = macos_window(panel) {
        window.setAlphaValue(alpha);
    }
}

/// Places the panel's top-left corner at a point given in Tauri's physical global space.
///
/// `set_position` cannot do this reliably across displays. It interprets even a `PhysicalPosition`
/// as logical and scales it by whichever display the window *currently* occupies, so moving to a
/// display with a different scale took two calls and trusted that AppKit had reassigned the
/// window's screen in between. That reassignment is not synchronous: when it lagged, the second
/// call rescaled by the old factor and threw the window far off-screen, and macOS clamped it to a
/// corner of the nearest display.
///
/// AppKit's own space has no such ambiguity — points, y upward, origin at the bottom left of the
/// menu-bar screen — so the frame is computed once and set once.
///
/// Must be called on the main thread; [`tray::show_panel`] posts it there.
#[cfg(target_os = "macos")]
pub fn place_macos_panel<R: tauri::Runtime>(
    panel: &WebviewWindow<R>,
    x_physical: f64,
    top_physical: f64,
    scale: f64,
) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSScreen;
    use objc2_foundation::NSPoint;

    let Some(window) = macos_window(panel) else {
        return;
    };
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    // `screens[0]` is the screen carrying the menu bar, and AppKit measures every other screen
    // from its bottom-left corner. Tauri measures from the *top* left of the same screen, so its
    // height is the whole conversion between the two.
    let Some(primary) = NSScreen::screens(mtm).firstObject() else {
        return;
    };

    let top = primary.frame().size.height - top_physical / scale;

    window.setFrameOrigin(NSPoint::new(x_physical / scale, top - PANEL_HEIGHT));
}

/// Points the window's own appearance at light or dark.
///
/// The vibrancy material follows the *window's* appearance, not the app's CSS. Without this a
/// user who forces light while macOS is dark gets light content on a dark blur — the theme
/// override would apply to everything except the surface behind it.
#[cfg(target_os = "macos")]
pub fn set_macos_appearance<R: tauri::Runtime>(panel: &WebviewWindow<R>, is_dark: bool) {
    use objc2_app_kit::{
        NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua,
    };

    let Some(window) = macos_window(panel) else {
        return;
    };

    let name = if is_dark {
        unsafe { NSAppearanceNameDarkAqua }
    } else {
        unsafe { NSAppearanceNameAqua }
    };

    window.setAppearance(NSAppearance::appearanceNamed(name).as_deref());
}

#[cfg(desktop)]
fn focus_panel(app: &AppHandle) {
    if let Some(panel) = app.get_webview_window(PANEL_LABEL) {
        // Through `show_panel`, not `panel.show()`. Showing the window directly skips
        // positioning, leaves the meter loop stopped so the panel opens with dead meters, and
        // never resyncs the volume — a second launch would present a stale, inert panel.
        tray::show_panel(&panel);
    }
}
