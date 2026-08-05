//! CoreAudio adapter — master volume, per-app volume, mute, metering, and device selection.
//!
//! CoreAudio has no equivalent of Windows' `ISimpleAudioVolume`: no API sets another process's
//! volume. The per-app path is therefore not a setter at all. Each app is captured by a muted
//! process tap and re-rendered by [`engine`] at the gain the user picked, which means Somul is in
//! the render path for every app it controls.
//!
//! That has a consequence worth stating here rather than burying in [`engine`]: per-app control
//! is a capability this adapter *earns at runtime*, not one it has. It needs macOS 14.2 or later
//! and the audio-capture permission, and the user can revoke the second at any time. So
//! [`AudioBackend::capabilities`] reports what the engine actually managed to do, and falls back
//! to master-only with a reason the panel renders verbatim.
//!
//! The master path below predates all of this and is untouched by it: it drives the default
//! output device directly and works with no permission at all.

mod engine;
mod icon;
mod process;
mod property;
mod tap;
mod watch;

use std::ffi::c_void;
use std::mem;
use std::ptr;
use std::sync::Arc;

use coreaudio_sys::{
    kAudioDevicePropertyDeviceCanBeDefaultDevice, kAudioDevicePropertyDeviceNameCFString,
    kAudioDevicePropertyMute,
    kAudioDevicePropertyStreamConfiguration, kAudioDevicePropertyVolumeScalar,
    kAudioHardwareNoError, kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyDevices,
    kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyScopeOutput, kAudioObjectSystemObject, AudioBufferList, AudioDeviceID,
    AudioHardwareServiceGetPropertyData, AudioHardwareServiceHasProperty,
    AudioHardwareServiceSetPropertyData, AudioObjectGetPropertyData,
    AudioObjectGetPropertyDataSize, AudioObjectPropertyAddress, CFStringRef, OSStatus,
};
use coreaudio_sys::kAudioHardwareServiceDeviceProperty_VirtualMainVolume;

use self::property::{
    address, check, has_property, read_property, take_cf_string, write_property,
};
use super::{
    clamp_unit_scalar, AudioBackend, AudioDevice, AudioError, AudioSession, DeviceId, MasterState,
    PlatformCapabilities, SessionId, SessionPeak, SessionState,
};

/// Rendered verbatim by the UI when the tap engine cannot run.
///
/// Reached on a macOS older than the tap API, or when the user has withheld the audio-capture
/// permission the taps need. Both leave the panel with master control only, and the panel says so
/// rather than showing sliders that move nothing.
pub const UNSUPPORTED_REASON: &str = "Somul could not open the per-app audio taps macOS requires \
for individual app volume. Check that Somul is allowed to capture audio in System Settings › \
Privacy & Security, then reopen the panel.";

/// Shown when the taps are up and have heard nothing at all.
///
/// Describes what was observed rather than asserting a denial, because a user whose apps are
/// merely paused lands here too, and telling them their permission is broken would be a lie.
const WITHHELD_REASON: &str = "Somul has not heard any app audio yet. macOS only lets an app capture other apps' audio once you allow it, and per-app volume needs that access.";

const PER_APP_ROUTING_REASON: &str = "Per-app output routing is not available on macOS in v1.";

/// The macOS that introduced `AudioHardwareCreateProcessTap`. Below it there is no per-app path
/// at all, and the panel must say so instead of failing at the first tap.
const MINIMUM_TAP_VERSION: (u32, u32) = (14, 2);

/// The 1-based channel elements checked when the master element is not settable. Most output
/// devices expose no master volume element and require writing left and right separately.
const STEREO_ELEMENTS: [u32; 2] = [1, 2];

#[derive(Default)]
pub struct MacOsAudioBackend {
    engine: engine::TapEngine,
}

impl MacOsAudioBackend {
    pub fn new() -> Self {
        Self::default()
    }

