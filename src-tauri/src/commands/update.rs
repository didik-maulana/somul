//! Checking for and installing a newer release.
//!
//! Somul ships outside the App Store, so nothing renews the build on the user's behalf. Without a
//! path from inside the app, the version someone installs is the version they keep — including
//! whichever bugs it shipped with.
//!
//! The check is never automatic beyond a single look at startup, and installing is always the
//! user pressing a button: an update replaces the running binary and restarts it, which is not
//! something to do to a tray app while somebody is mixing audio.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Emitted while an update downloads, so the panel can show how far along it is.
pub const UPDATE_PROGRESS_EVENT: &str = "update://progress";

/// Emitted whenever the update reaches a new resting state.
///
/// Two windows show this — the panel's notice and the release-notes window — and each has its own
/// WebView, so neither can see what the other did. Rust holds the state and announces it instead,
/// which is what keeps the window from offering an install the panel already finished.
pub const UPDATE_CHANGED_EVENT: &str = "update://changed";

/// How much has to arrive between progress events when the server sends no total.
const UNMEASURED_PROGRESS_STEP: u64 = 512 * 1024;

/// How much of the update has arrived.
///
/// `total` comes from the server's `Content-Length` and is absent when it does not send one, which
/// is why the panel has to handle a download it cannot put a percentage on.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}

/// Where the update has got to.
///
/// Deliberately has no `checking` member. A check in flight is something a window says about
/// itself while the user waits on it, not a fact about the app — announcing it would have the
/// release-notes window flash a spinner because the panel was polling behind it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdatePhase {
    /// Nothing has been checked yet.
    #[default]
    Idle,
    UpToDate,
    Available,
    Installing,
    /// On disk. The process still running is the old build.
    Installed,
    Failed,
}

/// Everything both windows need to render the update, as Rust currently understands it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshot {
    pub phase: UpdatePhase,
    pub current_version: String,
    /// `None` when this build is already the newest published one.
    pub available_version: Option<String>,
    /// Release notes as published in the manifest, so the user can read what the update changes
    /// before committing to a restart.
    pub notes: Option<String>,
    /// Why the last install failed, in words the window can show. `None` outside `Failed`.
    ///
    /// Without it a failed install rendered as "Install update" again — the failure kept
    /// `available_version`, and the window read that as an update still waiting rather than one
    /// that had just been refused. Every click retried, every retry failed, nothing said so.
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct Settled {
    phase: UpdatePhase,
    available_version: Option<String>,
    notes: Option<String>,
    reason: Option<String>,
}

/// The update found by the last check, and what the app has been told about it.
///
/// The `Update` handle is kept so that installing applies the release the user was actually
/// shown, rather than whatever the endpoint happens to serve when the button is pressed — the
/// manifest can move between the two, and a version bumping under the one on screen is a lie
/// about what is being installed.
#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<Update>>,
    settled: Mutex<Settled>,
}

impl UpdateState {
    fn remember(&self, update: Option<Update>) {
        *self.pending() = update;
    }

    fn take(&self) -> Option<Update> {
        self.pending().clone()
    }

    fn snapshot(&self, current_version: String) -> UpdateSnapshot {
        let settled = self.settled();

        UpdateSnapshot {
            phase: settled.phase,
            current_version,
            available_version: settled.available_version.clone(),
            notes: settled.notes.clone(),
            reason: settled.reason.clone(),
        }
    }

