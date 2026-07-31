//! App icons, as data URIs the panel can render directly.
//!
//! CoreAudio knows nothing about icons, so these come from the running application record. The
//! conversion is deliberately allowed to fail at every step: the panel has a real fallback tile,
//! and a missing icon is a cosmetic loss, never a reason to drop a row the user needs to control.

use std::collections::HashMap;
use std::sync::Mutex;

use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSRunningApplication};
use objc2_foundation::NSDictionary;

/// A macOS app icon encodes to roughly a quarter of a megabyte at its native 1024 px, and the
/// only alternative to accepting that is drawing it into a smaller bitmap on a thread AppKit is
/// not happy to be driven from. The cache below is what makes the size affordable; this bound
/// only rejects the pathological.
const MAX_ICON_BYTES: usize = 512 * 1024;

/// Keyed by bundle ID, because that is what identifies the artwork.
///
/// Without this, every slider tick pays for the encode: writing a session volume refreshes the
/// session list, and refreshing the list used to re-encode every visible app's icon.
static CACHE: Mutex<Option<HashMap<String, Option<String>>>> = Mutex::new(None);

/// The app's icon as a `data:image/png;base64,...` URI, or `None` when anything goes wrong.
pub(super) fn icon_data_uri(pid: i32, bundle_id: &str) -> Option<String> {
    if bundle_id.is_empty() {
        return encode(pid);
    }

    let mut guard = CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let cache = guard.get_or_insert_with(HashMap::new);

    if let Some(cached) = cache.get(bundle_id) {
        return cached.clone();
    }

    let encoded = encode(pid);
    cache.insert(bundle_id.to_owned(), encoded.clone());

    encoded
}

fn encode(pid: i32) -> Option<String> {
    let application = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)?;
    let icon = application.icon()?;

    // `representations()` on an app icon holds `NSISIconImageRep`s, not bitmaps, so picking one
    // out and encoding it directly does not work. Round-tripping through TIFF is what produces a
    // bitmap at all.
    let tiff = icon.TIFFRepresentation()?;
    let representation = NSBitmapImageRep::imageRepWithData(&tiff)?;

    let properties = NSDictionary::new();
    let png = unsafe {
        representation.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
    }?;

    let bytes = png.to_vec();

    if bytes.is_empty() || bytes.len() > MAX_ICON_BYTES {
        return None;
    }

    Some(format!("data:image/png;base64,{}", base64(&bytes)))
}

/// Standard base64, no line breaks.
///
/// Hand-rolled rather than pulled in as a dependency: this is the only encoder the binary needs,
/// and it is twenty lines against a crate in the supply chain of an audio mixer.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let block = chunk
            .iter()
            .enumerate()
            .fold(0_u32, |block, (index, byte)| {
                block | (u32::from(*byte) << (16 - 8 * index))
            });

        for slot in 0..4 {
            // A 1-byte chunk carries 2 base64 symbols, a 2-byte chunk carries 3. The rest is
            // padding, which is what makes the length a multiple of four.
            if slot <= chunk.len() {
                let index = (block >> (18 - 6 * slot)) & 0b11_1111;
                encoded.push(ALPHABET[index as usize] as char);
            } else {
                encoded.push('=');
            }
        }
    }

    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The RFC 4648 vectors, which pin all three padding cases.
    #[test]
    fn encodes_the_reference_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foob"), "Zm9vYg==");
        assert_eq!(base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    /// Byte values above 127 are where a sign-extension bug would show up.
    #[test]
    fn encodes_high_bytes_without_sign_extension() {
        assert_eq!(base64(&[0xff, 0xfe, 0xfd]), "//79");
        assert_eq!(base64(&[0x00, 0x80, 0xff]), "AID/");
    }

    #[test]
    fn always_produces_a_length_that_is_a_multiple_of_four() {
        for length in 0..32 {
            let bytes = vec![0xab_u8; length];

            assert_eq!(base64(&bytes).len() % 4, 0, "length {length} was not padded");
        }
    }

    /// A PID that owns no application must yield no icon rather than a broken URI. The panel
    /// distinguishes the two: `None` draws the fallback tile, a bad URI draws a torn image.
    #[test]
    fn reports_no_icon_for_a_pid_that_owns_no_application() {
        assert!(icon_data_uri(-1, "com.example.does-not-exist").is_none());
    }

    /// The second lookup must not re-encode. A quarter-megabyte PNG per slider tick is what this
    /// cache exists to prevent.
    #[test]
    fn caches_by_bundle_identifier() {
        let first = icon_data_uri(-1, "com.example.cached");
        let second = icon_data_uri(-1, "com.example.cached");

        assert_eq!(first, second);
    }
}