    /// Discovery and tap-set maintenance in one step.
    ///
    /// The engine is synced here rather than on a timer because this is the only place the live
    /// process set is read. A tap set that drifts from the session list would show the user a row
    /// whose slider controls nothing.
    fn sessions(&self) -> Result<Vec<AudioSession>, AudioError> {
        let processes = process::playing_applications()?;

        self.engine.sync(&processes)?;

        // Rebuilding the taps belongs with the sync that owns them, not with the meter read.
        // macOS answers the capture question once per tap, so a permission granted after they
        // were created is only noticed by asking again - and one revoked since is only noticed by
        // the muted set going deaf.
        let _ = self.engine.reprobe_capture();
        let _ = self.engine.demote_if_deaf();

        let is_mixing = self.engine.is_mixing();

        // An app that holds an output stream open without ever playing through it is not a mixer
        // row: `IsRunningOutput` is true for anything with an open stream, which is how a dev tool
        // that opened an audio context at launch acquired a slider of its own.
        let has_heard_anything = self.engine.has_heard_anything();

        Ok(processes
            .iter()
            .filter(|found| !has_heard_anything || self.engine.is_audible(&found.identifier()))
            .map(|found| {
                let key = found.identifier();
                let control = self.engine.control(&key);

                AudioSession {
                    session_id: SessionId::from_backend_identifier(&key)
                        .unwrap_or_else(|_| unreachable!("process keys are namespaced")),
                    pid: found.pid as u32,
                    display_name: found.display_name.clone(),
                    process_name: found.bundle_id.clone(),
                    icon_data_uri: icon::icon_data_uri(found.pid, &found.bundle_id),
                    volume: control.as_ref().map_or(1.0, |control| control.gain()),
                    is_muted: control.as_ref().is_some_and(|control| control.is_muted()),
                    output_device_id: None,
                    // An open app that we failed to tap is present but not controllable, which is
                    // exactly what `Inactive` means. So is one whose tap is still passthrough:
                    // the tap carries no gain until it is muted, and a slider over it would move
                    // nothing.
                    state: if control.is_some() && is_mixing {
                        SessionState::Active
                    } else {
                        SessionState::Inactive
                    },
                }
            })
            .collect())
    }

    /// The knobs for one session, without touching CoreAudio.
    ///
    /// Deliberately does not refresh first. A drag debounces to a write every 50 ms, and
    /// refreshing here meant a full process enumeration — parent-chain walks and all — twenty
    /// times a second, any one of which could notice a helper appearing and tear down every tap
    /// to rebuild the aggregate. That rebuild is audible, and dragging a slider is the worst
    /// possible moment for it. The tap set is maintained by `list_sessions` instead.
    ///
    /// A session that never existed is still reported missing, because it was never in the
    /// engine's slots to begin with.
    fn control_for(&self, id: &SessionId) -> Result<Arc<engine::SessionControl>, AudioError> {
        self.engine
            .control(id.as_str())
            .ok_or_else(|| AudioError::SessionNotFound(id.clone()))
    }
}

/// Whether this machine has the tap API at all.
fn supports_process_taps() -> bool {
    let version = std::process::Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok());

    let Some(version) = version else {
        // Unreadable version means an unusual host, not necessarily an old one. Trying the tap
        // and reporting its real failure beats refusing on a guess.
        return true;
    };

    let mut parts = version.trim().split('.');
    let major: u32 = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
    let minor: u32 = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);

    (major, minor) >= MINIMUM_TAP_VERSION
}

fn default_output_device() -> Result<AudioDeviceID, AudioError> {
    let address = address(
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    );

    read_property::<AudioDeviceID>(
        kAudioObjectSystemObject,
        &address,
        "reading the default output device",
    )
}

fn device_name(device: AudioDeviceID) -> String {
    let address = address(
        kAudioDevicePropertyDeviceNameCFString,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    );

    read_property::<CFStringRef>(device, &address, "reading a device name")
        .map(take_cf_string)
        .unwrap_or_default()
}