    /// A poisoned lock holds an `Option<Update>` and nothing more — a panic elsewhere cannot have
    /// left it half-written — so recovering beats denying the user their update.
    fn pending(&self) -> std::sync::MutexGuard<'_, Option<Update>> {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn settled(&self) -> std::sync::MutexGuard<'_, Settled> {
        self.settled
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Records a new resting state and tells every window about it.
fn publish<R: Runtime>(app: &AppHandle<R>, state: &UpdateState, settled: Settled) {
    *state.settled() = settled;

    let _ = app.emit(
        UPDATE_CHANGED_EVENT,
        state.snapshot(app.package_info().version.to_string()),
    );
}

/// Long on purpose, and in the shape a real changelog takes: headings, bullets, and paragraphs
/// that run past one screen. Short stand-in notes hide every layout problem the notes window has.
#[cfg(debug_assertions)]
const FAKE_UPDATE_NOTES: &str = "\
Development override. These are not real release notes, and no such release exists.

## Mixer
- Per-app rows keep their volume and mute across launches, keyed by process name rather than PID
- A row no longer claims a slider it cannot move; an app with no controllable output reads as empty
- Sustained output is required before an app takes a row, so a one-frame beep no longer adds a row
  that disappears while you are reaching for it

## Output devices
- The device menu lists every output the system reports, including aggregates and virtual devices
- Switching output while a drag is in flight applies the level to the device you landed on
- Devices that publish no software volume say so instead of showing a slider that does nothing

## Panel
- The panel dismisses when you switch applications or desktops, and stays put when you merely move
  the pointer to another screen
- The header badge carries a live indicator while audio is being metered
- Corner radius is applied to the window's own layer, so the blur behind the panel is rounded too

## Appearance
- System theme hands the appearance back to macOS rather than guessing at it, which removes the
  flash of the wrong theme when the panel opens
- Light and dark both draw against opaque surfaces first; translucency is never load-bearing for
  contrast

## Fixes
- The tray no longer opens a second panel when the app is launched while already running
- Rebinding the shortcut releases the old combination first, so the panel stops toggling itself
  mid-recording
- Meter work stops entirely while the panel is hidden

Set SOMUL_FAKE_UPDATE to the running version to see the up-to-date state instead.";

/// Announces the version named by `SOMUL_FAKE_UPDATE`, so both windows can be exercised without a
/// signed release behind them.
///
/// Debug builds only — a shipped binary that can be told to claim an update by an environment
/// variable is a way to talk a user into installing something. Setting the variable to the running
/// version drives the up-to-date branch instead, which is the other half of the UI.
///
/// It stands in for the *check*, never the install: nothing is remembered as pending, so pressing
/// Install afterwards fails the way an install with no release does.
/// Whether an update is on disk waiting for the process to be replaced.
fn is_awaiting_restart(settled: &Settled) -> bool {
    settled.phase == UpdatePhase::Installed
}

/// The state after an install that did not happen: still the same release on offer, so the
/// button to try again stays, and now a reason beside it.
fn failed_after(settled: Settled, reason: &str) -> Settled {
    Settled {
        phase: UpdatePhase::Failed,
        reason: Some(reason.to_owned()),
        ..settled
    }
}

/// Walks a fake install: progress in steps, then `Installed`, touching nothing on disk.
#[cfg(debug_assertions)]
async fn fake_install<R: Runtime>(
    app: &AppHandle<R>,
    state: &UpdateState,
    settled: Settled,
) -> Result<(), String> {
    use tauri::Emitter;

    const STEPS: u64 = 12;
    const TOTAL: u64 = 11_000_000;

    publish(
        app,
        state,
        Settled {
            phase: UpdatePhase::Installing,
            ..settled.clone()
        },
    );

    for step in 1..=STEPS {
        let emitter = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            std::thread::sleep(std::time::Duration::from_millis(140));
            let _ = emitter.emit(
                UPDATE_PROGRESS_EVENT,
                UpdateProgress {
                    downloaded: TOTAL * step / STEPS,
                    total: Some(TOTAL),
                },
            );
        })
        .await
        .map_err(|error| error.to_string())?;
    }

    publish(
        app,
        state,
        Settled {
            phase: UpdatePhase::Installed,
            reason: None,
            ..settled
        },
    );

    Ok(())
}

#[cfg(debug_assertions)]
fn fake_settled(current_version: &str, requested: Option<String>) -> Option<Settled> {
    let requested = requested?;
    let announced = requested.trim();

    if announced.is_empty() {
        return None;
    }

    if announced == current_version {
        return Some(Settled {
            phase: UpdatePhase::UpToDate,
            ..Settled::default()
        });
    }

    Some(Settled {
        phase: UpdatePhase::Available,
        available_version: Some(announced.to_owned()),
        // Stand-in notes long enough to exercise the release-notes window's scrolling, and saying
        // plainly what they are: a development override reading like a real changelog is its own
        // kind of confusion.
        notes: Some(FAKE_UPDATE_NOTES.to_owned()),
    reason: None,
    })
}

/// The current state, for a window that has just opened and missed the announcements.
#[tauri::command]
pub fn get_update_state<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, UpdateState>,
) -> UpdateSnapshot {
    state.snapshot(app.package_info().version.to_string())
}

