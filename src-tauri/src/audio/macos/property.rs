//! The CoreAudio property accessors every macOS module shares.
//!
//! CoreAudio exposes one untyped getter and one untyped setter over `void*`, so every read here
//! is a place where a wrong size is undefined behaviour rather than a compile error. Funnelling
//! all of them through these four functions means the size argument is derived from the type
//! parameter exactly once, instead of at each of the several dozen call sites.

use std::ffi::c_void;
use std::mem;
use std::ptr;

use coreaudio_sys::{
    kAudioHardwareNoError, AudioObjectGetPropertyData, AudioObjectGetPropertyDataSize,
    AudioObjectHasProperty, AudioObjectID, AudioObjectPropertyAddress, AudioObjectSetPropertyData,
    CFRelease, CFStringGetCString, CFStringRef, OSStatus,
};

use crate::audio::AudioError;

pub(super) fn address(selector: u32, scope: u32, element: u32) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: scope,
        mElement: element,
    }
}

pub(super) fn check(status: OSStatus, context: &str) -> Result<(), AudioError> {
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
pub(super) fn read_property<T>(
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

/// A variable-length property, sized first and then read.
///
/// The two calls are not atomic: a device can appear between the size query and the read, which
/// is why the second call's reported size decides the final length rather than the first one's.
/// Trusting the first would hand out a vector whose tail CoreAudio never wrote.
pub(super) fn read_array<T: Copy + Default>(
    object: AudioObjectID,
    address: &AudioObjectPropertyAddress,
    context: &str,
) -> Result<Vec<T>, AudioError> {
    let mut size = 0_u32;
    // SAFETY: both out-params are live locals; the call only writes the byte count.
    let status =
        unsafe { AudioObjectGetPropertyDataSize(object, address, 0, ptr::null(), &mut size) };
    check(status, context)?;

    let capacity = size as usize / mem::size_of::<T>();
    let mut values = vec![T::default(); capacity];

    if capacity == 0 {
        return Ok(values);
    }

    // SAFETY: `values` holds exactly `capacity` elements, which is the element count the size
    // query reported, so CoreAudio writes within the allocation.
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            address,
            0,
            ptr::null(),
            &mut size,
            values.as_mut_ptr().cast::<c_void>(),
        )
    };
    check(status, context)?;

    values.truncate(size as usize / mem::size_of::<T>());

    Ok(values)
}

/// SAFETY: `AudioObjectSetPropertyData` reads exactly `size_of::<T>()` bytes from `value`, which
/// points at a live local of that type for the duration of the call.
pub(super) fn write_property<T>(
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

pub(super) fn has_property(object: AudioObjectID, address: &AudioObjectPropertyAddress) -> bool {
    // SAFETY: `address` points at a live local for the duration of the call, and the function
    // only reads it.
    unsafe { AudioObjectHasProperty(object, address) != 0 }
}

/// SAFETY: `value` is a valid `CFStringRef` returned by CoreAudio. `CFStringGetCString` writes at
/// most `buffer.len()` bytes including the terminator, and ownership follows the Get rule — the
/// caller received it from a property read, so it must release it exactly once.
pub(super) fn take_cf_string(value: CFStringRef) -> String {
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