/// A device with no output stream channels is an input — the panel must not offer it as an
/// output destination.
fn has_output_streams(device: AudioDeviceID) -> bool {
    let address = address(
        kAudioDevicePropertyStreamConfiguration,
        kAudioObjectPropertyScopeOutput,
        kAudioObjectPropertyElementMain,
    );

    let mut size = 0_u32;
    // SAFETY: `address` and `size` are live locals; the call only writes the byte count.
    let status = unsafe { AudioObjectGetPropertyDataSize(device, &address, 0, ptr::null(), &mut size) };

    if status != kAudioHardwareNoError as OSStatus || size == 0 {
        return false;
    }

    let mut raw = vec![0_u8; size as usize];
    // SAFETY: `raw` has exactly `size` bytes, which is what the size query above reported.
    let status = unsafe {
        AudioObjectGetPropertyData(
            device,
            &address,
            0,
            ptr::null(),
            &mut size,
            raw.as_mut_ptr().cast::<c_void>(),
        )
    };

    if status != kAudioHardwareNoError as OSStatus {
        return false;
    }

    // SAFETY: CoreAudio filled `raw` with an AudioBufferList; the header is present because the
    // reported size was non-zero and the read succeeded.
    let list = unsafe { &*raw.as_ptr().cast::<AudioBufferList>() };

    list.mNumberBuffers > 0
}

/// Whether the OS will actually adopt this device as the system output.
///
/// Some virtual devices publish output streams but refuse to become the default — Microsoft
/// Teams and Zoom both install one. Listing them offers the user a choice that silently does
/// nothing when picked.
///
/// A device whose eligibility cannot be read is kept. Failing open means an unusual but working
/// device stays selectable; failing closed could hide the user's only speakers.
fn can_be_default_output(device: AudioDeviceID) -> bool {
    let address = address(
        kAudioDevicePropertyDeviceCanBeDefaultDevice,
        kAudioObjectPropertyScopeOutput,
        kAudioObjectPropertyElementMain,
    );

    read_property::<u32>(device, &address, "reading default-output eligibility")
        .map(|is_eligible| is_eligible != 0)
        .unwrap_or(true)
}

fn output_device_ids() -> Result<Vec<AudioDeviceID>, AudioError> {
    let address = address(
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    );

    let mut size = 0_u32;
    // SAFETY: both out-params are live locals.
    let status = unsafe {
        AudioObjectGetPropertyDataSize(
            kAudioObjectSystemObject,
            &address,
            0,
            ptr::null(),
            &mut size,
        )
    };
    check(status, "sizing the device list")?;

    let count = size as usize / mem::size_of::<AudioDeviceID>();
    let mut devices = vec![0 as AudioDeviceID; count];

    if count == 0 {
        return Ok(devices);
    }

    // SAFETY: `devices` holds exactly `count` ids, which is the element count the size query
    // reported, so CoreAudio writes within the allocation.
    let status = unsafe {
        AudioObjectGetPropertyData(
            kAudioObjectSystemObject,
            &address,
            0,
            ptr::null(),
            &mut size,
            devices.as_mut_ptr().cast::<c_void>(),
        )
    };
    check(status, "reading the device list")?;

    Ok(devices
        .into_iter()
        .filter(|id| has_output_streams(*id) && can_be_default_output(*id))
        .collect())
}

/// Most output devices expose no settable master element, so the master element is tried first
/// and the stereo pair is the fallback. Returning the average keeps the reported value stable
/// when the two channels are balanced, which they are unless the user split them elsewhere.
/// Whether the device exposes any writable software volume.
fn has_software_volume(device: AudioDeviceID) -> bool {
    let master = address(
        kAudioDevicePropertyVolumeScalar,
        kAudioObjectPropertyScopeOutput,
        kAudioObjectPropertyElementMain,
    );

    if has_property(device, &master) {
        return true;
    }

    let has_channel = STEREO_ELEMENTS.iter().any(|element| {
        has_property(
            device,
            &address(
                kAudioDevicePropertyVolumeScalar,
                kAudioObjectPropertyScopeOutput,
                *element,
            ),
        )
    });

    has_channel || has_virtual_main_volume(device)
}