#[tauri::command]
pub async fn check_for_update<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, UpdateState>,
) -> Result<UpdateSnapshot, String> {
    let current_version = app.package_info().version.to_string();

    // An update already on disk outranks whatever the endpoint says now. The endpoint keeps
    // advertising the same release until this process is replaced, so checking again would report
    // it as merely available — and both windows would drop "Restart" for "Install", offering to
    // download what is already installed.
    if is_awaiting_restart(&state.settled()) {
        return Ok(state.snapshot(current_version));
    }

    #[cfg(debug_assertions)]
    if let Some(settled) = fake_settled(&current_version, std::env::var("SOMUL_FAKE_UPDATE").ok()) {
        publish(&app, &state, settled);
        return Ok(state.snapshot(current_version));
    }

    let update = match app.updater().map_err(|error| error.to_string())?.check().await {
        Ok(update) => update,
        Err(error) => {
            publish(
                &app,
                &state,
                Settled {
                    phase: UpdatePhase::Failed,
                    ..Settled::default()
                },
            );

            return Err(error.to_string());
        }
    };

    publish(
        &app,
        &state,
        match update.as_ref() {
            Some(update) => Settled {
                phase: UpdatePhase::Available,
                available_version: Some(update.version.clone()),
                notes: update.body.clone(),
            reason: None,
            },
            None => Settled {
                phase: UpdatePhase::UpToDate,
                ..Settled::default()
            },
        },
    );

    state.remember(update);

    Ok(state.snapshot(current_version))
}

/// Downloads and installs the update found by the last check, and stops there.
///
/// Deliberately does not restart. The new build is on disk from this point, but the process still
/// running is the old one, and replacing it is the user's call — Somul is a mixer, and taking the
/// audio panel away mid-call to finish a background download is not a decision to make for them.
/// [`crate::commands::panel::relaunch_app`] is what finishes the job when they say so.
#[tauri::command]
pub async fn install_update<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, UpdateState>,
) -> Result<(), String> {
    // The guard is dropped before the download starts. Holding it across the await would block
    // every later check behind a transfer that can take minutes.
    let settled = state.settled().clone();

    // Debug builds can walk the whole install flow against the announced fake, with no feed and
    // nothing written to disk. This is how the windows' installing, installed and restart states
    // are exercised at all: a real update needs a published release to test against.
    #[cfg(debug_assertions)]
    if std::env::var("SOMUL_FAKE_UPDATE").is_ok_and(|value| !value.trim().is_empty()) {
        return fake_install(&app, &state, settled).await;
    }

    let Some(update) = state.take() else {
        publish(
            &app,
            &state,
            failed_after(settled, "No update is ready to install. Check again first."),
        );

        return Err("No update is ready to install.".to_owned());
    };

    publish(
        &app,
        &state,
        Settled {
            phase: UpdatePhase::Installing,
            ..settled.clone()
        },
    );

    let mut downloaded: u64 = 0;
    let mut last_percent: Option<u64> = None;
    let mut last_reported_bytes: u64 = 0;

    let outcome = update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;

                // The chunk callback fires once per network read — thousands of times for a bundle
                // this size. A progress bar cannot show more than a percent, so an event per read
                // would flood the WebView into redrawing nothing.
                let is_worth_reporting = match total {
                    Some(total) if total > 0 => {
                        let percent = downloaded.saturating_mul(100) / total;
                        let is_new = last_percent != Some(percent);
                        last_percent = Some(percent);
                        is_new
                    }
                    // No Content-Length: there is no percentage to change, so the bar falls back
                    // to counting bytes and this falls back to a fixed step.
                    _ => downloaded - last_reported_bytes >= UNMEASURED_PROGRESS_STEP,
                };

                if is_worth_reporting {
                    last_reported_bytes = downloaded;
                    let _ = app.emit(UPDATE_PROGRESS_EVENT, UpdateProgress { downloaded, total });
                }
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string());

    publish(
        &app,
        &state,
        match &outcome {
            Ok(()) => Settled {
                phase: UpdatePhase::Installed,
                reason: None,
                ..settled
            },
            Err(reason) => failed_after(settled, reason),
        },
    );

    outcome
}

