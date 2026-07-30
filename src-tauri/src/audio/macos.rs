//! CoreAudio adapter — master volume, mute, and device selection.
//!
//! ARCHITECTURE.md §2.2: CoreAudio has no equivalent of `ISimpleAudioVolume`, so no API sets
//! another process's volume. Per-app control arrives in v1.2 through process taps, and §1.2
//! makes building them now a scope violation. Every per-app method here returns
//! [`AudioError::Unsupported`] carrying the reason the UI renders verbatim (§2.2.5).

use std::ffi::c_void;
use std::mem;
use std::ptr;

use coreaudio_sys::{
    kAudioDevicePropertyDeviceNameCFString, kAudioDevicePropertyMute,
    kAudioDevicePropertyStreamConfiguration, kAudioDevicePropertyVolumeScalar,
    kAudioHardwareNoError, kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyDevices,
    kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyScopeOutput, kAudioObjectSystemObject, AudioBufferList, AudioDeviceID,
    AudioObjectGetPropertyData, AudioObjectGetPropertyDataSize, AudioObjectHasProperty,
    AudioObjectID, AudioObjectPropertyAddress, AudioObjectSetPropertyData, CFRelease,
    CFStringGetCString, CFStringRef, OSStatus,
};

use super::{
    clamp_unit_scalar, AudioBackend, AudioDevice, AudioError, AudioSession, DeviceId, MasterState,
    PlatformCapabilities, SessionId, SessionPeak,
};

/// Rendered verbatim in the macOS empty state (§2.2.5).
pub const UNSUPPORTED_REASON: &str = "macOS does not expose per-app volume control. \
SOMUL controls the system output instead; per-app mixing arrives in v1.2 on macOS 14.4+.";

const PER_APP_ROUTING_REASON: &str = "Per-app output routing is not available on macOS in v1.";

/// The 1-based channel elements checked when the master element is not settable. Most output
/// devices expose no master volume element and require writing left and right separately.
const STEREO_ELEMENTS: [u32; 2] = [1, 2];

pub struct MacOsAudioBackend;

impl MacOsAudioBackend {
    pub fn new() -> Self {
        Self
    }
}

impl Default for MacOsAudioBackend {
    fn default() -> Self {
        Self::new()
    }
}

fn address(selector: u32, scope: u32, element: u32) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: scope,
        mElement: element,
    }
}

fn check(status: OSStatus, context: &str) -> Result<(), AudioError> {
    if status == kAudioHardwareNoError as OSStatus {
        return Ok(());
    }

    Err(AudioError::BackendFailure(format!(
        "{context} failed with CoreAudio status {status}"
    )))
}

/// SAFETY (shared by every accessor below): `AudioObjectGetPropertyData` writes exactly
/// `size` bytes into `out`. Each caller passes `size_of::<T>()` for the `T` it declared and a
/// pointer to a live local of that type, so the write stays inside the allocation. `address` is
/// read-only and outlives the call.
fn read_property<T>(
    object: AudioObjectID,
    address: &AudioObjectPropertyAddress,
    context: &str,
) -> Result<T, AudioError> {
    let mut value = mem::MaybeUninit::<T>::uninit();
    let mut size = mem::size_of::<T>() as u32;

    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            address,
            0,
            ptr::null(),
            &mut size,
            value.as_mut_ptr().cast::<c_void>(),
        )
    };

    check(status, context)?;

    if size as usize != mem::size_of::<T>() {
        return Err(AudioError::BackendFailure(format!(
            "{context} returned {size} bytes, expected {}",
            mem::size_of::<T>()
        )));
    }

    // SAFETY: the call above succeeded and reported it wrote the full size of `T`.
    Ok(unsafe { value.assume_init() })
}

/// SAFETY: `AudioObjectSetPropertyData` reads exactly `size_of::<T>()` bytes from `value`, which
/// points at a live local of that type for the duration of the call.
fn write_property<T>(
    object: AudioObjectID,
    address: &AudioObjectPropertyAddress,
    value: &T,
    context: &str,
) -> Result<(), AudioError> {
    let status = unsafe {
        AudioObjectSetPropertyData(
            object,
            address,
            0,
            ptr::null(),
            mem::size_of::<T>() as u32,
            ptr::from_ref(value).cast::<c_void>(),
        )
    };

    check(status, context)
}

fn has_property(object: AudioObjectID, address: &AudioObjectPropertyAddress) -> bool {
    // SAFETY: `address` points at a live local for the duration of the call, and the function
    // only reads it.
    unsafe { AudioObjectHasProperty(object, address) != 0 }
}

