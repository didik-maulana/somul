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
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

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
use super::tap::ProcessTap;
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
}

impl SessionControl {
    fn new(gain: f32, is_muted: bool) -> Self {
        Self {
            gain: AtomicU32::new(gain.to_bits()),
            is_muted: AtomicBool::new(is_muted),
            peak: AtomicU32::new(0.0_f32.to_bits()),
        }
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
    fn observe(&self, peak: f32) {
        if f32::from_bits(self.peak.load(Ordering::Relaxed)) < peak {
            self.peak.store(peak.to_bits(), Ordering::Relaxed);
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
    /// Survives a rebuild. An app that is muted while another app opens or quits must come back
    /// muted rather than at full volume, and that rebuild is not something the user did.
    remembered: Vec<(String, f32, bool)>,
}

/// The engine as the backend sees it.
#[derive(Default)]
pub(super) struct TapEngine {
    state: Mutex<EngineState>,
    has_synced: AtomicBool,
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

        if processes.is_empty() {
            return Ok(());
        }

        state.build(processes)
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
            );

            match self
                .remembered
                .iter_mut()
                .find(|(key, _, _)| *key == entry.0)
            {
                Some(existing) => *existing = entry,
                None => self.remembered.push(entry),
            }
        }
    }

    fn recall(&self, key: &str) -> (f32, bool) {
        self.remembered
            .iter()
            .find(|(remembered, _, _)| remembered == key)
            .map(|(_, gain, is_muted)| (*gain, *is_muted))
            .unwrap_or((1.0, false))
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

    fn build(&mut self, processes: &[ProcessSession]) -> Result<(), AudioError> {
        let output = super::default_output_device()?;
        let output_uid = device_uid(output)?;

        let mut slots = Vec::with_capacity(processes.len());

        for process in processes {
            let key = process.identifier();
            let (gain, is_muted) = self.recall(&key);

            // One app failing to tap must not cost the others their mixer. A game that refuses
            // the tap simply keeps playing at its own level.
            let Ok(tap) = ProcessTap::muted_stereo(&process.objects, &process.display_name) else {
                continue;
            };

            slots.push(TapSlot {
                key,
                control: Arc::new(SessionControl::new(gain, is_muted)),
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

        self.aggregate = Some(aggregate);
        self.slots = slots;

        Ok(())
    }
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
    let output_frames = unsafe { Channels::frames(output.cast_const()) };
    let input_frames = unsafe { Channels::frames(input) };

    // SAFETY: both views were mapped from live buffer lists belonging to this IO cycle, and the
    // frame counts came from those same lists.
    unsafe { mix(&inputs, &outputs, input_frames, output_frames, &state.controls) };

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

                let target = unsafe { &mut *out_pointer.add(frame * out_stride) };
                *target = (*target + sample * gain).clamp(-1.0, 1.0);
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
        let control = SessionControl::new(1.0, false);

        assert_eq!(control.gain(), 1.0);
        assert!(!control.is_muted());
    }

    /// A quiet cycle after a loud one must not erase the loud one before the UI has read it.
    #[test]
    fn holds_the_loudest_level_between_two_reads() {
        let control = SessionControl::new(1.0, false);

        control.observe(0.6);
        control.observe(0.1);

        assert_eq!(control.take_peak(), 0.6);
    }

    /// Reading a peak clears it, so an app that stops producing audio decays to silence instead
    /// of holding its last level on screen forever.
    #[test]
    fn reading_a_peak_resets_it() {
        let control = SessionControl::new(1.0, false);

        control.peak.store(0.8_f32.to_bits(), Ordering::Relaxed);

        assert_eq!(control.take_peak(), 0.8);
        assert_eq!(control.take_peak(), 0.0);
    }

    #[test]
    fn gain_and_mute_round_trip_through_the_atomics() {
        let control = SessionControl::new(1.0, false);

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
        Arc::new(SessionControl::new(gain, is_muted))
    }

    #[test]
    fn applies_each_app_gain_to_its_own_channels() {
        let input = Buffers::new(2, 4, 0.5);
        let output = Buffers::new(2, 4, 0.0);
        let controls = vec![control(0.5, false)];

        unsafe { mix(&input.view(), &output.view(), 4, 4, &controls) };

        assert!(output.samples.iter().all(|sample| (*sample - 0.25).abs() < 1e-6));
    }

    /// Gain 1.0 must be transparent. A mixer that colours audio at unity is broken.
    #[test]
    fn passes_audio_through_untouched_at_unity() {
        let input = Buffers::new(2, 4, 0.3);
        let output = Buffers::new(2, 4, 0.0);
        let controls = vec![control(1.0, false)];

        unsafe { mix(&input.view(), &output.view(), 4, 4, &controls) };

        assert!(output.samples.iter().all(|sample| (*sample - 0.3).abs() < 1e-6));
    }

    #[test]
    fn a_muted_app_contributes_nothing() {
        let input = Buffers::new(2, 4, 0.9);
        let output = Buffers::new(2, 4, 0.0);
        let controls = vec![control(1.0, true)];

        unsafe { mix(&input.view(), &output.view(), 4, 4, &controls) };

        assert!(output.samples.iter().all(|sample| *sample == 0.0));
    }

    /// Two apps sum. The failure this catches is a mixer that plays only the last one.
    #[test]
    fn sums_two_apps_into_one_bus() {
        let input = Buffers::new(4, 2, 0.25);
        let output = Buffers::new(2, 2, 0.0);
        let controls = vec![control(1.0, false), control(1.0, false)];

        unsafe { mix(&input.view(), &output.view(), 2, 2, &controls) };

        assert!(output.samples.iter().all(|sample| (*sample - 0.5).abs() < 1e-6));
    }

    /// Summed apps can exceed full scale, and wrapping there is what turns a loud moment into a
    /// burst of noise.
    #[test]
    fn clamps_instead_of_wrapping_when_the_bus_overflows() {
        let input = Buffers::new(4, 2, 0.8);
        let output = Buffers::new(2, 2, 0.0);
        let controls = vec![control(1.0, false), control(1.0, false)];

        unsafe { mix(&input.view(), &output.view(), 2, 2, &controls) };

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

        unsafe { mix(&input.view(), &output.view(), 2, 8, &controls) };

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

        unsafe { mix(&input.view(), &output.view(), 0, 4, &controls) };

        assert!(output.samples.iter().all(|sample| *sample == 0.0));
    }

    /// Peak is pre-gain, so the meter shows what the app is producing rather than what the user
    /// turned it down to.
    #[test]
    fn reports_the_peak_before_gain_is_applied() {
        let input = Buffers::new(2, 4, 0.8);
        let output = Buffers::new(2, 4, 0.0);
        let controls = vec![control(0.1, false)];

        unsafe { mix(&input.view(), &output.view(), 4, 4, &controls) };

        assert!((controls[0].take_peak() - 0.8).abs() < 1e-6);
    }

    /// A mono output still has to carry both channels of every app.
    #[test]
    fn folds_into_a_mono_output_without_dropping_a_channel() {
        let input = Buffers::new(2, 2, 0.4);
        let output = Buffers::new(1, 2, 0.0);
        let controls = vec![control(1.0, false)];

        unsafe { mix(&input.view(), &output.view(), 2, 2, &controls) };

        assert!(output.samples.iter().all(|sample| (*sample - 0.8).abs() < 1e-6));
    }

    #[test]
    fn remembers_gain_and_mute_across_a_rebuild() {
        let mut state = EngineState::default();

        state.remembered.push(("macos:app:probe".to_owned(), 0.3, true));

        assert_eq!(state.recall("macos:app:probe"), (0.3, true));
        assert_eq!(state.recall("macos:app:unseen"), (1.0, false));
    }
}
