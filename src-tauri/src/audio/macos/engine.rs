//! The per-app mixing engine.
//!
//! macOS gives no way to set another process's volume, so the gain has to be applied by someone,
//! and that someone is us. Each app gets a muted tap, every tap is gathered into one private
//! aggregate device alongside the real output, and a single IO proc multiplies each app's audio
//! by its gain on the way through.
//!
//! Two consequences are worth stating plainly:
//!
//! - While the engine runs, every tapped app's audio flows through this process. A stall in the
//!   IO proc is a dropout the user hears, which is why the render path below allocates nothing,
//!   locks nothing, and reads its parameters from atomics.
//! - If the engine fails to start, the taps are destroyed and the apps return to the hardware at
//!   their own level. Failure is silence-free by construction; the fallback is "no mixing", never
//!   "no audio".

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use coreaudio_sys::{
    kAudioDevicePropertyDeviceUID, kAudioObjectPropertyElementMain,
    kAudioObjectPropertyScopeGlobal, AudioBufferList, AudioDeviceCreateIOProcID,
    AudioDeviceDestroyIOProcID, AudioDeviceIOProcID, AudioDeviceStart, AudioDeviceStop,
    AudioHardwareCreateAggregateDevice, AudioHardwareDestroyAggregateDevice, AudioObjectID,
    AudioTimeStamp, CFDictionaryRef, CFStringRef, OSStatus,
};
use objc2::rc::Retained;
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString};

use super::process::ProcessSession;
use super::property::{address, check, read_property, take_cf_string};
use super::tap::{ProcessTap, TapMute};
use crate::audio::AudioError;

/// Every tap is created as a stereo mixdown, which is what makes the channel arithmetic in the
/// render callback a fixed stride rather than a per-tap lookup.
const CHANNELS_PER_TAP: usize = 2;

/// Ceiling on the channels the render callback will index in one cycle. Sixty-four is thirty-two
/// simultaneously mixed apps — far past any real desktop, and small enough to live on the stack
/// so the callback never allocates.
const MAX_CHANNELS: usize = 64;

/// The parameters the render callback reads and the level it publishes back.
///
/// Atomics rather than a lock: the callback runs on a realtime thread that must never block, and
/// a mutex contended by the UI thread is exactly the stall that becomes an audible dropout.
#[derive(Debug)]
pub(super) struct SessionControl {
    /// `f32` bits. Linear scalar, not dB.
    gain: AtomicU32,
    is_muted: AtomicBool,
    /// `f32` bits. Pre-gain, so the meter shows what the app is producing rather than what the
    /// user has turned it down to.
    peak: AtomicU32,
    /// Whether this app has ever put [`SIGNAL_CYCLES`] consecutive render cycles above
    /// [`SIGNAL_FLOOR`] through the tap.
    ///
    /// Sticky. `IsRunningOutput` is true for any process holding an open output stream, playing
    /// or not, which is how a dev tool that opened an audio context at launch and never used it
    /// ended up with a slider in the mixer. Once an app has been heard it keeps its row, so a
    /// paused player does not vanish between tracks.
    has_signal: AtomicBool,
    /// Consecutive cycles above the floor so far, counted only until `has_signal` is set.
    ///
    /// Written from the render callback, so it is an atomic rather than a lock.
    signal_run: AtomicU32,
}

/// Below this a tap is reporting its own noise floor, not audio. -80 dBFS.
const SIGNAL_FLOOR: f32 = 0.0001;

/// How many consecutive cycles above the floor make an app a mixer row.
///
/// One cycle is not evidence. A WebKit-backed app opens its output stream when the view loads and
/// its first cycles carry a fade-in and denormal residue rather than silence, which at -80 dBFS is
/// indistinguishable from audio — enough to hand a permanent slider to an app that has played
/// nothing, since the flag is sticky. Real playback stays above the floor cycle after cycle, so
/// requiring a run separates the two without raising the floor and losing genuinely quiet audio.
///
/// Eight cycles is roughly 85 ms at the 512-frame buffer the HAL usually gives an aggregate, and
/// under 350 ms at the largest it hands out. Both are shorter than the panel's own refresh, so a
/// row still appears the moment the user would say the audio started.
const SIGNAL_CYCLES: u32 = 8;

/// How long the mix is given to render its first tapped cycle before the taps are released.
///
/// Generous by realtime standards and invisible next to opening a panel. It is paid once per
/// rebuild, on the meter thread, and only ever in full when the mix has actually failed.
/// Generous on purpose. This only delays a build that has already failed, and a wrong verdict
/// here is expensive: it drops the taps that were about to start carrying the user's audio.
const MIX_START_TIMEOUT: Duration = Duration::from_millis(900);
const MIX_START_POLL: Duration = Duration::from_millis(5);

/// How long a tap set may hear nothing at all before the panel offers the permission as the
/// explanation. Long enough to sit through a gap between tracks, short enough to answer a user
/// who has just opened the panel and is wondering why nothing works.
const SILENCE_VERDICT: Duration = Duration::from_secs(6);

/// Where the engine records that macOS has, at least once, let it capture audio.
///
/// Silence is ambiguous on its own: a tap that is refused and a machine where nothing happens to
/// be playing both deliver zero. The difference matters, because one of them should send the user
/// to System Settings and the other should say "no audio playing" - and getting it wrong means
/// accusing the permission every time the room goes quiet.
///
/// Once capture has worked, that ambiguity is gone for good on this machine, so it is worth
/// remembering across runs. A marker file rather than a setting: this is something observed about
/// the OS, not something the user chose, and it has no business in a settings panel.
fn capture_proof_path() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME")?;

    Some(
        std::path::PathBuf::from(home)
            .join("Library/Application Support/com.somul.app")
            .join("capture-proven"),
    )
}

/// Whether capture has ever succeeded here, in this run or any earlier one.
///
/// Always false under test. The suite runs unsigned, so it can never capture, and a marker left
/// by the real app would otherwise make it treat every silent session as one to hide - quietly
/// turning the contract checks that need a session into no-ops.
#[cfg(test)]
fn capture_ever_proven() -> bool {
    false
}

#[cfg(not(test))]
fn capture_ever_proven() -> bool {
    // Cached, but revocable: the permission can be taken away while Somul is running, and a
    // `OnceLock` would keep insisting capture works for the rest of the session.
    const UNKNOWN: u8 = 0;
    const PROVEN: u8 = 1;
    const UNPROVEN: u8 = 2;

    static STATE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(UNKNOWN);

    match STATE.load(Ordering::Relaxed) {
        PROVEN => true,
        UNPROVEN => false,
        _ => {
            let proven = capture_proof_path().is_some_and(|path| path.exists());

            STATE.store(if proven { PROVEN } else { UNPROVEN }, Ordering::Relaxed);

            proven
        }
    }
}

