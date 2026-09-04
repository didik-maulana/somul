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

use std::collections::BTreeMap;
use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use coreaudio_sys::{
    kAudioDevicePropertyDeviceUID, kAudioObjectPropertyElementMain,
    kAudioObjectPropertyScopeGlobal, AudioBufferList, AudioDeviceCreateIOProcID,
    AudioDeviceDestroyIOProcID, AudioDeviceIOProcID, AudioDeviceStart, AudioDeviceStop,
    AudioHardwareCreateAggregateDevice, AudioHardwareDestroyAggregateDevice, AudioObjectID,
    AudioTimeStamp, CFArrayRef, CFDictionaryRef, CFStringRef, OSStatus,
};
use objc2::rc::Retained;
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString};

use super::process::ProcessSession;
use super::property::{address, check, read_property, take_cf_string, write_property};
use super::tap::{ProcessTap, TapMute};
use crate::audio::AudioError;

/// Every tap is created as a stereo mixdown, which is what makes the channel arithmetic in the
/// render callback a fixed stride rather than a per-tap lookup.
const CHANNELS_PER_TAP: usize = 2;

/// Ceiling on the channels the render callback will index in one cycle. Sixty-four is thirty-two
/// simultaneously mixed apps — far past any real desktop, and small enough to live on the stack
/// so the callback never allocates.
const MAX_CHANNELS: usize = 64;

/// `kAudioAggregateDevicePropertyFullSubDeviceList`, which `coreaudio-sys` does not bind. Settable
/// on a live aggregate: the HAL swaps the sub-devices under a running IO proc.
const AGGREGATE_SUB_DEVICE_LIST: u32 = u32::from_be_bytes(*b"grup");

/// `kAudioAggregateDevicePropertyMainSubDevice`. The sub-device the aggregate takes its clock
/// from; must already be in the list above.
const AGGREGATE_MAIN_SUB_DEVICE: u32 = u32::from_be_bytes(*b"amst");

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
    /// `f32` bits. The gain the mix is actually applying right now, which chases `gain` rather
    /// than jumping to it.
    ///
    /// Owned by the render callback: nothing else writes it, and it is an atomic only because the
    /// callback sees `SessionControl` through a shared reference. Starts where `gain` already is,
    /// so a rebuild restores the remembered level immediately and only a change ramps.
    applied: AtomicU32,
}

/// Below this a tap is reporting its own noise floor, not audio. -80 dBFS.
const SIGNAL_FLOOR: f32 = 0.0001;

/// Per-frame coefficient of the one-pole the applied gain follows the slider through.
///
/// A gain read once per cycle and held flat across it is a staircase, and the step lands wherever
/// the buffer boundary falls. On built-in output the buffers are short enough for that to pass as
/// a smooth move; over Bluetooth they are several times longer, and the same staircase is the
/// zipper the user hears when dragging a slider.
///
/// Roughly a 10 ms time constant at 48 kHz: fast enough that a drag feels attached to the thumb,
/// slow enough that no single step is a click. The rate is nominal rather than read from the
/// device, so the constant is a time *about* 10 ms, not exactly it - the ear cannot tell the
/// difference between 9 and 11, and threading the real rate into the callback buys nothing.
const GAIN_SLEW: f32 = 0.002;

/// Per-frame coefficient of the duck applied around a device swap. Roughly a 3 ms time constant
/// at 48 kHz — fast enough that [`FADE_SETTLE`] stays short enough not to read as a dropout, slow
/// enough to be a fade rather than a second click.
const FADE_SLEW: f32 = 0.007;

/// How long the mix is given to reach silence before the sub-device is swapped underneath it.
///
/// Six time constants, so the level is roughly -55 dB by the time the swap lands. Waiting for the
/// callback to report arrival instead would mean blocking on a device that may already have
/// stopped, which is the one state where the wait can never end.
const FADE_SETTLE: Duration = Duration::from_millis(20);

/// Below this the ramp has arrived and snaps to the target.
///
/// Wide enough on purpose. A one-pole in `f32` does not converge: once the step is smaller than
/// the ULP of the value it is added to, the sum stops moving and the ramp stalls tens of
/// microunits short — which without a snap is a slider that never quite sets the volume it shows.
/// One part in ten thousand of full scale is a hundred times past that floor and eighty dB below
/// anything audible.
const GAIN_SETTLED: f32 = 1.0e-4;

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

/// How long a row outlives the OS reporting its app as running output.
///
/// Long enough to bridge the gap an output change opens — every app loses the flag at once and
/// regains it a moment later — and short enough that an app which really quit is gone before the
/// user looks for it.
const ROW_GRACE: Duration = Duration::from_secs(3);
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
            .join("Library/Application Support/app.somul.mixer")
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

/// How many rebuilds may come back silent before Somul stops re-asking macOS.
///
/// The bound is the whole point. Every rebuild puts the capture question to macOS again, and on a
/// build whose signature cannot hold a grant that means a fresh prompt each time — one every three
/// seconds, for as long as the panel is open.
///
/// Past this, a grant made while Somul was running would already have been picked up, and what is
/// left is the case no rebuild can reach: macOS settles the capture question once per process, so
/// a permission granted after launch is only seen by a process that starts after it.
///
/// Two rather than one. The first retry races a user who is still walking to System Settings, and
/// offering a relaunch while the checkbox is still unticked sends them round a loop with no exit.
const CAPTURE_RETRIES_BEFORE_RELAUNCH: u32 = 2;