fn read_volume(device: AudioDeviceID) -> Result<f32, AudioError> {
    let master = address(
        kAudioDevicePropertyVolumeScalar,
        kAudioObjectPropertyScopeOutput,
        kAudioObjectPropertyElementMain,
    );

    if has_property(device, &master) {
        return read_property::<f32>(device, &master, "reading the master volume")
            .map(clamp_unit_scalar);
    }

    let mut total = 0.0_f32;
    let mut found = 0_u32;

    for element in STEREO_ELEMENTS {
        let channel = address(
            kAudioDevicePropertyVolumeScalar,
            kAudioObjectPropertyScopeOutput,
            element,
        );

        if !has_property(device, &channel) {
            continue;
        }

        total += read_property::<f32>(device, &channel, "reading a channel volume")?;
        found += 1;
    }

    if found == 0 {
        // No per-channel scalar either. The HAL's virtual main volume is what the menu-bar
        // slider shows, and it exists for devices whose gain lives in hardware.
        if has_virtual_main_volume(device) {
            return read_virtual_main_volume(device);
        }

        // Genuinely no software volume anywhere. Nothing is attenuating the signal, so unity is
        // the honest reading; the matching write still refuses rather than pretending.
        return Ok(1.0);
    }

    Ok(clamp_unit_scalar(total / found as f32))
}

fn write_volume(device: AudioDeviceID, volume: f32) -> Result<(), AudioError> {
    let clamped = clamp_unit_scalar(volume);
    let master = address(
        kAudioDevicePropertyVolumeScalar,
        kAudioObjectPropertyScopeOutput,
        kAudioObjectPropertyElementMain,
    );

    if has_property(device, &master) {
        return write_property(device, &master, &clamped, "setting the master volume");
    }

    let mut written = 0_u32;

    for element in STEREO_ELEMENTS {
        let channel = address(
            kAudioDevicePropertyVolumeScalar,
            kAudioObjectPropertyScopeOutput,
            element,
        );

        if !has_property(device, &channel) {
            continue;
        }

        write_property(device, &channel, &clamped, "setting a channel volume")?;
        written += 1;
    }

    if written == 0 {
        if has_virtual_main_volume(device) {
            return write_virtual_main_volume(device, clamped);
        }

        return Err(AudioError::Unsupported(
            "this output device exposes no software volume control".to_owned(),
        ));
    }

    Ok(())
}

/// The property behind the macOS menu-bar volume slider.
///
/// A device that carries its gain in hardware — an aggregate, most HDMI outputs, many USB DACs —
/// exposes no `kAudioDevicePropertyVolumeScalar`, but the HAL still publishes a virtual main
/// volume for it. Reading the raw device property alone is what made Somul report 100% on those
/// devices instead of the level the user could see in the menu bar.
fn virtual_main_volume_address() -> AudioObjectPropertyAddress {
    address(
        kAudioHardwareServiceDeviceProperty_VirtualMainVolume,
        kAudioObjectPropertyScopeOutput,
        kAudioObjectPropertyElementMain,
    )
}

fn has_virtual_main_volume(device: AudioDeviceID) -> bool {
    let address = virtual_main_volume_address();

    // SAFETY: `address` points at a live local for the duration of the call, which only reads it.
    unsafe { AudioHardwareServiceHasProperty(device, &address) != 0 }
}

fn read_virtual_main_volume(device: AudioDeviceID) -> Result<f32, AudioError> {
    let address = virtual_main_volume_address();
    let mut value = 0.0_f32;
    let mut size = mem::size_of::<f32>() as u32;

    // SAFETY: the call writes exactly `size` bytes, and `size` is the size of the `f32` local
    // being pointed at.
    let status = unsafe {
        AudioHardwareServiceGetPropertyData(
            device,
            &address,
            0,
            ptr::null(),
            &mut size,
            ptr::from_mut(&mut value).cast::<c_void>(),
        )
    };

    check(status, "reading the virtual main volume")?;

    Ok(clamp_unit_scalar(value))
}

fn write_virtual_main_volume(device: AudioDeviceID, volume: f32) -> Result<(), AudioError> {
    let address = virtual_main_volume_address();
    let clamped = clamp_unit_scalar(volume);

    // SAFETY: the call reads exactly `size_of::<f32>()` bytes from a live local of that type.
    let status = unsafe {
        AudioHardwareServiceSetPropertyData(
            device,
            &address,
            0,
            ptr::null(),
            mem::size_of::<f32>() as u32,
            ptr::from_ref(&clamped).cast::<c_void>(),
        )
    };

    check(status, "setting the virtual main volume")
}

