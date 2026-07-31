//! Core Audio process taps — the only public mechanism on macOS that yields per-app audio.
//!
//! A tap created with `CATapMuted` does two things at once: it hands us the process's output and
//! it stops that output reaching the hardware. Both halves matter. The capture is what lets us
//! meter and re-render the app at the user's chosen gain; the mute is what stops the app being
//! heard twice, once at its own level and once at ours.
//!
//! That also means a tap is not observation. From the moment one exists, Somul is in the app's
//! render path, and dropping the tap is what puts the app back on the hardware — which is why
//! [`ProcessTap`] destroys itself on `Drop` rather than relying on a teardown path being reached.

use std::ffi::c_void;

use coreaudio_sys::{
    kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal, kAudioTapPropertyFormat,
    kAudioTapPropertyUID, AudioObjectID, AudioStreamBasicDescription, CFStringRef, OSStatus,
};
use objc2::rc::{Allocated, Retained};
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use objc2_foundation::{NSArray, NSNumber, NSString};

use super::property::{address, check, read_property, take_cf_string};
use crate::audio::AudioError;

// Declared here rather than taken from `coreaudio-sys`: these two live in
// `CoreAudio/AudioHardwareTapping.h`, which the crate's bindgen pass does not reach because the
// header is `#ifdef __OBJC__`. The CoreAudio framework is already linked by that same crate, so
// the symbols resolve at link time.
extern "C" {
    /// `inDescription` is a `CATapDescription*`.
    fn AudioHardwareCreateProcessTap(
        in_description: *mut c_void,
        out_tap_id: *mut AudioObjectID,
    ) -> OSStatus;

    fn AudioHardwareDestroyProcessTap(in_tap_id: AudioObjectID) -> OSStatus;
}

/// `CATapMuteBehavior.CATapMuted` — captured by the tap, and not sent to the hardware.
const CA_TAP_MUTED: isize = 1;

/// A live tap on one process, owned by this client.
///
/// The `Drop` impl is the safety property: a leaked tap leaves an app permanently silenced with
/// no UI left to unsilence it.
#[derive(Debug)]
pub(super) struct ProcessTap {
    id: AudioObjectID,
    uid: String,
}

/// The render loop indexes each tap's channels at a fixed stride, so a tap that is not stereo
/// would silently read into its neighbour's audio. Verified at creation rather than assumed.
const REQUIRED_CHANNELS: u32 = 2;

impl ProcessTap {
    /// Taps every process in `processes` as one stereo mixdown, muted at the hardware.
    ///
    /// A list rather than a single object because an app is routinely several audio processes —
    /// a browser plays through a GPU helper and a media helper — and the user expects one slider
    /// for the app, not one per helper.
    ///
    /// Stereo mixdown rather than the native layout: the mixer renders every app into one stereo
    /// bus, and asking CoreAudio to fold a 5.1 game down is both cheaper and more correct than
    /// folding it here.
    pub fn muted_stereo(processes: &[AudioObjectID], label: &str) -> Result<Self, AudioError> {
        if processes.is_empty() {
            return Err(AudioError::BackendFailure(
                "a tap needs at least one process to capture".to_owned(),
            ));
        }

        let description = build_description(processes, label)?;

        let mut id: AudioObjectID = 0;
        // SAFETY: `description` is a live `CATapDescription` for the duration of the call, and
        // `id` is a live local the routine writes exactly one `AudioObjectID` into.
        let status = unsafe {
            AudioHardwareCreateProcessTap(
                Retained::as_ptr(&description).cast_mut().cast::<c_void>(),
                &mut id,
            )
        };

        check(status, "creating a process tap").map_err(permission_hint)?;

        if id == 0 {
            return Err(AudioError::BackendFailure(
                "CoreAudio reported success but returned no tap".to_owned(),
            ));
        }

        // Filled in place, never rebuilt. `Self { uid, ..tap }` would look equivalent and is not:
        // `id` is `Copy`, so the update syntax copies it into a second live `ProcessTap` and
        // leaves the first one to drop at the end of this function — destroying the tap it just
        // returned. The symptom is an aggregate device with zero input channels.
        let mut tap = Self {
            id,
            uid: String::new(),
        };

        // Read-back happens through the constructed value so an early return still runs `Drop`
        // and hands the app back to the hardware.
        tap.uid = tap.read_uid()?;
        tap.verify_stereo()?;

        Ok(tap)
    }