/// SAFETY: `value` is a valid `CFStringRef` returned by CoreAudio. `CFStringGetCString` writes at
/// most `buffer.len()` bytes including the terminator, and ownership follows the Get rule — the
/// caller received it from a property read, so it must release it exactly once.
fn take_cf_string(value: CFStringRef) -> String {
    if value.is_null() {
        return String::new();
    }

    let mut buffer = [0_i8; 256];
    let copied = unsafe {
        CFStringGetCString(
            value,
            buffer.as_mut_ptr(),
            buffer.len() as i64,
            coreaudio_sys::kCFStringEncodingUTF8,
        )
    };

    // SAFETY: the property read handed us a +1 reference.
    unsafe { CFRelease(value.cast()) };

    if copied == 0 {
        return String::new();
    }

    let bytes: Vec<u8> = buffer
        .iter()
        .take_while(|byte| **byte != 0)
        .map(|byte| *byte as u8)
        .collect();

    String::from_utf8_lossy(&bytes).into_owned()
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

    Ok(devices.into_iter().filter(|id| has_output_streams(*id)).collect())
}

/// Most output devices expose no settable master element, so the master element is tried first
/// and the stereo pair is the fallback. Returning the average keeps the reported value stable
/// when the two channels are balanced, which they are unless the user split them elsewhere.
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
        // Aggregate devices, most HDMI outputs, and many USB DACs carry their gain in hardware
        // and expose no scalar at all. Nothing is attenuating the signal, so unity is the honest
        // reading — reporting a failure here would blank the master card on a working device.
        // The matching write still returns Unsupported rather than pretending to take effect.
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
        return Err(AudioError::Unsupported(
            "this output device exposes no software volume control".to_owned(),
        ));
    }

    Ok(())
}

fn mute_address() -> AudioObjectPropertyAddress {
    address(
        kAudioDevicePropertyMute,
        kAudioObjectPropertyScopeOutput,
        kAudioObjectPropertyElementMain,
    )
}

impl AudioBackend for MacOsAudioBackend {
    fn capabilities(&self) -> PlatformCapabilities {
        PlatformCapabilities::master_only(UNSUPPORTED_REASON)
    }

    fn list_sessions(&self) -> Result<Vec<AudioSession>, AudioError> {
        Err(AudioError::Unsupported(UNSUPPORTED_REASON.to_owned()))
    }

    fn set_session_volume(&self, _id: &SessionId, _volume: f32) -> Result<(), AudioError> {
        Err(AudioError::Unsupported(UNSUPPORTED_REASON.to_owned()))
    }

    fn set_session_mute(&self, _id: &SessionId, _is_muted: bool) -> Result<(), AudioError> {
        Err(AudioError::Unsupported(UNSUPPORTED_REASON.to_owned()))
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
        // success there would be the silent no-op §2.4 forbids, so the write is read back.
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

    /// There are no sessions on macOS in v1, so a tick carries no per-session peaks. The §2
    /// master meter has no surface on the §2.4 trait, which only returns `SessionPeak` — see
    /// DECISIONS.md D-003.
    fn read_peaks(&self) -> Result<Vec<SessionPeak>, AudioError> {
        Ok(Vec::new())
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

    #[test]
    fn reports_no_per_app_capability() {
        let capabilities = MacOsAudioBackend::new().capabilities();

        assert!(!capabilities.has_per_app_volume);
        assert!(!capabilities.has_per_app_mute);
        assert!(!capabilities.has_per_app_meter);
        assert!(!capabilities.has_per_app_routing);
    }

    /// §2.2.5: the UI renders this verbatim in place of the session list.
    #[test]
    fn carries_the_reason_the_empty_state_renders() {
        let capabilities = MacOsAudioBackend::new().capabilities();

        assert_eq!(
            capabilities.unsupported_reason.as_deref(),
            Some(UNSUPPORTED_REASON)
        );
    }

    /// §2.4: never `Ok(())`, never an empty list — a silent no-op reaches the user as a control
    /// that appears to work.
    #[test]
    fn refuses_every_per_app_operation_loudly() {
        let backend = MacOsAudioBackend::new();
        let id = session_id();

        assert!(matches!(
            backend.list_sessions(),
            Err(AudioError::Unsupported(_))
        ));
        assert!(matches!(
            backend.set_session_volume(&id, 0.5),
            Err(AudioError::Unsupported(_))
        ));
        assert!(matches!(
            backend.set_session_mute(&id, true),
            Err(AudioError::Unsupported(_))
        ));
        assert!(matches!(
            backend.set_session_output_device(&id, &DeviceId::new("1")),
            Err(AudioError::Unsupported(_))
        ));
    }

    #[test]
    fn reports_no_session_peaks() {
        assert!(MacOsAudioBackend::new()
            .read_peaks()
            .expect("an empty batch is not a failure")
            .is_empty());
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