fn mute_address() -> AudioObjectPropertyAddress {
    address(
        kAudioDevicePropertyMute,
        kAudioObjectPropertyScopeOutput,
        kAudioObjectPropertyElementMain,
    )
}

impl AudioBackend for MacOsAudioBackend {
    /// Capability is claimed only once a tap has actually opened on this machine.
    ///
    /// The version check alone would not do. Both the OS version and the audio-capture
    /// permission have to hold, and the permission is a user decision that can change while
    /// Somul runs — so the honest test is whether the engine currently has taps, not whether the
    /// API exists.
    fn capabilities(&self) -> PlatformCapabilities {
        if !supports_process_taps() {
            return PlatformCapabilities::master_only(format!(
                "Per-app volume needs macOS {}.{} or later. Somul controls the system output \
instead.",
                MINIMUM_TAP_VERSION.0, MINIMUM_TAP_VERSION.1
            ));
        }

        // Answered from the last sync rather than a fresh enumeration. The meter loop asks this
        // every tick so it can notice the answer changing, and enumerating here would double the
        // per-tick CoreAudio work to re-derive something the engine already knows.
        if !self.engine.has_processes() {
            // No app with audio is open, so nothing is tapped, and there is no evidence either
            // way. The capable answer is right: the empty state that follows says no apps are
            // open, which is true, where the unsupported notice would be a false accusation.
            return PlatformCapabilities::full_per_app();
        }

        // Tapped, and silent for long enough that the permission is the likely reason. The panel
        // trades the list for the one action that fixes it: rows the user cannot control are
        // worse than no rows, because each one looks like a bug of its own.
        if self.engine.is_capture_withheld() {
            return PlatformCapabilities::awaiting_audio_permission(
                WITHHELD_REASON,
                self.engine.has_exhausted_capture_retries(),
            );
        }

        // A tap that exists is the evidence, not a tap that is already carrying gain. Taps start
        // out listening and are promoted once they have heard their app, so judging on a live
        // session alone would report the platform as incapable for the first few frames of every
        // session and then change its mind.
        if self.engine.has_taps() {
            return PlatformCapabilities::full_per_app();
        }

        // Apps are open and not one of them could be tapped. That is the permission being
        // withheld, and the panel must explain it rather than list dead sliders.
        PlatformCapabilities::master_only(UNSUPPORTED_REASON)
    }

    fn list_sessions(&self) -> Result<Vec<AudioSession>, AudioError> {
        self.sessions()
    }

    /// Answered by CoreAudio's own property listeners rather than by a timer.
    fn sessions_may_have_changed(&self) -> Option<bool> {
        Some(watch::take_change())
    }

    fn set_session_volume(&self, id: &SessionId, volume: f32) -> Result<(), AudioError> {
        self.control_for(id)?.set_gain(clamp_unit_scalar(volume));

        Ok(())
    }

    fn set_session_mute(&self, id: &SessionId, is_muted: bool) -> Result<(), AudioError> {
        self.control_for(id)?.set_muted(is_muted);

        Ok(())
    }

    fn master(&self) -> Result<MasterState, AudioError> {
        let device = default_output_device()?;
        let is_muted = read_property::<u32>(device, &mute_address(), "reading the master mute")
            .map(|raw| raw != 0)
            .unwrap_or(false);

        Ok(MasterState {
            device_id: DeviceId::new(device.to_string()),
            device_name: device_name(device),
            volume: read_volume(device)?,
            is_muted,
            is_volume_controllable: has_software_volume(device),
        })
    }

    fn set_master_volume(&self, volume: f32) -> Result<(), AudioError> {
        write_volume(default_output_device()?, volume)
    }

    fn set_master_mute(&self, is_muted: bool) -> Result<(), AudioError> {
        let device = default_output_device()?;
        let address = mute_address();

        if !has_property(device, &address) {
            return Err(AudioError::Unsupported(
                "this output device exposes no software mute control".to_owned(),
            ));
        }

        write_property(device, &address, &u32::from(is_muted), "setting the master mute")
    }