/// Forgets that capture ever worked, on disk and in the cache.
///
/// Called when a tap set that started muted on the strength of the marker hears nothing at all.
/// The permission has been revoked since, and leaving the marker would keep muting apps Somul
/// can no longer hear - which is the one failure this whole design exists to prevent.
#[cfg(not(test))]
fn forget_capture_proof() {
    if let Some(path) = capture_proof_path() {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
fn forget_capture_proof() {}

#[cfg_attr(test, allow(dead_code))]
fn record_capture_proof() {
    let Some(path) = capture_proof_path() else {
        return;
    };

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let _ = std::fs::write(&path, b"macOS has allowed Somul to capture app audio on this Mac.\n");
}

/// Reports what the tap engine is doing, on stderr, in a debug build only.
///
/// Whether macOS is letting Somul capture is not observable from the outside: an unauthorised tap
/// is created successfully, reports channels, and returns silence. Without this the only symptom
/// is a panel full of rows that will not move, which looks identical to a dozen other faults.
/// Enabled in a debug build, or by `SOMUL_TAP_DIAGNOSTICS=1` in any build. The env var matters:
/// a TCC grant follows the code signature, so the bundled app and a `cargo` build are different
/// identities to macOS, and the one that holds the permission is the one worth watching.
macro_rules! diagnose {
    ($($argument:tt)*) => {
        if $crate::audio::macos::engine::is_diagnosing() {
            eprintln!("[somul::taps] {}", format!($($argument)*));
        }
    };
}

pub(super) fn is_diagnosing() -> bool {
    static ENABLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

    *ENABLED.get_or_init(|| {
        cfg!(debug_assertions) || std::env::var_os("SOMUL_TAP_DIAGNOSTICS").is_some()
    })
}

/// How often an unproven tap set is rebuilt to re-ask macOS whether it may capture.
///
/// Short, because this is the whole latency between a user granting the permission and the panel
/// working. Rebuilding passthrough taps is inaudible, so the only cost is the CoreAudio calls.
const CAPTURE_RETRY: Duration = Duration::from_secs(3);

impl SessionControl {
    fn new(gain: f32, is_muted: bool, has_signal: bool) -> Self {
        Self {
            gain: AtomicU32::new(gain.to_bits()),
            is_muted: AtomicBool::new(is_muted),
            peak: AtomicU32::new(0.0_f32.to_bits()),
            has_signal: AtomicBool::new(has_signal),
            signal_run: AtomicU32::new(0),
        }
    }

    /// Whether this app has produced audible output since its tap was created.
    pub fn has_signal(&self) -> bool {
        self.has_signal.load(Ordering::Relaxed)
    }

    pub fn gain(&self) -> f32 {
        f32::from_bits(self.gain.load(Ordering::Relaxed))
    }

    pub fn set_gain(&self, gain: f32) {
        self.gain.store(gain.to_bits(), Ordering::Relaxed);
    }

    pub fn is_muted(&self) -> bool {
        self.is_muted.load(Ordering::Relaxed)
    }

    pub fn set_muted(&self, is_muted: bool) {
        self.is_muted.store(is_muted, Ordering::Relaxed);
    }

    /// Reads the level and resets it, so a stalled app decays to silence instead of holding its
    /// last peak forever.
    pub fn take_peak(&self) -> f32 {
        f32::from_bits(self.peak.swap(0.0_f32.to_bits(), Ordering::Relaxed))
    }

    /// Records one render cycle's level from the callback.
    ///
    /// Keeps the loudest level seen since the UI last read, so a peak between two reads is
    /// reported rather than overwritten by the quiet frame that followed it.
    ///
    /// A cycle at or below the floor restarts the run rather than shortening it. The run is
    /// evidence of continuous output, and an app producing audio one cycle in three is a stream
    /// opening and closing, not something to give a slider.
    fn observe(&self, peak: f32) {
        if f32::from_bits(self.peak.load(Ordering::Relaxed)) < peak {
            self.peak.store(peak.to_bits(), Ordering::Relaxed);
        }

        if self.has_signal.load(Ordering::Relaxed) {
            return;
        }

        if peak <= SIGNAL_FLOOR {
            self.signal_run.store(0, Ordering::Relaxed);
            return;
        }

        if self.signal_run.fetch_add(1, Ordering::Relaxed) + 1 >= SIGNAL_CYCLES {
            self.has_signal.store(true, Ordering::Relaxed);
        }
    }
}

/// One tapped app: the tap itself, and the knobs the UI turns.
struct TapSlot {
    key: String,
    /// Destroys the tap on drop, which is what hands the app back to the hardware.
    _tap: ProcessTap,
    control: Arc<SessionControl>,
}

/// What the render callback sees.
///
/// Built once per rebuild and never mutated while the IO proc runs, so the callback needs no
/// synchronization to read it. Slot `i` owns input channels `[2i, 2i + 1]`.
struct RenderState {
    controls: Vec<Arc<SessionControl>>,
    /// True while the taps are still passthrough and the apps are playing themselves.
    ///
    /// The callback then observes levels and writes silence. Summing the taps as well would put
    /// a second copy of every app through the device on top of the one the hardware is already
    /// playing.
    is_probing: bool,
    /// Render cycles that arrived with tap channels attached.
    ///
    /// A tap mutes its app at the hardware, so the app is audible only through this callback. If
    /// the callback never runs, or runs with no tap input, the user's audio is simply gone until
    /// Somul exits. [`AggregateStartup`] reads this to decide whether the mix is really running.
    tapped_cycles: AtomicU64,
}

/// A private aggregate device holding the real output plus every live tap.
struct Aggregate {
    device: AudioObjectID,
    io_proc: AudioDeviceIOProcID,
    is_running: bool,
    /// Handed to the callback as a raw pointer. Kept boxed here so the allocation outlives every
    /// callback invocation; teardown stops the device before this is dropped.
    render: Box<RenderState>,
}

impl Aggregate {
    fn stop(&mut self) {
        if self.is_running {
            // SAFETY: `device` and `io_proc` were created together below and neither has been
            // destroyed. Stopping is idempotent from CoreAudio's side; the flag keeps it once.
            unsafe { AudioDeviceStop(self.device, self.io_proc) };
            self.is_running = false;
        }

        if self.io_proc.is_some() {
            // SAFETY: same pairing, and the device is stopped, so no callback is in flight.
            unsafe { AudioDeviceDestroyIOProcID(self.device, self.io_proc) };
            self.io_proc = None;
        }
    }
}

impl Drop for Aggregate {
    fn drop(&mut self) {
        // Order matters. The callback holds a raw pointer into `render`, so the device must be
        // stopped and the IO proc destroyed before the box is freed.
        self.stop();

        // SAFETY: this type created the device and nothing else destroys it.
        unsafe { AudioHardwareDestroyAggregateDevice(self.device) };
    }
}

#[derive(Default)]
struct EngineState {
    aggregate: Option<Aggregate>,
    slots: Vec<TapSlot>,
    /// Every process seen at the last sync, tapped or not.
    ///
    /// Wider than `slots` on purpose. An app whose tap was refused still appears in the session
    /// list, and a peak batch that skipped it would disagree with that list — which the contract
    /// forbids, because the UI pairs the two by key.
    keys: Vec<String>,
    /// Survives a rebuild: gain, mute, and whether this app has ever been heard.
    ///
    /// An app that is muted while another app opens or quits must come back muted rather than at
    /// full volume, and that rebuild is not something the user did. Having been heard is
    /// remembered for the same reason and one more: the engine rebuilds itself while probing for
    /// the capture permission, and a forgotten signal would put every silent app back in the list
    /// each time it did.
    remembered: Vec<(String, f32, bool, bool)>,
    /// The processes behind `keys`, kept so a promotion can rebuild the taps without a second
    /// enumeration. Promotion is triggered from the meter tick, which has no process list.
    processes: Vec<ProcessSession>,
    /// How the current tap set was built. Read to tell a set that is already muted from one that
    /// still has to be rebuilt before it can carry anyone's volume.
    mute: Option<TapMute>,
    /// When this tap set was created. Drives how often capture is re-attempted, and is reset by
    /// every rebuild, which is exactly what a retry cadence needs.
    probed_at: Option<Instant>,
    /// When the taps last started listening without having heard anything since.
    ///
    /// Deliberately survives a re-probe. Tying the verdict to `probed_at` instead would reset the
    /// clock every retry, and the panel would swing between the permission notice and a list of
    /// dead rows for as long as the permission stayed unresolved.
    silent_since: Option<Instant>,
}

/// The engine as the backend sees it.
#[derive(Default)]
pub(super) struct TapEngine {
    state: Mutex<EngineState>,
    has_synced: AtomicBool,
    /// Set once a tap has actually delivered audio.
    ///
    /// Until then every tap is [`TapMute::Passthrough`]. A tap that macOS has not authorised for
    /// audio capture does not fail: it is created, it reports channels, and it delivers digital
    /// silence — while still muting its app if it was asked to. Muting first and hoping is how
    /// an unapproved install takes a user's audio away with no way back short of quitting.
    has_proven_capture: AtomicBool,
}

impl TapEngine {
    /// Brings the tap set in line with the apps currently open.
    ///
    /// A rebuild tears the aggregate down and builds it again, which is audible as a short gap.
    /// It therefore happens only when the set of keys actually changes, not on every poll.
    pub fn sync(&self, processes: &[ProcessSession]) -> Result<(), AudioError> {
        let mut state = self.lock();

        let wanted: Vec<String> = processes.iter().map(ProcessSession::identifier).collect();
        let is_first_sync = !self.has_synced.swap(true, Ordering::Relaxed);

        if wanted == state.keys && !is_first_sync {
            return Ok(());
        }

        state.remember();
        state.teardown();
        state.keys = wanted;
        state.processes = processes.to_vec();

        if processes.is_empty() {
            return Ok(());
        }

        state.rebuild(processes, self.tap_mute())
    }

    /// Takes the apps over once one of them has been heard through a passthrough tap.
    ///
    /// Cheap enough for the meter tick: a load, and a rebuild only on the single transition from
    /// listening to mixing.
    pub fn promote_if_heard(&self) -> Result<(), AudioError> {
        if self.has_proven_capture.load(Ordering::Relaxed) {
            return Ok(());
        }

        let mut state = self.lock();

        if !state.slots.iter().any(|slot| slot.control.has_signal()) {
            return Ok(());
        }

        let processes = state.processes.clone();

        // Proven only once the muted set is actually running. Setting the flag first and building
        // afterwards left the engine claiming capture it no longer had if the build failed: the
        // retry below skips a proven engine, so nothing ever rebuilt, and every row kept a slider
        // that moved nothing.
        diagnose!("heard audio, taking the apps over");

        if let Err(error) = state.rebuild(&processes, TapMute::Muted) {
            // Straight back to listening. The apps are already playing themselves in this mode,
            // so the failure costs control rather than sound.
            let _ = state.rebuild(&processes, TapMute::Passthrough);

            return Err(error);
        }

        self.has_proven_capture.store(true, Ordering::Relaxed);
        state.silent_since = None;
        record_capture_proof();

        Ok(())
    }

    /// Whether the taps have been listening in silence for long enough to blame the permission.
    ///
    /// An unauthorised tap is indistinguishable from a genuinely quiet app for as long as the app
    /// stays quiet: both deliver zero. Time is the only thing that separates them, so the verdict
    /// waits [`SILENCE_VERDICT`] and is withdrawn the instant a single sample arrives. A user
    /// whose apps are merely paused sees the notice too, which is why it says what it observed
    /// rather than accusing the permission outright.
    pub fn is_capture_withheld(&self) -> bool {
        // Known-granted machines are never accused. Once capture has worked here, silence means
        // nothing is playing, which is a different empty state with a different answer.
        if self.has_proven_capture.load(Ordering::Relaxed) || capture_ever_proven() {
            return false;
        }

        let state = self.lock();

        if state.slots.is_empty() {
            return false;
        }

        state
            .silent_since
            .is_some_and(|since| since.elapsed() >= SILENCE_VERDICT)
    }

    /// Hands the apps back when a set that started muted on the marker's word hears nothing.
    ///
    /// The marker records that capture worked once, not that it works now. If the permission has
    /// been revoked since, those muted taps are silencing apps Somul can no longer hear, so the
    /// marker is dropped and the set goes back to passthrough - which also lets the panel offer
    /// the permission again instead of insisting nothing is playing.
    pub fn demote_if_deaf(&self) -> Result<(), AudioError> {
        if self.has_proven_capture.load(Ordering::Relaxed) {
            return Ok(());
        }

        let mut state = self.lock();

        if state.mute != Some(TapMute::Muted) || state.slots.is_empty() {
            return Ok(());
        }

        let is_deaf = state
            .silent_since
            .is_some_and(|since| since.elapsed() >= SILENCE_VERDICT);

        if !is_deaf {
            return Ok(());
        }

        diagnose!("muted taps heard nothing, handing the apps back");
        forget_capture_proof();

        let processes = state.processes.clone();

        state.rebuild(&processes, TapMute::Passthrough)
    }

    /// Builds the taps again so a permission granted since they were created can take effect.
    ///
    /// macOS decides whether a tap may capture when the tap is created. A tap that was refused
    /// stays silent for its whole life, so a user who grants the permission while Somul is
    /// running would otherwise see nothing change until they quit and reopen it.
    ///
    /// Free while probing: passthrough taps are not carrying anyone's audio, so tearing them down
    /// and building them again is inaudible. It would not be free once mixing, which is why this
    /// stops the moment capture is proven.
    pub fn reprobe_capture(&self) -> Result<(), AudioError> {
        if self.has_proven_capture.load(Ordering::Relaxed) {
            return Ok(());
        }

        let mut state = self.lock();

        // Only once silence has gone on long enough to be a verdict rather than a quiet moment.
        // Retrying from the first tick would rebuild the taps under every app that simply had not
        // played yet, and would do it in the seconds when the panel has only just opened.
        let is_withheld = state
            .silent_since
            .is_some_and(|since| since.elapsed() >= SILENCE_VERDICT);

        let is_due = state
            .probed_at
            .is_some_and(|at| at.elapsed() >= CAPTURE_RETRY);

        if !is_withheld || !is_due || state.processes.is_empty() {
            return Ok(());
        }

        let processes = state.processes.clone();

        diagnose!("still silent, asking macOS for capture again");

        state.rebuild(&processes, TapMute::Passthrough)
    }

    /// Whether any tap has ever delivered audio.
    ///
    /// The panel hides apps that have never been heard, and this is the guard that keeps it from
    /// hiding all of them: until something has been heard there is no evidence to hide anything
    /// on, and an empty panel would be a worse answer than a slightly generous one.
    pub fn has_heard_anything(&self) -> bool {
        // On a machine where capture is known to work, an app that has not been heard is simply
        // not playing - a text editor holding an output stream open, which is not a mixer row.
        // The evidence is good enough to hide it without waiting to hear something else first.
        capture_ever_proven() || self.lock().slots.iter().any(|slot| slot.control.has_signal())
    }

    /// Whether this key belongs in the panel: it has been heard.
    ///
    /// Being heard is the only thing that separates an app playing audio from a text editor that
    /// opened an output stream at launch and never used it. `IsRunningOutput` reports both as
    /// running output, and it is telling the truth - the stream really is open.
    ///
    /// An app that could not be tapped is judged the same way, which means it is hidden rather
    /// than listed as uncontrollable. It is a real trade: an app playing audio that refused the
    /// tap disappears from the panel instead of appearing with a dead slider. The panel cannot
    /// control it either way, and a row that cannot be controlled is not worth the confusion of
    /// listing every app that merely holds a speaker open.
    ///
    /// Only consulted once something has been heard at all - see `has_heard_anything`.
    pub fn is_audible(&self, key: &str) -> bool {
        self.control(key)
            .is_some_and(|control| control.has_signal())
    }

    /// Whether the last sync saw any app holding audio open, tapped or not.
    ///
    /// Read instead of a fresh enumeration when the answer only has to be as current as the last
    /// sync, which the meter loop performs every tick anyway.
    pub fn has_processes(&self) -> bool {
        !self.lock().keys.is_empty()
    }

    /// Whether any app is tapped at all, mixing or still listening.
    ///
    /// This is the evidence for per-app volume being available on this machine. Whether a tap is
    /// carrying gain yet is a separate question, and a slower one to answer.
    pub fn has_taps(&self) -> bool {
        !self.lock().slots.is_empty()
    }

    /// Whether the taps are mixing rather than listening.
    ///
    /// A passthrough tap carries no volume, so a row backed by one is reported as uncontrollable
    /// rather than given a slider that moves nothing.
    pub fn is_mixing(&self) -> bool {
        self.has_proven_capture.load(Ordering::Relaxed) || capture_ever_proven()
    }

    /// Muted straight away on a Mac where capture has already been proven.
    ///
    /// Probing first is only worth its cost while it is still unknown whether macOS will allow
    /// capture at all. Paying it on every launch after that means every app spends the seconds
    /// before its first sound in a row that says it cannot be controlled - which is exactly what
    /// the user sees as a delay when they press play.
    fn tap_mute(&self) -> TapMute {
        if self.is_mixing() {
            TapMute::Muted
        } else {
            TapMute::Passthrough
        }
    }

    /// Whether the tap set has ever been brought in line with the running processes.
    ///
    /// The meter path is deliberately cheap and does no enumeration, so a peak read that lands
    /// before the first session read would otherwise report nothing at all.
    pub fn is_cold(&self) -> bool {
        !self.has_synced.load(Ordering::Relaxed)
    }

    /// The knobs for one app, or `None` when it is no longer being tapped.
    pub fn control(&self, key: &str) -> Option<Arc<SessionControl>> {
        self.lock()
            .slots
            .iter()
            .find(|slot| slot.key == key)
            .map(|slot| Arc::clone(&slot.control))
    }

    /// Levels for every session, keyed the same way the session list is.
    ///
    /// Covers the keys from the last sync rather than only the tapped ones, so an app whose tap
    /// was refused reports a flat zero instead of dropping out of the batch.
    pub fn peaks(&self) -> Vec<(String, f32)> {
        let state = self.lock();

        state
            .keys
            .iter()
            .map(|key| {
                let level = state
                    .slots
                    .iter()
                    .find(|slot| &slot.key == key)
                    .map_or(0.0, |slot| slot.control.take_peak());

                (key.clone(), level)
            })
            .collect()
    }

    /// Drops every tap and the aggregate, returning all apps to the hardware.
    pub fn shutdown(&self) {
        let mut state = self.lock();
        state.remember();
        state.teardown();
    }

    /// A poisoned engine lock is recoverable: the state it guards is rebuilt from scratch on the
    /// next sync, so refusing to touch it would disable mixing for the rest of the run.
    fn lock(&self) -> std::sync::MutexGuard<'_, EngineState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Drop for TapEngine {
    fn drop(&mut self) {
        self.shutdown();
    }
}

impl EngineState {
    fn remember(&mut self) {
        for slot in &self.slots {
            let entry = (
                slot.key.clone(),
                slot.control.gain(),
                slot.control.is_muted(),
                slot.control.has_signal(),
            );

            match self
                .remembered
                .iter_mut()
                .find(|(key, _, _, _)| *key == entry.0)
            {
                Some(existing) => *existing = entry,
                None => self.remembered.push(entry),
            }
        }
    }

    fn recall(&self, key: &str) -> (f32, bool, bool) {
        self.remembered
            .iter()
            .find(|(remembered, _, _, _)| remembered == key)
            .map(|(_, gain, is_muted, has_signal)| (*gain, *is_muted, *has_signal))
            .unwrap_or((1.0, false, false))
    }

    /// Destroys the aggregate first, then the taps.
    ///
    /// The reverse order would leave the aggregate referencing taps that no longer exist, and
    /// CoreAudio is entitled to be unhappy about that.
    fn teardown(&mut self) {
        self.aggregate = None;
        self.slots.clear();
        self.keys.clear();
    }

    /// Replaces the tap set, leaving nothing behind if it cannot.
    ///
    /// The failure path is the whole point. `keys` is what tells `sync` the set is already
    /// current, so a build that failed while leaving them set meant every later sync saw its work
    /// as done and returned early — one failure and the engine never tapped anything again.
    fn rebuild(&mut self, processes: &[ProcessSession], mute: TapMute) -> Result<(), AudioError> {
        self.remember();
        self.teardown();
        self.keys = processes.iter().map(ProcessSession::identifier).collect();

        let result = self.build(processes, mute);

        if let Err(error) = &result {
            diagnose!("build as {mute:?} failed, released every tap: {error:?}");
            self.keys.clear();
        }

        result
    }

    fn build(&mut self, processes: &[ProcessSession], mute: TapMute) -> Result<(), AudioError> {
        let output = super::default_output_device()?;
        let output_uid = device_uid(output)?;

        let mut slots = Vec::with_capacity(processes.len());

        for process in processes {
            let key = process.identifier();
            let (gain, is_muted, has_signal) = self.recall(&key);

            // One app failing to tap must not cost the others their mixer. A game that refuses
            // the tap simply keeps playing at its own level.
            let Ok(tap) = ProcessTap::stereo(&process.objects, &process.display_name, mute) else {
                continue;
            };

            slots.push(TapSlot {
                key,
                control: Arc::new(SessionControl::new(gain, is_muted, has_signal)),
                _tap: tap,
            });
        }

        if slots.is_empty() {
            return Ok(());
        }

        if slots.len() * CHANNELS_PER_TAP > MAX_CHANNELS {
            slots.truncate(MAX_CHANNELS / CHANNELS_PER_TAP);
        }

        let tap_uids: Vec<&str> = slots.iter().map(|slot| slot._tap.uid()).collect();
        let device = create_aggregate(&output_uid, &tap_uids)?;

        let render = Box::new(RenderState {
            controls: slots
                .iter()
                .map(|slot| Arc::clone(&slot.control))
                .collect(),
            tapped_cycles: AtomicU64::new(0),
            is_probing: mute == TapMute::Passthrough,
        });

        let mut aggregate = Aggregate {
            device,
            io_proc: None,
            is_running: false,
            render,
        };

        let mut io_proc: AudioDeviceIOProcID = None;
        // SAFETY: `render` is boxed and owned by `aggregate`, which outlives the IO proc because
        // `Aggregate::drop` stops the device before freeing it. The pointer is stable for that
        // whole window.
        let status = unsafe {
            AudioDeviceCreateIOProcID(
                device,
                Some(render_callback),
                std::ptr::from_ref(aggregate.render.as_ref())
                    .cast_mut()
                    .cast::<c_void>(),
                &mut io_proc,
            )
        };
        check(status, "installing the mixer IO proc")?;

        aggregate.io_proc = io_proc;

        // SAFETY: the IO proc was just created against this device.
        let status = unsafe { AudioDeviceStart(device, io_proc) };
        check(status, "starting the mixer")?;

        aggregate.is_running = true;

        diagnose!(
            "built {} tap(s) as {:?} for [{}]",
            slots.len(),
            mute,
            slots
                .iter()
                .map(|slot| slot.key.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        );

        let now = Instant::now();

        self.mute = Some(mute);
        self.probed_at = Some(now);
        self.silent_since = self.silent_since.or(Some(now));

        // Nothing below this point is optional. Every tap above muted its app at the hardware, so
        // if the mix is not actually running the user has lost that audio entirely, with no way
        // back short of quitting Somul. Returning an error here drops `slots`, and dropping a
        // `ProcessTap` hands its app straight back to the hardware.
        wait_for_mix(&aggregate.render)?;

        self.aggregate = Some(aggregate);
        self.slots = slots;

        Ok(())
    }
}

/// Blocks until the mix has rendered a cycle with tap input, or gives up.
///
/// CoreAudio reports success from `AudioDeviceStart` before the first cycle has run, and several
/// real failures show up only afterwards: an aggregate whose taps never auto-start feeds the
/// callback zero input channels forever, and a device that refuses to run never calls it at all.
/// Both are silent from the API's point of view and total from the user's.
fn wait_for_mix(render: &RenderState) -> Result<(), AudioError> {
    let deadline = Instant::now() + MIX_START_TIMEOUT;

    while Instant::now() < deadline {
        if render.tapped_cycles.load(Ordering::Relaxed) > 0 {
            return Ok(());
        }

        thread::sleep(MIX_START_POLL);
    }

    Err(AudioError::BackendFailure(
        "the mixer started but never rendered a tapped cycle, so the taps were released"
            .to_owned(),
    ))
}

/// Reads the device UID the aggregate description keys its sub-device on.
fn device_uid(device: AudioObjectID) -> Result<String, AudioError> {
    let address = address(
        kAudioDevicePropertyDeviceUID,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    );

    let uid =
        read_property::<CFStringRef>(device, &address, "reading the output device UID").map(take_cf_string)?;

    if uid.is_empty() {
        return Err(AudioError::BackendFailure(
            "the output device reported an empty UID".to_owned(),
        ));
    }

    Ok(uid)
}

/// Builds the aggregate description and creates the device.
///
/// The dictionary keys are the plain strings CoreAudio documents (`uid`, `taps`, `subdevices`);
/// `NSDictionary` is toll-free bridged to the `CFDictionaryRef` the routine wants, which is why
/// there is no CoreFoundation construction here.
fn create_aggregate(output_uid: &str, tap_uids: &[&str]) -> Result<AudioObjectID, AudioError> {
    let sub_devices = NSArray::from_retained_slice(&[dictionary(&[("uid", value_string(output_uid))])]);

    let taps: Vec<Retained<NSDictionary<NSString, objc2::runtime::AnyObject>>> = tap_uids
        .iter()
        .map(|uid| {
            dictionary(&[
                ("uid", value_string(uid)),
                // Taps and the output device run on different clocks. Without drift compensation
                // the two slowly slide apart and the mix develops periodic glitches.
                ("drift", value_flag(true)),
            ])
        })
        .collect();

    // Unique per aggregate, not just per process. CoreAudio refuses a UID that already names a
    // live device, and a rebuild can briefly overlap the device it replaces.
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let serial = SEQUENCE.fetch_add(1, Ordering::Relaxed);

    let description = dictionary(&[
        (
            "uid",
            value_string(&format!(
                "com.somul.mixer.{}.{serial}",
                std::process::id()
            )),
        ),
        ("name", value_string("Somul Mixer")),
        // Private keeps this device out of every other app's output picker. A visible aggregate
        // would invite the user to select the mixer as their system output, which loops.
        ("private", value_flag(true)),
        // Not stacked: the sub-devices are one output plus taps, not several outputs fanned out.
        ("stacked", value_flag(false)),
        // Load-bearing, and silent when missing. Without auto-start the aggregate is created and
        // its IO proc runs, but the taps never begin feeding it — the callback sees zero input
        // channels forever, so nothing is mixed and every level reads flat zero.
        ("tapautostart", value_flag(true)),
        ("master", value_string(output_uid)),
        ("subdevices", cast(sub_devices)),
        ("taps", cast(NSArray::from_retained_slice(&taps))),
    ]);

    let mut device: AudioObjectID = 0;
    // SAFETY: `description` is a live dictionary for the duration of the call, and `device` is a
    // live local the routine writes one `AudioObjectID` into.
    let status = unsafe {
        AudioHardwareCreateAggregateDevice(
            Retained::as_ptr(&description).cast::<c_void>() as CFDictionaryRef,
            &mut device,
        )
    };

    check(status, "creating the mixer aggregate device")?;

    if device == 0 {
        return Err(AudioError::BackendFailure(
            "CoreAudio reported success but returned no aggregate device".to_owned(),
        ));
    }

    Ok(device)
}

type AnyRetained = Retained<objc2::runtime::AnyObject>;

fn value_string(value: &str) -> AnyRetained {
    cast(NSString::from_str(value))
}

/// The aggregate description's flags are documented as `CFBoolean`, and the HAL reads them with
/// `CFBooleanGetValue`. A `CFNumber` holding 1 is not that, and the key is ignored in silence.
fn value_flag(value: bool) -> AnyRetained {
    cast(NSNumber::new_bool(value))
}

fn cast<T: objc2::Message>(value: Retained<T>) -> AnyRetained {
    // SAFETY: every Objective-C object is an `AnyObject`; this only widens the static type.
    unsafe { Retained::cast_unchecked(value) }
}

fn dictionary(
    entries: &[(&str, AnyRetained)],
) -> Retained<NSDictionary<NSString, objc2::runtime::AnyObject>> {
    let keys: Vec<Retained<NSString>> = entries
        .iter()
        .map(|(key, _)| NSString::from_str(key))
        .collect();

    let key_refs: Vec<&NSString> = keys.iter().map(|key| &**key).collect();
    let value_refs: Vec<&objc2::runtime::AnyObject> =
        entries.iter().map(|(_, value)| &**value).collect();

    NSDictionary::from_slices(&key_refs, &value_refs)
}

/// A flat, stride-aware view of one `AudioBufferList`'s channels.
///
/// CoreAudio may hand the same channel count over as one interleaved buffer or as several, and
/// the callback has no business branching on that. Resolving each channel to a base pointer and
/// a stride once, on the stack, collapses both layouts into the same indexing.
struct Channels {
    entries: [(*mut f32, usize); MAX_CHANNELS],
    len: usize,
}

impl Channels {
    /// SAFETY: `list` must point at a live `AudioBufferList` whose buffers hold `f32` samples,
    /// which is what an aggregate device's IO proc provides.
    unsafe fn map(list: *const AudioBufferList) -> Self {
        let mut entries = [(std::ptr::null_mut(), 0_usize); MAX_CHANNELS];
        let mut len = 0_usize;

        if list.is_null() {
            return Self { entries, len };
        }

        let count = unsafe { (*list).mNumberBuffers } as usize;
        let buffers = unsafe { (*list).mBuffers.as_ptr() };

        for index in 0..count {
            let buffer = unsafe { &*buffers.add(index) };
            let stride = buffer.mNumberChannels as usize;
            let data = buffer.mData.cast::<f32>();

            if data.is_null() || stride == 0 {
                continue;
            }

            for channel in 0..stride {
                if len == MAX_CHANNELS {
                    return Self { entries, len };
                }

                entries[len] = (unsafe { data.add(channel) }, stride);
                len += 1;
            }
        }

        Self { entries, len }
    }

    /// SAFETY: same contract as [`Channels::map`] — `list` must be a live `AudioBufferList`.
    /// Declared `unsafe` because it dereferences the pointer without checking it, which a safe
    /// signature would misrepresent.
    unsafe fn frames(list: *const AudioBufferList) -> usize {
        if list.is_null() {
            return 0;
        }

        let count = unsafe { (*list).mNumberBuffers } as usize;

        if count == 0 {
            return 0;
        }

        let buffer = unsafe { &*(*list).mBuffers.as_ptr() };
        let stride = buffer.mNumberChannels as usize;

        if stride == 0 {
            return 0;
        }

        buffer.mDataByteSize as usize / (std::mem::size_of::<f32>() * stride)
    }
}

/// The realtime render callback.
///
/// Allocates nothing, locks nothing, and calls nothing that might. Every parameter it needs is an
/// atomic load; every result it publishes is an atomic store.
unsafe extern "C" fn render_callback(
    _device: AudioObjectID,
    _now: *const AudioTimeStamp,
    input: *const AudioBufferList,
    _input_time: *const AudioTimeStamp,
    output: *mut AudioBufferList,
    _output_time: *const AudioTimeStamp,
    client_data: *mut c_void,
) -> OSStatus {
    if client_data.is_null() || output.is_null() {
        return 0;
    }

    // SAFETY: the pointer was handed to `AudioDeviceCreateIOProcID` from a box owned by the
    // `Aggregate` that owns this IO proc, and the device is stopped before that box is freed.
    let state = unsafe { &*client_data.cast::<RenderState>() };

    let inputs = unsafe { Channels::map(input) };
    let outputs = unsafe { Channels::map(output.cast_const()) };

    if inputs.len > 0 {
        state.tapped_cycles.fetch_add(1, Ordering::Relaxed);
    }

    let output_frames = unsafe { Channels::frames(output.cast_const()) };
    let input_frames = unsafe { Channels::frames(input) };

    // SAFETY: both views were mapped from live buffer lists belonging to this IO cycle, and the
    // frame counts came from those same lists.
    unsafe {
        mix(
            &inputs,
            &outputs,
            input_frames,
            output_frames,
            &state.controls,
            state.is_probing,
        )
    };

    0
}

/// Sums every tapped app into the output bus at its own gain.
///
/// Split out of the callback so it can be tested against synthetic buffers. Nothing here is
/// audible to a test suite, but all of it is arithmetic, and arithmetic is checkable.
///
/// SAFETY: `inputs` and `outputs` must describe live buffers holding at least the stated frame
/// counts.
unsafe fn mix(
    inputs: &Channels,
    outputs: &Channels,
    input_frames: usize,
    output_frames: usize,
    controls: &[Arc<SessionControl>],
    is_probing: bool,
) {
    // Cleared over the *output's* length, not the shared minimum. A tap that delivers fewer
    // frames than the device asked for — the first cycles after a rebuild, or any underrun —
    // would otherwise leave the tail of the buffer holding whatever bytes were already there,
    // and the device plays them. That is the click the user hears.
    for channel in 0..outputs.len {
        let (pointer, stride) = outputs.entries[channel];

        for frame in 0..output_frames {
            unsafe { *pointer.add(frame * stride) = 0.0 };
        }
    }

    let frames = input_frames.min(output_frames);


    if outputs.len == 0 || frames == 0 {
        return;
    }

    for (index, control) in controls.iter().enumerate() {
        let gain = if control.is_muted() { 0.0 } else { control.gain() };
        let mut peak = 0.0_f32;

        for channel in 0..CHANNELS_PER_TAP {
            let source = index * CHANNELS_PER_TAP + channel;

            if source >= inputs.len {
                break;
            }

            let (in_pointer, in_stride) = inputs.entries[source];
            // A mono output still has to carry every app, so the last channel takes the overflow
            // rather than dropping it.
            let (out_pointer, out_stride) = outputs.entries[channel.min(outputs.len - 1)];

            for frame in 0..frames {
                let sample = unsafe { *in_pointer.add(frame * in_stride) };
                let magnitude = sample.abs();

                if magnitude > peak {
                    peak = magnitude;
                }

                if !is_probing {
                    let target = unsafe { &mut *out_pointer.add(frame * out_stride) };
                    *target = (*target + sample * gain).clamp(-1.0, 1.0);
                }
            }
        }

        control.observe(peak);
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_control_is_unity_and_unmuted() {
        let control = SessionControl::new(1.0, false, false);

        assert_eq!(control.gain(), 1.0);
        assert!(!control.is_muted());
    }

    /// A quiet cycle after a loud one must not erase the loud one before the UI has read it.
    #[test]
    fn holds_the_loudest_level_between_two_reads() {
        let control = SessionControl::new(1.0, false, false);

        control.observe(0.6);
        control.observe(0.1);

        assert_eq!(control.take_peak(), 0.6);
    }

    /// Reading a peak clears it, so an app that stops producing audio decays to silence instead
    /// of holding its last level on screen forever.
    #[test]
    fn reading_a_peak_resets_it() {
        let control = SessionControl::new(1.0, false, false);

        control.peak.store(0.8_f32.to_bits(), Ordering::Relaxed);

        assert_eq!(control.take_peak(), 0.8);
        assert_eq!(control.take_peak(), 0.0);
    }

    /// The defect this pins. A WebKit-backed app opens its output stream when the view loads, and
    /// the first cycles through the tap carry a fade-in rather than silence. Treating one such
    /// cycle as playback handed a permanent slider — the flag is sticky — to an app that had
    /// played nothing, which is how a text editor appeared in the mixer at launch.
    #[test]
    fn a_burst_shorter_than_the_run_is_not_playback() {
        let control = SessionControl::new(1.0, false, false);

        for _ in 0..SIGNAL_CYCLES - 1 {
            control.observe(0.5);
        }

        assert!(!control.has_signal());
    }

    #[test]
    fn a_sustained_run_above_the_floor_is_playback() {
        let control = SessionControl::new(1.0, false, false);

        for _ in 0..SIGNAL_CYCLES {
            control.observe(0.5);
        }

        assert!(control.has_signal());
    }

    /// Restarted, not decremented: an app rendering one loud cycle in three is a stream opening
    /// and closing, and accumulating those would let it reach the run and claim a row.
    #[test]
    fn a_silent_cycle_restarts_the_run() {
        let control = SessionControl::new(1.0, false, false);

        for _ in 0..SIGNAL_CYCLES * 2 {
            control.observe(0.5);
            control.observe(0.0);
        }

        assert!(!control.has_signal());
    }

    /// The floor is a threshold the level has to clear, not one it may sit on.
    #[test]
    fn a_run_exactly_at_the_floor_is_the_taps_own_noise() {
        let control = SessionControl::new(1.0, false, false);

        for _ in 0..SIGNAL_CYCLES {
            control.observe(SIGNAL_FLOOR);
        }

        assert!(!control.has_signal());
    }

    /// Meters must keep working for an app still short of the run, or a row that does appear
    /// would arrive with a dead meter.
    #[test]
    fn a_level_below_the_run_still_reaches_the_meter() {
        let control = SessionControl::new(1.0, false, false);

        control.observe(0.5);

        assert!(!control.has_signal());
        assert_eq!(control.take_peak(), 0.5);
    }

    /// An app carried through a tap rebuild keeps its row: the run proved playback once, and
    /// making it prove it again would drop the row of anything paused across the rebuild.
    #[test]
    fn a_remembered_signal_needs_no_second_run() {
        let control = SessionControl::new(1.0, false, true);

        assert!(control.has_signal());
    }

    #[test]
    fn gain_and_mute_round_trip_through_the_atomics() {
        let control = SessionControl::new(1.0, false, false);

        control.set_gain(0.25);
        control.set_muted(true);

        assert_eq!(control.gain(), 0.25);
        assert!(control.is_muted());
    }

    /// The channel budget is what keeps the render callback's scratch space on the stack.
    #[test]
    fn the_channel_ceiling_is_a_whole_number_of_taps() {
        assert_eq!(MAX_CHANNELS % CHANNELS_PER_TAP, 0);
    }

    /// Syncing an empty process list must tear the engine down rather than leave stale taps
    /// holding apps that have stopped playing.
    #[test]
    fn syncing_nothing_leaves_no_taps() {
        let engine = TapEngine::default();

        engine.sync(&[]).expect("an empty sync cannot fail");

        assert!(engine.peaks().is_empty());
        assert!(engine.control("macos:app:com.example").is_none());
    }

    /// A muted app that briefly stops producing output must come back muted. Forgetting across a
    /// rebuild would un-mute apps behind the user's back.
    /// A stereo interleaved buffer list, shaped the way an aggregate device hands one over.
    struct Buffers {
        list: Box<coreaudio_sys::AudioBufferList>,
        samples: Vec<f32>,
    }

    impl Buffers {
        fn new(channels: usize, frames: usize, fill: f32) -> Self {
            let mut samples = vec![fill; channels * frames];
            let mut list: Box<coreaudio_sys::AudioBufferList> =
                Box::new(unsafe { std::mem::zeroed() });

            list.mNumberBuffers = 1;
            list.mBuffers[0] = coreaudio_sys::AudioBuffer {
                mNumberChannels: channels as u32,
                mDataByteSize: (samples.len() * std::mem::size_of::<f32>()) as u32,
                mData: samples.as_mut_ptr().cast(),
            };

            Self { list, samples }
        }

        fn view(&self) -> Channels {
            unsafe { Channels::map(std::ptr::from_ref(&*self.list)) }
        }
    }

    fn control(gain: f32, is_muted: bool) -> Arc<SessionControl> {
        Arc::new(SessionControl::new(gain, is_muted, false))
    }

    #[test]
    fn applies_each_app_gain_to_its_own_channels() {
        let input = Buffers::new(2, 4, 0.5);
        let output = Buffers::new(2, 4, 0.0);
        let controls = vec![control(0.5, false)];

        unsafe { mix(&input.view(), &output.view(), 4, 4, &controls, false) };

        assert!(output.samples.iter().all(|sample| (*sample - 0.25).abs() < 1e-6));
    }

    /// Gain 1.0 must be transparent. A mixer that colours audio at unity is broken.
    #[test]
    fn passes_audio_through_untouched_at_unity() {
        let input = Buffers::new(2, 4, 0.3);
        let output = Buffers::new(2, 4, 0.0);
        let controls = vec![control(1.0, false)];

        unsafe { mix(&input.view(), &output.view(), 4, 4, &controls, false) };

        assert!(output.samples.iter().all(|sample| (*sample - 0.3).abs() < 1e-6));
    }

    #[test]
    fn a_muted_app_contributes_nothing() {
        let input = Buffers::new(2, 4, 0.9);
        let output = Buffers::new(2, 4, 0.0);
        let controls = vec![control(1.0, true)];

        unsafe { mix(&input.view(), &output.view(), 4, 4, &controls, false) };

        assert!(output.samples.iter().all(|sample| *sample == 0.0));
    }

    /// Two apps sum. The failure this catches is a mixer that plays only the last one.
    #[test]
    fn sums_two_apps_into_one_bus() {
        let input = Buffers::new(4, 2, 0.25);
        let output = Buffers::new(2, 2, 0.0);
        let controls = vec![control(1.0, false), control(1.0, false)];

        unsafe { mix(&input.view(), &output.view(), 2, 2, &controls, false) };

        assert!(output.samples.iter().all(|sample| (*sample - 0.5).abs() < 1e-6));
    }

    /// Summed apps can exceed full scale, and wrapping there is what turns a loud moment into a
    /// burst of noise.
    #[test]
    fn clamps_instead_of_wrapping_when_the_bus_overflows() {
        let input = Buffers::new(4, 2, 0.8);
        let output = Buffers::new(2, 2, 0.0);
        let controls = vec![control(1.0, false), control(1.0, false)];

        unsafe { mix(&input.view(), &output.view(), 2, 2, &controls, false) };

        assert!(output.samples.iter().all(|sample| *sample <= 1.0 && *sample >= -1.0));
        assert!(output.samples.iter().all(|sample| (*sample - 1.0).abs() < 1e-6));
    }

    /// The defect this pins: clearing only the shared minimum leaves the tail of the output
    /// holding whatever was there before, and the device plays it as a click.
    #[test]
    fn clears_the_whole_output_even_when_the_input_is_short() {
        let input = Buffers::new(2, 2, 0.5);
        let output = Buffers::new(2, 8, 0.77);
        let controls = vec![control(1.0, false)];

        unsafe { mix(&input.view(), &output.view(), 2, 8, &controls, false) };

        let tail = &output.samples[2 * 2..];

        assert!(
            tail.iter().all(|sample| *sample == 0.0),
            "stale audio survived past the input: {tail:?}"
        );
    }

    /// Nothing to mix must still mean silence, not the previous cycle's contents.
    #[test]
    fn silences_the_output_when_no_input_arrives() {
        let input = Buffers::new(2, 0, 0.0);
        let output = Buffers::new(2, 4, 0.61);
        let controls = vec![control(1.0, false)];

        unsafe { mix(&input.view(), &output.view(), 0, 4, &controls, false) };

        assert!(output.samples.iter().all(|sample| *sample == 0.0));
    }

    /// Peak is pre-gain, so the meter shows what the app is producing rather than what the user
    /// turned it down to.
    #[test]
    fn reports_the_peak_before_gain_is_applied() {
        let input = Buffers::new(2, 4, 0.8);
        let output = Buffers::new(2, 4, 0.0);
        let controls = vec![control(0.1, false)];

        unsafe { mix(&input.view(), &output.view(), 4, 4, &controls, false) };

        assert!((controls[0].take_peak() - 0.8).abs() < 1e-6);
    }

    /// A mono output still has to carry both channels of every app.
    #[test]
    fn folds_into_a_mono_output_without_dropping_a_channel() {
        let input = Buffers::new(2, 2, 0.4);
        let output = Buffers::new(1, 2, 0.0);
        let controls = vec![control(1.0, false)];

        unsafe { mix(&input.view(), &output.view(), 2, 2, &controls, false) };

        assert!(output.samples.iter().all(|sample| (*sample - 0.8).abs() < 1e-6));
    }

    #[test]
    fn remembers_gain_and_mute_across_a_rebuild() {
        let mut state = EngineState::default();

        state.remembered.push(("macos:app:probe".to_owned(), 0.3, true, false));

        assert_eq!(state.recall("macos:app:probe"), (0.3, true, false));
        assert_eq!(state.recall("macos:app:unseen"), (1.0, false, false));
    }
}