/// Opens the release-notes window, or brings it forward when it is already open.
///
/// The notes do not belong in the panel. It is 360 px wide and dismisses itself the moment focus
/// moves elsewhere, so a changelog read there disappears on the first click into another app —
/// and a changelog is exactly the thing a user reads slowly, next to whatever they were doing.
#[tauri::command]
pub fn open_update_window<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    crate::open_update_window(&app)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frontend reads these fields by their camel-cased names, like every other payload.
    #[test]
    fn a_snapshot_crosses_the_boundary_in_camel_case() {
        let json = serde_json::to_value(UpdateSnapshot {
            phase: UpdatePhase::Available,
            current_version: "1.0.0".to_owned(),
            available_version: Some("1.1.0".to_owned()),
            notes: Some("Fixes the meter".to_owned()),
            reason: None,
        })
        .expect("a snapshot serializes");

        assert_eq!(json["phase"], serde_json::json!("available"));
        assert_eq!(json["currentVersion"], serde_json::json!("1.0.0"));
        assert_eq!(json["availableVersion"], serde_json::json!("1.1.0"));
        assert_eq!(json["notes"], serde_json::json!("Fixes the meter"));
    }

    /// Both windows branch on this string, so its spelling is part of the contract.
    /// The endpoint keeps advertising a release until the process is replaced, so a check after
    /// an install would demote "Restart" back to "Install" in both windows.
    #[test]
    fn an_update_already_on_disk_is_not_checked_away() {
        assert!(is_awaiting_restart(&Settled {
            phase: UpdatePhase::Installed,
            ..Settled::default()
        }));
        assert!(!is_awaiting_restart(&Settled {
            phase: UpdatePhase::Available,
            ..Settled::default()
        }));
    }

    /// A refused install keeps the release on offer and says why. Dropping the version would hide
    /// the retry; dropping the reason is what made every failed click look like no click at all.
    #[test]
    fn a_failed_install_keeps_the_offer_and_carries_a_reason() {
        let failed = failed_after(
            Settled {
                phase: UpdatePhase::Installing,
                available_version: Some("1.1.0".to_owned()),
                notes: Some("notes".to_owned()),
                reason: None,
            },
            "signature mismatch",
        );

        assert_eq!(failed.phase, UpdatePhase::Failed);
        assert_eq!(failed.available_version.as_deref(), Some("1.1.0"));
        assert_eq!(failed.reason.as_deref(), Some("signature mismatch"));
    }

    #[test]
    fn every_phase_serializes_as_the_name_the_frontend_switches_on() {
        let names = [
            (UpdatePhase::Idle, "idle"),
            (UpdatePhase::UpToDate, "upToDate"),
            (UpdatePhase::Available, "available"),
            (UpdatePhase::Installing, "installing"),
            (UpdatePhase::Installed, "installed"),
            (UpdatePhase::Failed, "failed"),
        ];

        for (phase, name) in names {
            assert_eq!(
                serde_json::to_value(phase).expect("a phase serializes"),
                serde_json::json!(name)
            );
        }
    }

    /// An absent total is what the panel reads to fall back to an indeterminate bar.
    #[test]
    fn progress_survives_a_server_that_sends_no_length() {
        let json = serde_json::to_value(UpdateProgress {
            downloaded: 2_500_000,
            total: None,
        })
        .expect("progress serializes");

        assert_eq!(json["downloaded"], serde_json::json!(2_500_000));
        assert!(json["total"].is_null());
    }

    /// Being on the newest build is an ordinary answer, not an error or an empty response.
    #[test]
    fn no_newer_release_is_reported_as_an_absent_version() {
        let json = serde_json::to_value(UpdateSnapshot {
            phase: UpdatePhase::UpToDate,
            current_version: "1.0.0".to_owned(),
            available_version: None,
            notes: None,
            reason: None,
        })
        .expect("a snapshot serializes");

        assert!(json["availableVersion"].is_null());
    }

    #[test]
    fn the_development_override_announces_the_version_it_names() {
        let settled = fake_settled("1.0.0", Some(" 1.1.0 ".to_owned()))
            .expect("a named version is an announcement");

        assert_eq!(settled.phase, UpdatePhase::Available);
        assert_eq!(settled.available_version.as_deref(), Some("1.1.0"));
    }

    /// The window scrolls, and notes short enough to fit never prove that it does.
    #[test]
    fn the_development_override_carries_notes_worth_scrolling() {
        let settled =
            fake_settled("1.0.0", Some("1.1.0".to_owned())).expect("a named version announces");
        let notes = settled.notes.expect("an announcement carries notes");

        assert!(notes.lines().count() > 20, "notes are one screen or less");
        assert!(notes.contains("## "), "notes carry no headings to render");
    }

    /// The other half of the UI: naming the running version drives the up-to-date branch.
    #[test]
    fn the_development_override_can_also_say_there_is_nothing_new() {
        let settled = fake_settled("1.0.0", Some("1.0.0".to_owned())).expect("still an answer");

        assert_eq!(settled.phase, UpdatePhase::UpToDate);
        assert!(settled.available_version.is_none());
    }

    /// An unset or blank variable must fall through to the real endpoint, not fake an answer.
    #[test]
    fn an_absent_override_leaves_the_check_alone() {
        assert!(fake_settled("1.0.0", None).is_none());
        assert!(fake_settled("1.0.0", Some("  ".to_owned())).is_none());
    }
}