    fn list_output_devices(&self) -> Result<Vec<AudioDevice>, AudioError> {
        let default = default_output_device()?;

        Ok(output_device_ids()?
            .into_iter()
            .map(|device| AudioDevice {
                device_id: DeviceId::new(device.to_string()),
                name: device_name(device),
                is_default: device == default,
                is_available: true,
            })
            .collect())
    }

    fn set_default_output_device(&self, device: &DeviceId) -> Result<(), AudioError> {
        let requested: AudioDeviceID = device
            .as_str()
            .parse()
            .map_err(|_| AudioError::DeviceNotFound(device.clone()))?;

        if !output_device_ids()?.contains(&requested) {
            return Err(AudioError::DeviceNotFound(device.clone()));
        }

        let address = address(
            kAudioHardwarePropertyDefaultOutputDevice,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain,
        );

        write_property(
            kAudioObjectSystemObject,
            &address,
            &requested,
            "setting the default output device",
        )?;

        // CoreAudio returns noErr for a device the HAL will not actually adopt as the system
        // output — several virtual and driver-provided devices behave this way. Reporting
        // success there would be a silent no-op — a control that reports working and does
        // nothing — so the write is read back.
        if default_output_device()? == requested {
            return Ok(());
        }

        Err(AudioError::BackendFailure(format!(
            "the system did not adopt {} as the default output device",
            device
        )))
    }

    fn set_session_output_device(
        &self,
        _id: &SessionId,
        _device: &DeviceId,
    ) -> Result<(), AudioError> {
        Err(AudioError::Unsupported(PER_APP_ROUTING_REASON.to_owned()))
    }