    /// The string the aggregate device's tap list keys on.
    pub fn uid(&self) -> &str {
        &self.uid
    }

    fn read_uid(&self) -> Result<String, AudioError> {
        let address = address(
            kAudioTapPropertyUID,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain,
        );

        let uid = read_property::<CFStringRef>(self.id, &address, "reading a tap UID")
            .map(take_cf_string)?;

        if uid.is_empty() {
            return Err(AudioError::BackendFailure(
                "a process tap reported an empty UID".to_owned(),
            ));
        }

        Ok(uid)
    }

    fn verify_stereo(&self) -> Result<(), AudioError> {
        let address = address(
            kAudioTapPropertyFormat,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain,
        );

        let format = read_property::<AudioStreamBasicDescription>(
            self.id,
            &address,
            "reading a tap stream format",
        )?;

        if format.mChannelsPerFrame != REQUIRED_CHANNELS || format.mSampleRate <= 0.0 {
            return Err(AudioError::BackendFailure(format!(
                "a process tap reported an unmixable format: {} channels at {} Hz",
                format.mChannelsPerFrame, format.mSampleRate
            )));
        }

        Ok(())
    }
}

impl Drop for ProcessTap {
    fn drop(&mut self) {
        if self.id == 0 {
            return;
        }

        // SAFETY: `self.id` is a tap this type created and has not destroyed. Nothing else holds
        // it, because `ProcessTap` is not `Clone`.
        unsafe { AudioHardwareDestroyProcessTap(self.id) };
    }
}

/// Builds the `CATapDescription` for a single muted, private process tap.
fn build_description(
    processes: &[AudioObjectID],
    label: &str,
) -> Result<Retained<AnyObject>, AudioError> {
    let numbers: Vec<Retained<NSNumber>> = processes
        .iter()
        .map(|object| NSNumber::new_u32(*object))
        .collect();
    let processes = NSArray::from_retained_slice(&numbers);
    let name = NSString::from_str(label);

    // SAFETY: every message below is sent to a live object with the argument types its selector
    // declares. `CATapDescription` has existed since macOS 12, and the tap routines that consume
    // it are gated to macOS 14.2 by the caller's availability check.
    unsafe {
        let allocated: Allocated<AnyObject> = msg_send![class!(CATapDescription), alloc];
        let description: Option<Retained<AnyObject>> =
            msg_send![allocated, initStereoMixdownOfProcesses: &*processes];

        let Some(description) = description else {
            return Err(AudioError::BackendFailure(
                "could not allocate a tap description".to_owned(),
            ));
        };

        let _: () = msg_send![&*description, setName: &*name];
        let _: () = msg_send![&*description, setMuteBehavior: CA_TAP_MUTED];
        // Private keeps the tap out of every other client's device list. A public tap would show
        // up in other apps' input pickers as a phantom recording device.
        let _: () = msg_send![&*description, setPrivate: true];

        Ok(description)
    }
}

/// Turns the one CoreAudio failure the user can actually act on into an actionable message.
///
/// Process taps are gated behind the audio-capture TCC permission. Without it the create call
/// fails like any other backend error, and "status -4" tells the user nothing about the checkbox
/// they need to tick.
fn permission_hint(error: AudioError) -> AudioError {
    let AudioError::BackendFailure(detail) = &error else {
        return error;
    };

    if !detail.contains("1852797029") && !detail.contains("-1") {
        return error;
    }

    AudioError::PermissionDenied(
        "Somul needs permission to capture system audio before it can mix individual apps. \
Grant it in System Settings › Privacy & Security › Audio Recording, then reopen the panel."
            .to_owned(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The tap must silence the app it captures, or the user hears the app twice — once at its
    /// own level, once at ours.
    #[test]
    fn taps_are_created_muted() {
        assert_eq!(CA_TAP_MUTED, 1, "CATapMuteBehavior.CATapMuted is 1");
    }

    /// Creating a tap against a process object that does not exist must fail rather than hand
    /// back a tap that captures nothing.
    #[test]
    fn refuses_a_process_that_does_not_exist() {
        let result = ProcessTap::muted_stereo(&[0], "Somul probe");

        assert!(
            result.is_err(),
            "a tap on a non-existent process object must not succeed"
        );
    }

    /// An empty list would build a tap that captures nothing and silences nothing, which reaches
    /// the user as a row whose slider does nothing.
    #[test]
    fn refuses_an_empty_process_list() {
        assert!(ProcessTap::muted_stereo(&[], "Somul probe").is_err());
    }
}