impl SessionControl {
    fn new(gain: f32, is_muted: bool, has_signal: bool) -> Self {
        Self {
            gain: AtomicU32::new(gain.to_bits()),
            is_muted: AtomicBool::new(is_muted),
            peak: AtomicU32::new(0.0_f32.to_bits()),
            has_signal: AtomicBool::new(has_signal),
            signal_run: AtomicU32::new(0),
            applied: AtomicU32::new(if is_muted { 0.0 } else { gain }.to_bits()),
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

    fn applied_gain(&self) -> f32 {
        f32::from_bits(self.applied.load(Ordering::Relaxed))
    }

    fn set_applied_gain(&self, gain: f32) {
        self.applied.store(gain.to_bits(), Ordering::Relaxed);
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

    /// Records one render cycle's levels from the callback.
    ///
    /// Takes two, because the two questions have different answers. `audible` is what leaves for
    /// the device with this session's gain already in it, and is what the meter draws: a slider
    /// pulled to zero has to read as silence, or the panel shows a bar bouncing beside a control
    /// the user has just used to stop the sound.
    ///
    /// `produced` is the app's own level before that gain, and is what decides whether the app has
    /// been heard at all. Feeding the metered value in here instead would make turning a slider
    /// down look like the app went quiet on its own, and Somul would give up its control of it.
    ///
    /// Keeps the loudest level seen since the UI last read, so a peak between two reads is
    /// reported rather than overwritten by the quiet frame that followed it.
    ///
    /// A cycle at or below the floor restarts the run rather than shortening it. The run is
    /// evidence of continuous output, and an app producing audio one cycle in three is a stream
    /// opening and closing, not something to give a slider.
    fn observe(&self, produced: f32, audible: f32) {
        if f32::from_bits(self.peak.load(Ordering::Relaxed)) < audible {
            self.peak.store(audible.to_bits(), Ordering::Relaxed);
        }

        if self.has_signal.load(Ordering::Relaxed) {
            return;
        }

        if produced <= SIGNAL_FLOOR {
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
    /// Level the whole mix is scaled by, used to duck around an output swap.
    fade: Fade,
    /// Render cycles that arrived with tap channels attached.
    ///
    /// A tap mutes its app at the hardware, so the app is audible only through this callback. If
    /// the callback never runs, or runs with no tap input, the user's audio is simply gone until
    /// Somul exits. [`AggregateStartup`] reads this to decide whether the mix is really running.
    tapped_cycles: AtomicU64,
}

/// A duck applied to the whole mix, independent of any app's own gain.
///
/// Exists for the moment the aggregate's output is swapped. The HAL replaces the device under a
/// running IO proc, and the samples either side of that swap have nothing to do with each other —
/// a step the hardware reproduces as a click. Ducking to silence first makes the step a step
/// between two silences.
#[derive(Debug)]
struct Fade {
    /// `f32` bits, owned by the render callback in the same way as [`SessionControl::applied`].
    current: AtomicU32,
    /// `f32` bits. Where the callback is being asked to take the level.
    target: AtomicU32,
}

impl Fade {
    /// Starts silent. Every aggregate is either brand new or replacing one that was ducked before
    /// it was torn down, and both want the first cycles faded in rather than stepped into.
    fn ducked() -> Self {
        Self {
            current: AtomicU32::new(0.0_f32.to_bits()),
            target: AtomicU32::new(1.0_f32.to_bits()),
        }
    }

    fn current(&self) -> f32 {
        f32::from_bits(self.current.load(Ordering::Relaxed))
    }

    fn set_current(&self, level: f32) {
        self.current.store(level.to_bits(), Ordering::Relaxed);
    }

    fn target(&self) -> f32 {
        f32::from_bits(self.target.load(Ordering::Relaxed))
    }

    fn duck(&self) {
        self.target.store(0.0_f32.to_bits(), Ordering::Relaxed);
    }

    fn restore(&self) {
        self.target.store(1.0_f32.to_bits(), Ordering::Relaxed);
    }
}

/// Takes a running aggregate that already carries exactly this device and exactly these apps.
///
/// Membership is compared by key rather than by count: two groups of the same size on the same
/// device are still different mixes, and keeping the wrong one would leave an app rendering
/// through an aggregate that no longer references its tap.
fn take_matching(
    running: &mut Vec<Aggregate>,
    output: AudioObjectID,
    indices: &[usize],
    slots: &[TapSlot],
) -> Option<Aggregate> {
    let wanted: Vec<&str> = indices.iter().map(|index| slots[*index].key.as_str()).collect();

    let found = running.iter().position(|aggregate| {
        aggregate.output == output && carries_exactly(&aggregate.members, &wanted)
    })?;

    Some(running.remove(found))
}

/// Whether an aggregate carries exactly these apps, in any order.
///
/// By key rather than by count: two groups of the same size on the same device are still
/// different mixes, and keeping the wrong one would leave an app rendering through an aggregate
/// that no longer references its tap.
fn carries_exactly(members: &[String], wanted: &[&str]) -> bool {
    if members.len() != wanted.len() {
        return false;
    }

    let mut carried: Vec<&str> = members.iter().map(String::as_str).collect();
    let mut wanted: Vec<&str> = wanted.to_vec();

    carried.sort_unstable();
    wanted.sort_unstable();

    carried == wanted
}

/// Whether an app was seen holding an output stream open recently enough to keep its row.
fn is_within_row_grace(seen: Instant, now: Instant) -> bool {
    now.duration_since(seen) < ROW_GRACE
}

/// Whether the apps following the system output are on the wrong device.
///
/// `following` is `None` when no aggregate carries followers — every tapped app has been routed
/// somewhere on purpose. Read as stale, that answered "yes, move it" for a mix with nothing to
/// move, and the caller rebuilt on every poll: taps destroyed and recreated every few seconds,
/// heard as the audio cutting out and coming back.
fn is_following_a_stale_output(
    following: Option<AudioObjectID>,
    system: Option<AudioObjectID>,
) -> bool {
    match (following, system) {
        (Some(following), Some(system)) => following != system,
        _ => false,
    }
}

/// Creates one aggregate around `output`, installs its IO proc, and waits for it to render.
///
/// One per destination device. The taps themselves are owned by the slots, not by the aggregate:
/// an aggregate that fails leaves its apps tapped and available to another one, which is what
/// lets a refused destination fall back to the default without re-tapping anything.
fn start_aggregate(
    output: AudioObjectID,
    slots: &[&TapSlot],
    mute: TapMute,
    is_default: bool,
) -> Result<Aggregate, AudioError> {
    let output_uid = device_uid(output)?;
    let tap_uids: Vec<&str> = slots.iter().map(|slot| slot._tap.uid()).collect();
    let device = create_aggregate(&output_uid, &tap_uids)?;

    let render = Box::new(RenderState {
        controls: slots
            .iter()
            .map(|slot| Arc::clone(&slot.control))
            .collect(),
        fade: Fade::ducked(),
        tapped_cycles: AtomicU64::new(0),
        is_probing: mute == TapMute::Passthrough,
    });

    let mut aggregate = Aggregate {
        device,
        output,
        members: slots.iter().map(|slot| slot.key.clone()).collect(),
        is_default,
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
    check(
        unsafe { AudioDeviceStart(device, io_proc) },
        "starting the mixer",
    )?;

    aggregate.is_running = true;

    diagnose!(
        "built {} tap(s) as {:?} on {output_uid} for [{}]",
        slots.len(),
        mute,
        slots
            .iter()
            .map(|slot| slot.key.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    );

    wait_for_mix(&aggregate.render)?;

    Ok(aggregate)
}

/// A private aggregate device holding one output plus the taps that play through it.
struct Aggregate {
    device: AudioObjectID,
    /// The output this aggregate was built around.
    ///
    /// Carried here rather than beside the collection because it is a fact about one aggregate,
    /// and per-app routing gives the engine more than one of them at a time.
    output: AudioObjectID,
    /// Whether this aggregate carries the apps that follow the system output.
    ///
    /// Only this one moves when the default changes. Followers and pinned apps never share an
    /// aggregate, so moving it in place can never drag a pin along.
    is_default: bool,
    /// The keys of the apps it carries, so a regroup can tell a mix that has not changed from one
    /// that has and leave the unchanged one running.
    members: Vec<String>,
    io_proc: AudioDeviceIOProcID,
    is_running: bool,
    /// Handed to the callback as a raw pointer. Kept boxed here so the allocation outlives every
    /// callback invocation; teardown stops the device before this is dropped.
    render: Box<RenderState>,
}

impl Aggregate {
    /// Moves the mix onto another output without touching the taps.
    ///
    /// Tearing the aggregate down instead would destroy every tap, and a destroyed tap hands its
    /// app back to the hardware until the replacement is built, started, and heard — a silence
    /// long enough to read as the app pausing. Swapping the sub-device leaves the taps, the IO
    /// proc, and every gain in place; the only gap is the HAL's own restart.
    fn retarget(&self, output_uid: &str) -> Result<(), AudioError> {
        let sub_devices = NSArray::from_retained_slice(&[NSString::from_str(output_uid)]);
        let sub_devices_ref: CFArrayRef = Retained::as_ptr(&sub_devices).cast();

        write_property(
            self.device,
            &address(
                AGGREGATE_SUB_DEVICE_LIST,
                kAudioObjectPropertyScopeGlobal,
                kAudioObjectPropertyElementMain,
            ),
            &sub_devices_ref,
            "moving the mixer onto the new output",
        )?;

        let main = NSString::from_str(output_uid);
        let main_ref: CFStringRef = Retained::as_ptr(&main).cast();

        let main_address = address(
            AGGREGATE_MAIN_SUB_DEVICE,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain,
        );

        write_property(
            self.device,
            &main_address,
            &main_ref,
            "clocking the mixer from the new output",
        )?;

        // Read back, for the same reason `set_default_output_device` does: the HAL answers noErr
        // to a composition it then declines to adopt. Trusting the write would leave the mix
        // playing out of the old device with the engine recording the new one, which is the
        // original bug wearing the fix's clothes.
        //
        // Against the main sub-device rather than the *active* sub-device list, which is the
        // stricter question and the wrong one. A Bluetooth device selected a moment ago has been
        // adopted but has not started streaming, so it is absent from the active list while being
        // exactly the device the mix now belongs on — which is why moving to Bluetooth failed
        // where moving to the built-in speakers, always streaming, did not.
        let adopted = read_property::<CFStringRef>(
            self.device,
            &main_address,
            "reading back the mixer's main sub-device",
        )
        .map(take_cf_string)?;

        if adopted == output_uid {
            return Ok(());
        }

        Err(AudioError::BackendFailure(format!(
            "the mixer stayed clocked from {adopted} instead of {output_uid}"
        )))
    }

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
    /// One per output device the tap set plays through.
    ///
    /// A vector rather than an option because per-app routing puts apps on different devices at
    /// once, and each device needs its own aggregate, its own IO proc, and its own clock. Today
    /// it never holds more than one.
    aggregates: Vec<Aggregate>,
    /// key -> the output that app was routed to. Absent means it follows the system default.
    ///
    /// Keyed the same way `remembered` is, so a routed app keeps its destination across the
    /// rebuild that adding or removing another app costs.
    destinations: BTreeMap<String, AudioObjectID>,
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
    /// When each app was last seen holding an output stream open.
    ///
    /// `IsRunningOutput` is not a steady signal: macOS drops it for every app at once when the
    /// output device changes, and again between tracks. The taps deliberately survive that, and
    /// so must the rows — a panel that empties itself while the music is still playing through it
    /// is telling the user something plainly untrue.
    last_seen: BTreeMap<String, Instant>,
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
    /// How many times capture has been asked for again since the taps fell silent.
    ///
    /// Survives a rebuild, unlike `probed_at`, because it counts attempts rather than pacing them.
    /// Cleared only when capture succeeds: the panel reads it to tell a grant that has not landed
    /// yet from one this process will never see.
    capture_retries: u32,
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
    /// Brings the tap set in line with the apps currently playing.
    ///
    /// A rebuild tears the aggregate down and builds it again, and every tap it destroys hands its
    /// app back to the hardware until the replacement has been built, started, and heard. That gap
    /// is audible, so it is spent only on the one thing that cannot be done without it: giving a
    /// tap to an app that has none.
    ///
    /// An app *leaving* the list therefore rebuilds nothing. `IsRunningOutput` goes false for
    /// every app at once whenever the output device changes, and again between tracks and across
    /// a stream reopening — and a rebuild on each of those was heard as every other app pausing
    /// and resuming. The departing app's tap simply stays: it delivers silence while its app is
    /// quiet, carries it again the moment it resumes, and is swept by the next rebuild that has a
    /// reason of its own.
    pub fn sync(&self, processes: &[ProcessSession]) -> Result<(), AudioError> {
        let mut state = self.lock();

        let wanted: Vec<String> = processes.iter().map(ProcessSession::identifier).collect();
        let is_first_sync = !self.has_synced.swap(true, Ordering::Relaxed);
        let is_short_a_tap = {
            let built: Vec<&str> = state.slots.iter().map(|slot| slot.key.as_str()).collect();

            is_short_a_tap(&wanted, &built)
        };

        let now = Instant::now();

        for key in &wanted {
            state.last_seen.insert(key.clone(), now);
        }

        state
            .last_seen
            .retain(|_, seen| is_within_row_grace(*seen, now));

        // Tracks what is playing rather than what was last built: peaks are published against
        // these keys, and the panel pairs them with the session list by key.
        state.keys = wanted;

        if is_first_sync || is_short_a_tap {
            state.processes = processes.to_vec();

            let processes = state.processes.clone();
            let mute = self.tap_mute();

            return state.adopt(&processes, mute);
        }

        // Only meaningful while something is actually following the system output. With no taps
        // built there is no device to be stale against, and with every tapped app routed away
        // there is nobody to move.
        if is_following_a_stale_output(state.output(), super::default_output_device().ok()) {
            return state.follow_output(self.tap_mute());
        }

        Ok(())
    }

    /// Rebuilds the aggregate around whatever the system output is now.
    ///
    /// Called straight from the device switch rather than left to the next poll. The meter loop
    /// is stopped while the panel is hidden, so a switch made from elsewhere in macOS would
    /// otherwise leave every tapped app on the old device until the panel was next opened -- and
    /// a switch made from Somul's own picker would lag it by up to a poll.
    pub fn follow_default_output(&self) -> Result<(), AudioError> {
        let mut state = self.lock();

        if !is_following_a_stale_output(state.output(), super::default_output_device().ok()) {
            return Ok(());
        }

        let mute = self.tap_mute();

        state.follow_output(mute)
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
        state.capture_retries = 0;
        record_capture_proof();

        Ok(())
    }

    /// Whether capture has ever worked, here or on an earlier run of this Mac.
    ///
    /// Outranks anything macOS reports now: a tap that delivered audio is proof, where an
    /// authorization answer is only a claim about what should happen next.
    pub fn has_proven_capture(&self) -> bool {
        self.has_proven_capture.load(Ordering::Relaxed) || capture_ever_proven()
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

        // Stop once the budget is spent. Every rebuild puts the capture question to macOS again,
        // and on a build whose signature cannot hold a grant — an ad-hoc one, which is what an
        // unsigned download is — macOS answers each question with a fresh prompt. Left unbounded
        // this asked every three seconds for as long as the panel was open, which is not a
        // permission flow but a machine arguing with its user.
        if state.capture_retries >= CAPTURE_RETRIES_BEFORE_RELAUNCH {
            return Ok(());
        }

        let processes = state.processes.clone();

        diagnose!("still silent, asking macOS for capture again");

        let outcome = state.rebuild(&processes, TapMute::Passthrough);

        // Counted only when the taps were actually rebuilt. A rebuild that failed never put the
        // question to macOS, and counting it would spend the budget that decides whether asking
        // again is still worth the user's time.
        if outcome.is_ok() {
            state.capture_retries = state.capture_retries.saturating_add(1);
        }

        outcome
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
    /// The only test a row has to pass. There used to be an exception — list everything until
    /// something has been heard — and it is what put emulators and text editors in the mixer.
    pub fn is_audible(&self, key: &str) -> bool {
        self.control(key)
            .is_some_and(|control| control.has_signal())
    }

    /// Apps still carried by a live tap that the OS has stopped reporting as running output.
    ///
    /// Somul is rendering their audio right now, which is better evidence that they are playing
    /// than a property macOS resets whenever the output device changes. Held only for
    /// [`ROW_GRACE`], so an app that really has quit loses its row rather than lingering.
    pub fn carried_out_of_sight(&self, listed: &[String]) -> Vec<ProcessSession> {
        let state = self.lock();
        let now = Instant::now();

        state
            .processes
            .iter()
            .filter(|process| {
                let key = process.identifier();

                if listed.contains(&key) {
                    return false;
                }

                let is_recent = state
                    .last_seen
                    .get(&key)
                    .is_some_and(|seen| is_within_row_grace(*seen, now));

                is_recent
                    && state
                        .slots
                        .iter()
                        .any(|slot| slot.key == key && slot.control.has_signal())
            })
            .cloned()
            .collect()
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

    /// Sends one app's audio to `output`, or back to the system default with `None`.
    ///
    /// Costs a rebuild, which costs every app a short gap. That is spent here because it is the
    /// one thing routing cannot be done without — the tap set has to be regrouped into a new set
    /// of aggregates — and because unlike the rebuilds the engine does on its own, this one is a
    /// button the user just pressed and expects something to happen after.
    pub fn route(&self, key: &str, output: Option<AudioObjectID>) -> Result<(), AudioError> {
        let mut state = self.lock();

        let previous = state.destinations.get(key).copied();

        if previous == output {
            return Ok(());
        }

        match output {
            Some(output) => state.destinations.insert(key.to_owned(), output),
            None => state.destinations.remove(key),
        };

        // Nothing is tapped yet, so there is no mix to regroup. The destination is remembered and
        // applied by the first build.
        if state.aggregates.is_empty() {
            return Ok(());
        }

        let mute = self.tap_mute();

        state.regroup(mute)
    }

    /// Where one app is currently being sent, or `None` when it follows the system default.
    pub fn destination(&self, key: &str) -> Option<AudioObjectID> {
        self.lock().destinations.get(key).copied()
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
        self.aggregates.clear();
        self.slots.clear();
        self.keys.clear();
    }

    /// The output a tapped app currently plays through.
    ///
    /// A tapped app is muted at the hardware and audible only through its aggregate, so the
    /// aggregate's sub-device *is* where that app plays. Switching the system output moves
    /// everything untapped and would leave every tapped app behind on the old device, which is a
    /// picker that visibly does nothing for exactly the apps the mixer is showing.
    fn output(&self) -> Option<AudioObjectID> {
        self.aggregates
            .iter()
            .find(|aggregate| aggregate.is_default)
            .map(|aggregate| aggregate.output)
    }

    /// Points the mix at whatever the system output is now, in place where the HAL allows it.
    ///
    /// The fallback is a full rebuild, and it is a fallback rather than the default because of
    /// what a rebuild costs the listener: see [`Aggregate::retarget`].
    fn follow_output(&mut self, mute: TapMute) -> Result<(), AudioError> {
        let output = super::default_output_device()?;
        let output_uid = device_uid(output)?;

        // Nothing follows the system output, so there is nothing here to move. Checked before the
        // rebuild below rather than after it: reached with every tapped app routed away, the
        // rebuild fires on every poll for a mix that was never going to change.
        if !self.aggregates.iter().any(|aggregate| aggregate.is_default) {
            return Ok(());
        }

        // Only the aggregates carrying the apps that follow the system output. One routed
        // somewhere on purpose stays where it was put.
        let following: Vec<&mut Aggregate> = self
            .aggregates
            .iter_mut()
            .filter(|aggregate| aggregate.is_default)
            .collect();

        if following.is_empty() {
            return Ok(());
        }

        // Ducked across the swap, and left ducked if it fails: the fallback below tears these
        // aggregates down, and silence is the right level to be at when that happens.
        for aggregate in &following {
            aggregate.render.fade.duck();
        }

        thread::sleep(FADE_SETTLE);

        let moved = following
            .into_iter()
            .map(|aggregate| {
                let result = aggregate.retarget(&output_uid);

                if result.is_ok() {
                    aggregate.output = output;
                    aggregate.render.fade.restore();
                }

                result
            })
            .collect::<Result<Vec<()>, AudioError>>();

        match moved {
            Ok(_) => {
                diagnose!("moved the mix onto {output_uid} in place");

                return Ok(());
            }
            Err(error) => {
                diagnose!("could not move the mix onto {output_uid} in place, rebuilding: {error:?}");
            }
        }

        let processes = self.processes.clone();

        self.rebuild(&processes, mute)
    }

    /// Replaces the tap set, leaving nothing behind if it cannot.
    ///
    /// The failure path is the whole point. `keys` is what tells `sync` the set is already
    /// current, so a build that failed while leaving them set meant every later sync saw its work
    /// as done and returned early — one failure and the engine never tapped anything again.
    /// Gives a tap to the apps that have none, keeping the taps that are already carrying audio.
    ///
    /// The rebuild this replaces destroyed every tap to create one, so a single app starting
    /// playback handed *every* app back to the hardware and took it again. Changing the system
    /// output is enough to trigger it: `IsRunningOutput` goes false for every app at once and
    /// comes back, and whatever reappears first arrives without a tap. That is what was heard as
    /// a gap in an app pinned somewhere the change had nothing to do with.
    ///
    /// Only valid while the tap mute is unchanged. A promotion from passthrough to muted has to
    /// recreate every tap, because the mute is fixed when the tap is created.
    fn adopt(&mut self, processes: &[ProcessSession], mute: TapMute) -> Result<(), AudioError> {
        if self.mute != Some(mute) || self.aggregates.is_empty() {
            return self.rebuild(processes, mute);
        }

        self.remember();

        let mut carried: Vec<Option<TapSlot>> =
            std::mem::take(&mut self.slots).into_iter().map(Some).collect();
        let mut slots = Vec::with_capacity(processes.len());

        for process in processes {
            let key = process.identifier();

            if let Some(slot) = carried
                .iter_mut()
                .find(|slot| slot.as_ref().is_some_and(|slot| slot.key == key))
                .and_then(Option::take)
            {
                slots.push(slot);
                continue;
            }

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

        // Whatever nobody claimed has left the list, and dropping it hands that app back to the
        // hardware — which is what a rebuild did for it too.
        drop(carried);

        if slots.is_empty() {
            self.teardown();

            return Ok(());
        }

        if slots.len() * CHANNELS_PER_TAP > MAX_CHANNELS {
            slots.truncate(MAX_CHANNELS / CHANNELS_PER_TAP);
        }

        self.slots = slots;

        let assembled = self.assemble(mute);

        if assembled.is_err() {
            diagnose!("adopting the new taps failed, rebuilding");
            self.slots.clear();

            return self.rebuild(processes, mute);
        }

        Ok(())
    }

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

        self.slots = slots;

        // Dropping `self.slots` is what hands every app back to the hardware, and the taps above
        // have already muted them. A failure to assemble must therefore release them rather than
        // leave the mixer holding audio it is not rendering.
        let assembled = self.assemble(mute);

        if assembled.is_err() {
            self.slots.clear();
        }

        assembled
    }

    /// Moves the taps between aggregates, leaving any aggregate that has not changed alone.
    ///
    /// Ducking belongs to the aggregates actually being replaced, inside `assemble_slots`. Fading
    /// the whole mix here is what made moving the master output audible in an app pinned
    /// somewhere else: nothing about that app's mix was changing, and it was dipped anyway.
    ///
    /// Falls back to a full rebuild if the regroup fails. The taps are still holding every app
    /// away from the hardware at that point, so leaving them without an aggregate to render
    /// through would be silence with no way out short of quitting.
    fn regroup(&mut self, mute: TapMute) -> Result<(), AudioError> {
        if let Err(error) = self.assemble(mute) {
            diagnose!("regrouping the taps failed, rebuilding: {error:?}");

            let processes = self.processes.clone();

            return self.rebuild(&processes, mute);
        }

        Ok(())
    }

    /// Groups the live taps into aggregates and starts them, leaving the taps themselves alone.
    ///
    /// This is the whole difference between changing a destination and rebuilding. A tap is a
    /// system object an aggregate merely references by uid, so regrouping costs the time to
    /// restart some aggregates — where destroying the taps hands every app back to the hardware
    /// and takes it again, which is the long silence a rebuild is heard as.
    fn assemble(&mut self, mute: TapMute) -> Result<(), AudioError> {
        let default_output = super::default_output_device()?;
        let slots = std::mem::take(&mut self.slots);

        let result = self.assemble_slots(&slots, default_output, mute);

        self.slots = slots;

        result
    }

    fn assemble_slots(
        &mut self,
        slots: &[TapSlot],
        default_output: AudioObjectID,
        mute: TapMute,
    ) -> Result<(), AudioError> {
        let available = super::output_device_ids().unwrap_or_default();
        // Keyed by device *and* by whether the app was pinned there, so the followers never share
        // an aggregate with an app pinned to the device the default happens to be on. Grouped by
        // device alone they merged whenever the default landed on a pinned app's device, and the
        // merge restarted that app's aggregate — the one gap routing was meant to spare it. Two
        // aggregates on one device is an arrangement the routing spike verifies.
        let mut groups: BTreeMap<(AudioObjectID, bool), Vec<usize>> = BTreeMap::new();

        for (index, slot) in slots.iter().enumerate() {
            // A destination that has been unplugged resolves back to the default rather than
            // failing. The preset stays on disk untouched, so plugging the device back in puts
            // the app on it again without the user having to pick it a second time.
            let destination = self
                .destinations
                .get(&slot.key)
                .copied()
                .filter(|device| available.contains(device));

            let key = match destination {
                Some(device) => (device, true),
                None => (default_output, false),
            };

            groups.entry(key).or_default().push(index);
        }

        let mut default_group = groups.remove(&(default_output, false)).unwrap_or_default();

        // An aggregate whose device and membership both survive the regroup is left running.
        //
        // Rebuilding it anyway is what made moving the *master* output audible in an app pinned
        // to headphones: that aggregate's destination had not changed, its apps had not changed,
        // and it was torn down and restarted regardless.
        let mut running = std::mem::take(&mut self.aggregates);
        let mut aggregates = Vec::with_capacity(groups.len() + 1);
        let mut pending: Vec<(AudioObjectID, Vec<usize>)> = Vec::new();

        for ((output, _), indices) in groups {
            match take_matching(&mut running, output, &indices, slots) {
                Some(mut kept) => {
                    // Kept across a change of what the system calls default, so its relation to
                    // the default is re-derived. Left as it was, an aggregate that had been the
                    // default one kept claiming to be, and every poll read its unchanged device
                    // as a follower on the wrong output — a regroup that touched nothing, fired
                    // forever.
                    kept.is_default = false;
                    aggregates.push(kept);
                }
                None => pending.push((output, indices)),
            }
        }

        let kept_default = if default_group.is_empty() {
            None
        } else {
            take_matching(&mut running, default_output, &default_group, slots)
        };

        // Every aggregate that is being replaced goes now, before a single new one is created.
        //
        // Two aggregates cannot reference the same tap: created while the old one still holds it,
        // the new aggregate never renders, and the taps are left holding every app away from the
        // hardware with nothing playing them. Silence with no way out short of quitting.
        if !running.is_empty() {
            for aggregate in &running {
                aggregate.render.fade.duck();
            }

            thread::sleep(FADE_SETTLE);
            drop(running);
        }

        // Non-default destinations first, so one that refuses can hand its apps back to the
        // default group before that group is built — a device the user routed to being flaky must
        // cost that app its destination, never everyone else their audio.
        let mut has_folded_back = false;

        for (output, indices) in pending {
            let members: Vec<&TapSlot> = indices.iter().map(|index| &slots[*index]).collect();

            match start_aggregate(output, &members, mute, false) {
                Ok(aggregate) => aggregates.push(aggregate),
                Err(error) => {
                    diagnose!("{output} refused the mix, falling its apps back to the default: {error:?}");
                    default_group.extend(indices);
                    has_folded_back = true;
                }
            }
        }

        let now = Instant::now();

        self.mute = Some(mute);
        self.probed_at = Some(now);
        self.silent_since = self.silent_since.or(Some(now));

        if !default_group.is_empty() {
            default_group.sort_unstable();

            // A fold-back changed who belongs here, so a kept aggregate is now the wrong mix and
            // has to go before its replacement can reference the same taps.
            let kept_default = if has_folded_back { None } else { kept_default };

            match kept_default {
                Some(mut kept) => {
                    // The device and the apps are the same; only what the system calls default
                    // may have moved under it.
                    kept.is_default = true;
                    aggregates.push(kept);
                }
                None => {
                    let members: Vec<&TapSlot> =
                        default_group.iter().map(|index| &slots[*index]).collect();

                    // Nothing here is optional. Every tap muted its app at the hardware, so if the
                    // mix is not running the user has lost that audio entirely, with no way back
                    // short of quitting Somul.
                    aggregates.push(start_aggregate(default_output, &members, mute, true)?);
                }
            }
        }

        self.aggregates = aggregates;

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

/// Whether anything playing has no tap of its own, which is the only thing worth a rebuild.
///
/// Deliberately one-directional. Keys that are built but no longer playing are not a reason to
/// rebuild — see [`TapEngine::sync`] for why that direction is the expensive mistake.
fn is_short_a_tap(wanted: &[String], built: &[&str]) -> bool {
    wanted
        .iter()
        .any(|key| !built.contains(&key.as_str()))
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
                "app.somul.mixer.aggregate.{}.{serial}",
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

    // SAFETY: the output view was mapped from this cycle's buffer list, and the frame count came
    // from that same list.
    unsafe { duck(&outputs, output_frames, &state.fade) };

    0
}

/// Scales the summed mix by the fade level, advancing it one step per frame.
///
/// A pass of its own rather than folded into each app's gain: the duck belongs to the output, not
/// to any one app, and applying it once to the sum is both cheaper and the only way every app is
/// guaranteed to be scaled by the same value.
///
/// SAFETY: `outputs` must describe live buffers holding at least `frames` frames.
unsafe fn duck(outputs: &Channels, frames: usize, fade: &Fade) {
    let target = fade.target();
    let mut level = fade.current();

    // The steady state is full level, which is a multiply by one on every sample of every cycle
    // for the whole life of the engine. Skipping it costs one comparison instead.
    if level == target && target == 1.0 {
        return;
    }

    for frame in 0..frames {
        level += (target - level) * FADE_SLEW;

        if (target - level).abs() < GAIN_SETTLED {
            level = target;
        }

        for channel in 0..outputs.len {
            let (pointer, stride) = outputs.entries[channel];

            unsafe { *pointer.add(frame * stride) *= level };
        }
    }

    fade.set_current(level);
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
        let target = if control.is_muted() { 0.0 } else { control.gain() };
        let mut gain = control.applied_gain();
        let mut produced = 0.0_f32;
        let mut audible = 0.0_f32;

        // Channel pairing is resolved before the frame loop so that loop stays arithmetic. A mono
        // output still has to carry every app, so the last channel takes the overflow rather than
        // dropping it.
        let unused = ((ptr::null_mut::<f32>(), 0_usize), (ptr::null_mut::<f32>(), 0_usize));
        let mut lanes = [unused; CHANNELS_PER_TAP];
        let mut lane_count = 0;

        for channel in 0..CHANNELS_PER_TAP {
            let source = index * CHANNELS_PER_TAP + channel;

            if source >= inputs.len {
                break;
            }

            lanes[lane_count] = (
                inputs.entries[source],
                outputs.entries[channel.min(outputs.len - 1)],
            );
            lane_count += 1;
        }

        for frame in 0..frames {
            // Advanced once per frame rather than once per channel: both channels of one app have
            // to be scaled by the same value, or the stereo image walks while the slider moves.
            gain += (target - gain) * GAIN_SLEW;

            if (target - gain).abs() < GAIN_SETTLED {
                gain = target;
            }

            for &((in_pointer, in_stride), (out_pointer, out_stride)) in &lanes[..lane_count] {
                let sample = unsafe { *in_pointer.add(frame * in_stride) };
                let magnitude = sample.abs();

                if magnitude > produced {
                    produced = magnitude;
                }

                // While probing, the tap is passthrough and this callback writes silence — the
                // hardware is still playing the app itself, so `gain` reaches nobody's ears and
                // the audible level is the app's own.
                let contributed = if is_probing { magnitude } else { magnitude * gain };

                if contributed > audible {
                    audible = contributed;
                }

                if !is_probing {
                    let destination = unsafe { &mut *out_pointer.add(frame * out_stride) };
                    *destination = (*destination + sample * gain).clamp(-1.0, 1.0);
                }
            }
        }

        control.set_applied_gain(gain);
        control.observe(produced, audible);
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

    /// A row has to outlive the flicker an output change causes without outliving the app.
    ///
    /// `IsRunningOutput` drops for every app at once when the output device changes and returns a
    /// moment later. Without the grace the panel emptied itself mid-song; with too much of it an
    /// app that really quit would keep a slider nobody can use.
    #[test]
    fn a_row_survives_the_flicker_an_output_change_causes() {
        let seen = Instant::now();

        assert!(is_within_row_grace(seen, seen + Duration::from_millis(500)));
        assert!(is_within_row_grace(seen, seen + ROW_GRACE - Duration::from_millis(1)));
    }

    #[test]
    fn a_row_does_not_outlive_an_app_that_really_left() {
        let seen = Instant::now();

        assert!(!is_within_row_grace(seen, seen + ROW_GRACE));
        assert!(!is_within_row_grace(seen, seen + Duration::from_secs(30)));
    }

    /// What decides whether an aggregate survives a regroup untouched.
    ///
    /// Getting it wrong in either direction is audible: too strict and an unchanged mix is torn
    /// down and restarted for nothing, which is what made moving the master output cut an app
    /// pinned to headphones; too loose and an aggregate is kept that no longer references one of
    /// its taps, and that app goes silent.
    #[test]
    fn a_mix_with_the_same_apps_in_any_order_is_the_same_mix() {
        let members = vec!["pid:2".to_owned(), "pid:1".to_owned()];

        assert!(carries_exactly(&members, &["pid:1", "pid:2"]));
        assert!(carries_exactly(&members, &["pid:2", "pid:1"]));
    }

    #[test]
    fn a_mix_that_gained_or_lost_an_app_is_a_different_mix() {
        let members = vec!["pid:1".to_owned(), "pid:2".to_owned()];

        assert!(!carries_exactly(&members, &["pid:1"]));
        assert!(!carries_exactly(&members, &["pid:1", "pid:2", "pid:3"]));
    }

    /// Same size, different apps. Compared by count alone this would read as unchanged, and the
    /// kept aggregate would be rendering a tap it no longer holds.
    #[test]
    fn a_mix_that_swapped_an_app_is_a_different_mix() {
        let members = vec!["pid:1".to_owned(), "pid:2".to_owned()];

        assert!(!carries_exactly(&members, &["pid:1", "pid:3"]));
    }

    #[test]
    fn an_empty_mix_matches_only_an_empty_one() {
        assert!(carries_exactly(&[], &[]));
        assert!(!carries_exactly(&[], &["pid:1"]));
    }

    /// The regression this pins. Every tapped app routed away leaves nobody following the system
    /// output, and reading that as "the followers are on the wrong device" made the caller rebuild
    /// on every session poll — taps destroyed and recreated every few seconds, heard as the audio
    /// cutting out and coming back while the panel was open.
    #[test]
    fn nothing_following_the_system_output_is_never_stale() {
        assert!(!is_following_a_stale_output(None, Some(7)));
    }

    #[test]
    fn a_mix_with_no_system_output_to_follow_is_never_stale() {
        assert!(!is_following_a_stale_output(Some(7), None));
    }

    #[test]
    fn followers_on_another_device_are_stale() {
        assert!(is_following_a_stale_output(Some(7), Some(9)));
        assert!(!is_following_a_stale_output(Some(7), Some(7)));
    }

    /// A quiet cycle after a loud one must not erase the loud one before the UI has read it.
    #[test]
    fn holds_the_loudest_level_between_two_reads() {
        let control = SessionControl::new(1.0, false, false);

        control.observe(0.6, 0.6);
        control.observe(0.1, 0.1);

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
            control.observe(0.5, 0.5);
        }

        assert!(!control.has_signal());
    }

    #[test]
    fn a_sustained_run_above_the_floor_is_playback() {
        let control = SessionControl::new(1.0, false, false);

        for _ in 0..SIGNAL_CYCLES {
            control.observe(0.5, 0.5);
        }

        assert!(control.has_signal());
    }

    /// Restarted, not decremented: an app rendering one loud cycle in three is a stream opening
    /// and closing, and accumulating those would let it reach the run and claim a row.
    #[test]
    fn a_silent_cycle_restarts_the_run() {
        let control = SessionControl::new(1.0, false, false);

        for _ in 0..SIGNAL_CYCLES * 2 {
            control.observe(0.5, 0.5);
            control.observe(0.0, 0.0);
        }

        assert!(!control.has_signal());
    }

    /// The floor is a threshold the level has to clear, not one it may sit on.
    #[test]
    fn a_run_exactly_at_the_floor_is_the_taps_own_noise() {
        let control = SessionControl::new(1.0, false, false);

        for _ in 0..SIGNAL_CYCLES {
            control.observe(SIGNAL_FLOOR, SIGNAL_FLOOR);
        }

        assert!(!control.has_signal());
    }

    /// The meter draws what leaves for the device, not what the app produced.
    ///
    /// A slider pulled to zero has to read as silence. Metering the pre-gain level instead left a
    /// bar bouncing beside the control the user had just used to stop the sound.
    #[test]
    fn a_silenced_session_meters_as_silence() {
        let control = SessionControl::new(1.0, false, false);

        control.observe(0.8, 0.0);

        assert_eq!(control.take_peak(), 0.0);
    }

    #[test]
    fn the_meter_follows_the_slider_down() {
        let control = SessionControl::new(1.0, false, false);

        control.observe(0.8, 0.4);

        assert_eq!(control.take_peak(), 0.4);
    }

    /// The other half of the split. Turning a slider down must not look like the app went quiet on
    /// its own — the run is what decides Somul has heard it, and losing it would drop the row.
    #[test]
    fn a_silenced_session_is_still_heard_playing() {
        let control = SessionControl::new(1.0, false, false);

        for _ in 0..SIGNAL_CYCLES {
            control.observe(0.5, 0.0);
        }

        assert!(control.has_signal());
    }

    /// Meters must keep working for an app still short of the run, or a row that does appear
    /// would arrive with a dead meter.
    #[test]
    fn a_level_below_the_run_still_reaches_the_meter() {
        let control = SessionControl::new(1.0, false, false);

        control.observe(0.5, 0.5);

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

    /// An app that stops playing must not cost every other app its tap. This is the whole reason
    /// a device switch no longer sounds like a pause: `IsRunningOutput` drops for everything at
    /// once, and rebuilding on that was the gap.
    #[test]
    fn an_app_going_quiet_is_not_worth_a_rebuild() {
        let built = ["macos:app:com.spotify", "macos:app:com.google.Chrome"];

        assert!(!is_short_a_tap(&[], &built));
        assert!(!is_short_a_tap(
            &["macos:app:com.spotify".to_owned()],
            &built
        ));
    }

    /// The one thing that cannot be done without a rebuild.
    #[test]
    fn an_app_with_no_tap_forces_a_rebuild() {
        let built = ["macos:app:com.spotify"];

        assert!(is_short_a_tap(
            &["macos:app:com.apple.Music".to_owned()],
            &built
        ));
        assert!(is_short_a_tap(&["macos:app:com.spotify".to_owned()], &[]));
    }

    /// A fresh aggregate must fade in rather than step in, or every rebuild starts with a click.
    #[test]
    fn a_new_mix_fades_in_from_silence() {
        let output = Buffers::new(2, 64, 1.0);
        let fade = Fade::ducked();

        unsafe { duck(&output.view(), 64, &fade) };

        assert!(output.samples[0] < 0.05, "the mix started at full level");
        assert!(
            output.samples[output.samples.len() - 1] > output.samples[0],
            "the fade never rose"
        );
        assert!(
            output.samples.windows(2).all(|pair| pair[1] >= pair[0] - 1e-6),
            "the fade is not monotonic"
        );
    }

    /// The duck has to actually reach silence within [`FADE_SETTLE`], or the swap it protects
    /// still lands on audible samples and still clicks.
    #[test]
    fn ducking_reaches_silence_within_the_settle_window() {
        let fade = Fade::ducked();

        // Arrive at full level first, the state a running mix is really in.
        for _ in 0..40 {
            let output = Buffers::new(2, 512, 1.0);

            unsafe { duck(&output.view(), 512, &fade) };
        }

        assert_eq!(fade.current(), 1.0);

        fade.duck();

        // One settle window's worth of frames at 48 kHz.
        let frames = (FADE_SETTLE.as_secs_f32() * 48_000.0) as usize;
        let output = Buffers::new(2, frames, 1.0);

        unsafe { duck(&output.view(), frames, &fade) };

        assert!(
            fade.current() < 0.01,
            "the duck was still at {} when the swap would have landed",
            fade.current()
        );
    }

    /// Full level is the steady state, so it must cost nothing and colour nothing.
    #[test]
    fn a_settled_fade_leaves_the_mix_untouched() {
        let output = Buffers::new(2, 8, 0.5);
        let fade = Fade::ducked();

        fade.set_current(1.0);

        unsafe { duck(&output.view(), 8, &fade) };

        assert!(output.samples.iter().all(|sample| *sample == 0.5));
    }

    /// A fresh engine has nothing to tear down, and an empty sync must stay a no-op.
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

    /// A slider move has to arrive as a ramp. The failure this catches is the gain being read once
    /// per cycle and held flat across it: one Bluetooth buffer is long enough for that step to be
    /// the zipper the user hears while dragging.
    #[test]
    fn a_gain_change_ramps_across_the_buffer_instead_of_stepping() {
        let input = Buffers::new(2, 512, 1.0);
        let output = Buffers::new(2, 512, 0.0);
        let controls = vec![control(1.0, false)];

        controls[0].set_gain(0.0);

        unsafe { mix(&input.view(), &output.view(), 512, 512, &controls, false) };

        let first = output.samples[0];
        let last = output.samples[output.samples.len() - 1];

        assert!(first > 0.9, "the ramp jumped rather than starting where the gain was");
        assert!(last < first, "the ramp never moved toward the new gain");
        assert!(
            output.samples.windows(2).all(|pair| pair[1] <= pair[0] + 1e-6),
            "the ramp is not monotonic, so it is not a ramp"
        );
    }

    /// The ramp has to arrive, not approach forever. A gain that never quite reaches its target is
    /// a slider that never quite sets the volume it is showing.
    #[test]
    fn the_ramp_settles_on_the_requested_gain() {
        let controls = vec![control(1.0, false)];

        controls[0].set_gain(0.5);

        for _ in 0..20 {
            let input = Buffers::new(2, 512, 1.0);
            let output = Buffers::new(2, 512, 0.0);

            unsafe { mix(&input.view(), &output.view(), 512, 512, &controls, false) };
        }

        assert_eq!(controls[0].applied_gain(), 0.5);
    }

    /// Nothing built means nothing to move. The failure this catches is a device switch on a quiet
    /// Mac reporting an error for an engine that had no taps to rebuild.
    #[test]
    fn following_the_output_device_does_nothing_without_taps() {
        let engine = TapEngine::default();

        engine
            .follow_default_output()
            .expect("an engine with no taps has nothing to move");
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

    /// Peak is post-gain: the meter shows what is leaving for the device, which is what the user
    /// can hear. Reported pre-gain, a slider pulled to zero left a bar bouncing beside the control
    /// that had just stopped the sound.
    ///
    /// The app's own level is still observed — it is what decides whether Somul has heard the app
    /// at all — it just is not what the bar draws. See [`SessionControl::observe`].
    #[test]
    fn reports_the_peak_after_gain_is_applied() {
        let input = Buffers::new(2, 4, 0.8);
        let output = Buffers::new(2, 4, 0.0);
        let controls = vec![control(0.1, false)];

        unsafe { mix(&input.view(), &output.view(), 4, 4, &controls, false) };

        assert!((controls[0].take_peak() - 0.08).abs() < 1e-6);
    }

    /// A probing tap is passthrough: this callback writes silence and the hardware plays the app
    /// itself, so the gain reaches nobody and the audible level is the app's own.
    #[test]
    fn reports_the_apps_own_level_while_probing() {
        let input = Buffers::new(2, 4, 0.8);
        let output = Buffers::new(2, 4, 0.0);
        let controls = vec![control(0.1, false)];

        unsafe { mix(&input.view(), &output.view(), 4, 4, &controls, true) };

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

/// Hardware spike for per-app output routing.
///
/// Routing rests on one assumption nothing in the shipping engine exercises: that **two private
/// aggregate devices can run at once**, each clocked from a different output, each with its own IO
/// proc. The engine builds exactly one, and `EngineState::output` is a single field threaded
/// through `build`, `retarget`, and `follow_default_output` — so restructuring it for routing and
/// only then discovering the HAL refuses the arrangement would waste the whole effort.
///
/// Ignored by default: it needs two real output devices and it starts real audio hardware.
///
/// ```sh
/// cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture two_aggregates
/// ```
#[cfg(test)]
mod routing_spike {
    use super::*;

    struct Counter {
        cycles: AtomicU64,
    }

    unsafe extern "C" fn counting_callback(
        _device: AudioObjectID,
        _now: *const AudioTimeStamp,
        _input: *const AudioBufferList,
        _input_time: *const AudioTimeStamp,
        _output: *mut AudioBufferList,
        _output_time: *const AudioTimeStamp,
        client_data: *mut c_void,
    ) -> OSStatus {
        if !client_data.is_null() {
            // SAFETY: the box outlives the IO proc — the test stops the device before dropping it.
            let counter = unsafe { &*client_data.cast::<Counter>() };
            counter.cycles.fetch_add(1, Ordering::Relaxed);
        }

        0
    }

    struct RunningAggregate {
        device: AudioObjectID,
        io_proc: AudioDeviceIOProcID,
        counter: Box<Counter>,
    }

    impl RunningAggregate {
        fn start(output_uid: &str) -> Result<Self, AudioError> {
            let device = create_aggregate(output_uid, &[])?;
            let counter = Box::new(Counter {
                cycles: AtomicU64::new(0),
            });

            let mut io_proc: AudioDeviceIOProcID = None;
            // SAFETY: `counter` is boxed and owned here, and the device is stopped before it drops.
            let status = unsafe {
                AudioDeviceCreateIOProcID(
                    device,
                    Some(counting_callback),
                    std::ptr::from_ref(counter.as_ref())
                        .cast_mut()
                        .cast::<c_void>(),
                    &mut io_proc,
                )
            };
            check(status, "installing the spike IO proc")?;

            // SAFETY: the IO proc was just created against this device.
            check(unsafe { AudioDeviceStart(device, io_proc) }, "starting the spike")?;

            Ok(Self {
                device,
                io_proc,
                counter,
            })
        }

        fn cycles(&self) -> u64 {
            self.counter.cycles.load(Ordering::Relaxed)
        }
    }

    impl Drop for RunningAggregate {
        fn drop(&mut self) {
            // SAFETY: both ids came from this aggregate and are stopped before it is destroyed.
            unsafe {
                AudioDeviceStop(self.device, self.io_proc);
                AudioDeviceDestroyIOProcID(self.device, self.io_proc);
                AudioHardwareDestroyAggregateDevice(self.device);
            }
        }
    }

    /// Whether a pinned app and the followers can share a device without sharing an aggregate.
    ///
    /// Grouping by device alone merges them whenever the default lands on the pinned device, and
    /// the merge restarts the pinned app's aggregate -- the one gap routing was meant to spare it.
    /// Separate aggregates on one device avoid that, if the HAL allows the arrangement.
    #[test]
    #[ignore = "needs a real output device and starts audio hardware"]
    fn two_aggregates_run_at_once_on_the_same_output() {
        let output = super::super::default_output_device().expect("a default output");
        let uid = device_uid(output).expect("its uid");

        println!("output: {uid}");

        let first = RunningAggregate::start(&uid).expect("first aggregate refused to start");
        let second = RunningAggregate::start(&uid).expect("second aggregate refused to start");

        thread::sleep(Duration::from_millis(400));

        println!("first cycles:  {}", first.cycles());
        println!("second cycles: {}", second.cycles());

        assert!(first.cycles() > 0, "the first aggregate never rendered");
        assert!(
            second.cycles() > 0,
            "a second aggregate on the same output never rendered -- pinned apps and followers \
             cannot be kept apart on one device"
        );
    }

    #[test]
    #[ignore = "needs two real output devices and starts audio hardware"]
    fn two_aggregates_run_at_once_on_different_outputs() {
        let outputs: Vec<(AudioObjectID, String)> = super::super::output_device_ids()
            .expect("listing output devices")
            .into_iter()
            .filter_map(|device| device_uid(device).ok().map(|uid| (device, uid)))
            .filter(|(device, _)| super::super::has_output_streams(*device))
            .collect();

        assert!(
            outputs.len() >= 2,
            "the spike needs two output devices, found {}",
            outputs.len()
        );

        let (_, first_uid) = &outputs[0];
        let (_, second_uid) = &outputs[1];

        println!("first:  {first_uid}");
        println!("second: {second_uid}");

        let first = RunningAggregate::start(first_uid).expect("first aggregate refused to start");
        let second =
            RunningAggregate::start(second_uid).expect("second aggregate refused to start");

        thread::sleep(Duration::from_millis(400));

        let first_cycles = first.cycles();
        let second_cycles = second.cycles();

        println!("first cycles:  {first_cycles}");
        println!("second cycles: {second_cycles}");

        assert!(
            first_cycles > 0,
            "the first aggregate was created and started but never rendered a cycle"
        );
        assert!(
            second_cycles > 0,
            "a second aggregate on another output never rendered a cycle -- per-app routing \
             cannot be built as one aggregate per destination"
        );
    }
}