    /// There are no sessions on macOS in v1, so a tick carries no per-session peaks.
    ///
    /// A device-level master meter has no surface on this trait, which reports peaks keyed by
    /// session. Adding one would mean a new trait method and an output IOProc.
    /// Levels straight from the render callback.
    ///
    /// No enumeration and no tap work happens here. This runs at the meter rate, and the whole
    /// point of publishing peaks through atomics is that reading them costs an atomic swap per
    /// app rather than a trip through CoreAudio.
    fn read_peaks(&self) -> Result<Vec<SessionPeak>, AudioError> {
        // The one exception to "no enumeration here". A meter read that arrives before the first
        // session read has no tap set to report against, and reporting nothing would leave every
        // meter dead until the panel happened to refresh.
        if self.engine.is_cold() {
            let _ = self.sessions();
        }

        // Taps start out listening rather than muting, so this is where a tap that has proved it
        // can hear its app is promoted to one that carries the app's volume. Cheap in the steady
        // state: a load, and a rebuild only on the single transition.
        let _ = self.engine.promote_if_heard();

        // The same visibility rule the session list runs. A batch covering a row the panel does
        // not show would disagree with the list, and the contract pairs the two by key.
        let has_heard_anything = self.engine.has_heard_anything();

        Ok(self
            .engine
            .peaks()
            .into_iter()
            .filter(|(key, _)| !has_heard_anything || self.engine.is_audible(key))
            .filter_map(|(key, peak)| {
                Some(SessionPeak {
                    session_id: SessionId::from_backend_identifier(&key).ok()?,
                    peak: clamp_unit_scalar(peak),
                })
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    crate::audio_backend_contract!(coreaudio, MacOsAudioBackend::new());

    fn session_id() -> SessionId {
        SessionId::from_backend_identifier("coreaudio:session:probe")
            .unwrap_or_else(|_| unreachable!("the probe identifier is namespaced"))
    }

    /// Per-app control is claimed only when a tap actually opened. On a machine where the audio
    /// capture permission is withheld the answer flips back to master-only, and the reason is
    /// what the panel renders in place of the session list.
    #[test]
    fn claims_per_app_control_only_with_a_reason_when_it_cannot() {
        let capabilities = MacOsAudioBackend::new().capabilities();

        if capabilities.has_per_app_volume {
            assert!(capabilities.has_per_app_mute);
            assert!(capabilities.has_per_app_meter);
            assert!(
                capabilities.unsupported_reason.is_none(),
                "a capable backend must not also carry an excuse"
            );
        } else {
            let reason = capabilities
                .unsupported_reason
                .as_deref()
                .expect("a backend without per-app volume must explain why");

            assert!(!reason.trim().is_empty());
        }

        assert!(
            !capabilities.has_per_app_routing,
            "per-app routing is v1.1 on every platform"
        );
    }

    /// A write to a session that does not exist must say so. The UI drops the row on
    /// `SessionNotFound`, and it can only do that if the adapter distinguishes it from a
    /// generic failure.
    #[test]
    fn writes_to_an_unknown_session_report_it_missing() {
        let backend = MacOsAudioBackend::new();
        let id = session_id();

        if !backend.capabilities().has_per_app_volume {
            return;
        }

        assert!(matches!(
            backend.set_session_volume(&id, 0.5),
            Err(AudioError::SessionNotFound(_))
        ));
        assert!(matches!(
            backend.set_session_mute(&id, true),
            Err(AudioError::SessionNotFound(_))
        ));
    }

    /// Routing stays refused. Per-app volume arriving does not bring per-app output with it —
    /// a tap mixes into one bus, and that bus has a single destination.
    #[test]
    fn still_refuses_per_app_routing() {
        let backend = MacOsAudioBackend::new();

        assert!(matches!(
            backend.set_session_output_device(&session_id(), &DeviceId::new("1")),
            Err(AudioError::Unsupported(_))
        ));
    }

    /// Every session the backend lists must be controllable by the key it published, or the UI
    /// renders a row whose slider writes nowhere.
    #[test]
    fn every_listed_session_accepts_a_write_on_its_own_key() {
        let backend = MacOsAudioBackend::new();

        let Ok(sessions) = backend.list_sessions() else {
            return;
        };

        for session in sessions {
            if session.state != SessionState::Active {
                continue;
            }

            let restore = session.volume;

            assert!(
                backend.set_session_volume(&session.session_id, 0.5).is_ok(),
                "listed session {} refused a volume write",
                session.session_id
            );

            let _ = backend.set_session_volume(&session.session_id, restore);
        }
    }

    /// A meter read that lands before the panel has ever listed sessions must still report the
    /// live set. Returning nothing there would leave every meter dead until a refresh happened
    /// to occur.
    ///
    /// Counts are not compared against a second enumeration. Both reads look at the live process
    /// set, and a browser helper starting or stopping playback between them makes the two differ
    /// without the adapter having done anything wrong.
    #[test]
    fn a_cold_peak_read_still_covers_the_live_sessions() {
        let backend = MacOsAudioBackend::new();

        let peaks = backend
            .read_peaks()
            .expect("an empty batch is not a failure");

        let sessions = backend.list_sessions().expect("sessions after a cold read");

        if !sessions.is_empty() {
            assert!(
                !peaks.is_empty(),
                "a cold peak read must report the sessions the panel would list"
            );
        }

        for peak in peaks {
            assert!(
                (0.0..=1.0).contains(&peak.peak),
                "peak {} is outside 0.0–1.0",
                peak.peak
            );
        }
    }

    #[test]
    fn rejects_a_device_id_that_is_not_a_coreaudio_object() {
        let backend = MacOsAudioBackend::new();

        assert!(matches!(
            backend.set_default_output_device(&DeviceId::new("not-an-object-id")),
            Err(AudioError::DeviceNotFound(_))
        ));
    }

    #[test]
    fn enumerates_the_real_default_output_device() {
        let backend = MacOsAudioBackend::new();
        let devices = backend
            .list_output_devices()
            .expect("CoreAudio device enumeration");

        assert!(
            !devices.is_empty(),
            "a macOS host always has at least one output device"
        );
        assert_eq!(
            devices.iter().filter(|device| device.is_default).count(),
            1,
            "exactly one device is the default output"
        );
    }

    #[test]
    fn reads_real_master_state() {
        let master = MacOsAudioBackend::new()
            .master()
            .expect("CoreAudio master state");

        assert!((0.0..=1.0).contains(&master.volume));
        assert!(!master.device_name.is_empty());
    }
}
