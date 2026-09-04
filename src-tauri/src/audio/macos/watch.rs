//! Change notification for the session list.
//!
//! CoreAudio will tell us when the list changes, so asking it on a timer is both late and
//! wasteful: a poll every second means an app that starts playing sits invisible for up to a
//! second, and every one of those polls walks parent chains for processes that did not move.
//!
//! Two properties carry everything the panel needs. The system object's process list changes when
//! an app becomes an audio client or stops being one; each process object's output-running flag
//! changes when that app starts or stops playing. A listener on both turns discovery from "ask
//! every tick" into "re-enumerate the moment something actually happened".
//!
//! The listeners are process-wide and never removed from the system object, which is why the flag
//! below is a `static` rather than state on the backend. That is the honest shape: CoreAudio
//! registrations outlive any Rust value we could hang them on, and a spurious "something changed"
//! costs one enumeration, while a missed one costs a row that never appears.

use std::collections::HashSet;
use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, Once};

use coreaudio_sys::{
    kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyDevices,
    kAudioHardwarePropertyProcessObjectList, kAudioObjectPropertyElementMain,
    kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject,
    kAudioProcessPropertyIsRunningOutput, AudioObjectAddPropertyListener, AudioObjectID,
    AudioObjectPropertyAddress, AudioObjectRemovePropertyListener, OSStatus, UInt32,
};

use super::property::address;

/// Set by CoreAudio's callback thread, cleared by whoever re-enumerates.
///
/// Starts `true` so the first read always enumerates: nothing has been observed yet, and treating
/// that as "unchanged" would leave the panel empty until an app happened to start playing.
static HAS_CHANGED: AtomicBool = AtomicBool::new(true);

/// Set when the set of devices changes, or when a different one becomes the default.
///
/// Separate from [`HAS_CHANGED`] because the two are consumed by different readers at different
/// rates: sessions are re-enumerated on the meter tick, devices only when the panel needs a list.
/// Starts `true` for the same reason: nothing has been observed yet.
static DEVICES_CHANGED: AtomicBool = AtomicBool::new(true);

/// The process objects currently carrying an output-running listener.
static WATCHED: Mutex<Option<HashSet<AudioObjectID>>> = Mutex::new(None);

fn device_list_address() -> AudioObjectPropertyAddress {
    address(
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    )
}

fn default_output_address() -> AudioObjectPropertyAddress {
    address(
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    )
}

fn process_list_address() -> AudioObjectPropertyAddress {
    address(
        kAudioHardwarePropertyProcessObjectList,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    )
}

fn running_output_address() -> AudioObjectPropertyAddress {
    address(
        kAudioProcessPropertyIsRunningOutput,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    )
}

/// Runs on a CoreAudio-owned thread, so it does the least possible: one relaxed store.
unsafe extern "C" fn on_change(
    _object: AudioObjectID,
    _count: UInt32,
    _addresses: *const AudioObjectPropertyAddress,
    _client_data: *mut c_void,
) -> OSStatus {
    HAS_CHANGED.store(true, Ordering::Relaxed);

    0
}

/// Runs on a CoreAudio-owned thread. Same contract as [`on_change`].
unsafe extern "C" fn on_device_change(
    _object: AudioObjectID,
    _count: UInt32,
    _addresses: *const AudioObjectPropertyAddress,
    _client_data: *mut c_void,
) -> OSStatus {
    DEVICES_CHANGED.store(true, Ordering::Relaxed);

    0
}

/// Whether the device list or the default output has changed since this was last asked.
///
/// Both are watched through one flag because both mean the same thing to the caller: the list the
/// panel is showing is out of date. A device appearing changes the set; macOS switching to it
/// changes which entry is marked default, and the panel is wrong in either case.
///
/// Installs its listeners on first call, so nothing has to remember to start it.
pub(super) fn take_device_change() -> bool {
    static DEVICE_LISTENERS: Once = Once::new();

    DEVICE_LISTENERS.call_once(|| {
        for address in [device_list_address(), default_output_address()] {
            // SAFETY: the address is read during the call and copied by CoreAudio; the listener is
            // a plain function with no captured state, and the client data is deliberately null.
            unsafe {
                AudioObjectAddPropertyListener(
                    kAudioObjectSystemObject,
                    &address,
                    Some(on_device_change),
                    ptr::null_mut(),
                )
            };
        }
    });

    DEVICES_CHANGED.swap(false, Ordering::Relaxed)
}

/// Whether anything has changed since this was last asked, clearing the flag.
///
/// Over-reporting is safe and under-reporting is not, so the flag is cleared *before* the caller
/// enumerates. A change that lands mid-enumeration then sets it again and is picked up on the next
/// tick, where clearing afterwards would swallow it.
pub(super) fn take_change() -> bool {
    HAS_CHANGED.swap(false, Ordering::Relaxed)
}

/// Brings the per-object listeners in line with the process objects that exist right now.
///
/// The system-object listener covers objects appearing and disappearing; these cover an app that
/// already exists starting or stopping playback, which does not change the list at all.
pub(super) fn watch(objects: &[AudioObjectID]) {
    static SYSTEM_LISTENER: Once = Once::new();

    SYSTEM_LISTENER.call_once(|| {
        // SAFETY: the address is read during the call and copied by CoreAudio; the listener is a
        // plain function with no captured state, and the client data is deliberately null.
        unsafe {
            AudioObjectAddPropertyListener(
                kAudioObjectSystemObject,
                &process_list_address(),
                Some(on_change),
                ptr::null_mut(),
            )
        };
    });

    let mut guard = WATCHED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let watched = guard.get_or_insert_with(HashSet::new);
    let wanted: HashSet<AudioObjectID> = objects.iter().copied().collect();

    let added: Vec<AudioObjectID> = wanted.difference(watched).copied().collect();
    let removed: Vec<AudioObjectID> = watched.difference(&wanted).copied().collect();

    for object in added {
        // SAFETY: same contract as the system listener above, against a live process object.
        unsafe {
            AudioObjectAddPropertyListener(
                object,
                &running_output_address(),
                Some(on_change),
                ptr::null_mut(),
            )
        };
    }

    for object in removed {
        // A listener on an object CoreAudio has already destroyed fails harmlessly; leaving it
        // registered would not, because object IDs are reused.
        // SAFETY: the arguments match the registration exactly, which is what identifies it.
        unsafe {
            AudioObjectRemovePropertyListener(
                object,
                &running_output_address(),
                Some(on_change),
                ptr::null_mut(),
            )
        };
    }

    *watched = wanted;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Clearing is what stops one change being re-enumerated forever.
    #[test]
    fn a_change_is_reported_once() {
        HAS_CHANGED.store(true, Ordering::Relaxed);

        assert!(take_change());
        assert!(!take_change());
    }

    /// Registering against the live machine must not panic or leave the watch set inconsistent.
    #[test]
    fn tracks_the_objects_it_was_given() {
        let objects = super::super::process::audio_process_objects().unwrap_or_default();

        watch(&objects);

        let watched = WATCHED
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
            .unwrap_or_default();

        assert_eq!(watched, objects.iter().copied().collect::<HashSet<_>>());
    }
}
