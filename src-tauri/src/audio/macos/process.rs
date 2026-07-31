//! Per-app session discovery over CoreAudio process objects.
//!
//! `kAudioHardwarePropertyProcessObjectList` reports every process CoreAudio knows about, running
//! or not. The mixer only wants the ones currently producing output, which is what
//! `kAudioProcessPropertyIsRunningOutput` answers.
//!
//! The awkward part is that a CoreAudio process is not an app. A browser plays YouTube through a
//! GPU helper and a media helper, so a naive listing shows two rows called "helper" and "TEDI
//! Graphics and Media" and none called the browser's name. Every audio process is therefore
//! walked up its parent chain to the app that owns it, and processes sharing an owner collapse
//! into one session — which is also the only reading under which a per-app volume slider means
//! anything.
//!
//! Nothing here touches audio. Discovery is deliberately separable from the tap engine so a
//! failure to enumerate degrades to an empty list rather than to silence.

use coreaudio_sys::{
    kAudioHardwarePropertyProcessObjectList, kAudioObjectPropertyElementMain,
    kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject, kAudioProcessPropertyBundleID,
    kAudioProcessPropertyIsRunningOutput, kAudioProcessPropertyPID, AudioObjectID, CFStringRef,
};
use objc2_app_kit::{NSApplicationActivationPolicy, NSRunningApplication};

use super::property::{address, read_array, read_property, take_cf_string};
use crate::audio::AudioError;

/// Must match `identifier` in `tauri.conf.json`. Somul is an audio client the moment the mixer's
/// aggregate device opens, so it appears in the process list alongside everything else.
const OWN_BUNDLE_ID: &str = "com.somul.app";

/// How far up the parent chain to look for the owning app.
///
/// Bounded because the walk ends at `launchd` in the normal case and must end *somewhere* in the
/// abnormal one. Four is past every helper nesting depth macOS actually uses.
const MAX_PARENT_HOPS: usize = 4;

/// One app currently producing output, and every CoreAudio process behind it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProcessSession {
    /// Every audio process this app owns. A single tap covers all of them, which is why this is
    /// a list rather than one object — a browser routinely has two.
    pub objects: Vec<AudioObjectID>,
    /// The owning app's PID, not the helper's. Used for the icon and nothing else.
    pub pid: i32,
    /// Empty when nothing in the chain has an `Info.plist`.
    pub bundle_id: String,
    pub display_name: String,
}

impl ProcessSession {
    /// A key that survives the app quitting and relaunching.
    ///
    /// The bundle ID is the stable half; the PID is not, and the process object ID is not either
    /// — CoreAudio reuses both. Falling back to the PID for a bundle-less process means its
    /// volume is forgotten across a relaunch, which is the honest outcome: there is nothing
    /// durable to remember it by.
    ///
    /// The prefix is load-bearing. `SessionId` rejects an all-digit identifier precisely so a
    /// stringified PID cannot become a session key.
    pub fn identifier(&self) -> String {
        if self.bundle_id.is_empty() {
            return format!("macos:pid:{}", self.pid);
        }

        format!("macos:app:{}", self.bundle_id)
    }
}

fn process_object_ids() -> Result<Vec<AudioObjectID>, AudioError> {
    let address = address(
        kAudioHardwarePropertyProcessObjectList,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    );

    read_array::<AudioObjectID>(
        kAudioObjectSystemObject,
        &address,
        "reading the process object list",
    )
}

fn process_property_address(selector: u32) -> coreaudio_sys::AudioObjectPropertyAddress {
    address(
        selector,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    )
}

fn is_running_output(object: AudioObjectID) -> bool {
    read_property::<u32>(
        object,
        &process_property_address(kAudioProcessPropertyIsRunningOutput),
        "reading a process output-running flag",
    )
    .map(|raw| raw != 0)
    .unwrap_or(false)
}

fn process_pid(object: AudioObjectID) -> Option<i32> {
    read_property::<i32>(
        object,
        &process_property_address(kAudioProcessPropertyPID),
        "reading a process PID",
    )
    .ok()
    .filter(|pid| *pid > 0)
}

fn process_bundle_id(object: AudioObjectID) -> String {
    read_property::<CFStringRef>(
        object,
        &process_property_address(kAudioProcessPropertyBundleID),
        "reading a process bundle identifier",
    )
    .map(take_cf_string)
    .unwrap_or_default()
}

/// The parent of `pid`, straight from the kernel's BSD process info.
fn parent_pid(pid: i32) -> Option<i32> {
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;

    // SAFETY: `info` is a live, zeroed local of exactly the type `PROC_PIDTBSDINFO` fills, and
    // `size` is that type's size, so the kernel writes within the allocation.
    let written = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            std::ptr::from_mut(&mut info).cast(),
            size,
        )
    };

    if written != size {
        return None;
    }

    let parent = info.pbi_ppid as i32;

    // `launchd` owns every orphan, so treating it as an owner would collapse unrelated apps into
    // one row.
    (parent > 1).then_some(parent)
}

/// The app a given audio process belongs to.
///
/// "App" means one with a Dock presence. A helper has no activation policy of its own worth
/// showing, and the user thinks of its audio as the browser's, not the helper's.
fn owning_application(pid: i32) -> Option<objc2::rc::Retained<NSRunningApplication>> {
    let mut current = pid;

    for _ in 0..MAX_PARENT_HOPS {
        if let Some(application) = NSRunningApplication::runningApplicationWithProcessIdentifier(current)
        {
            if application.activationPolicy() == NSApplicationActivationPolicy::Regular {
                return Some(application);
            }
        }

        current = parent_pid(current)?;
    }

    None
}

/// Everything the panel needs to name a row, resolved from the owning app where there is one.
fn describe(pid: i32, own_bundle_id: &str) -> (i32, String, String) {
    let Some(application) = owning_application(pid) else {
        // No owning app: a command-line tool or a daemon. It still has to be nameable, or the row
        // renders blank and the user cannot tell what they are muting.
        let name = if own_bundle_id.is_empty() {
            format!("Process {pid}")
        } else {
            own_bundle_id
                .rsplit('.')
                .next()
                .filter(|segment| !segment.is_empty())
                .unwrap_or(own_bundle_id)
                .to_owned()
        };

        return (pid, own_bundle_id.to_owned(), name);
    };

    let bundle_id = application
        .bundleIdentifier()
        .map(|id| id.to_string())
        .unwrap_or_else(|| own_bundle_id.to_owned());

    let name = application
        .localizedName()
        .map(|name| name.to_string())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| format!("Process {pid}"));

    (application.processIdentifier(), bundle_id, name)
}

/// Every app currently rendering output, excluding Somul itself.
///
/// Somul is an audio client the moment the mixer's aggregate device opens, so without the
/// exclusion the mixer would tap its own output and feed itself.
pub(super) fn running_output_processes() -> Result<Vec<ProcessSession>, AudioError> {
    let own_pid = std::process::id() as i32;
    let mut sessions: Vec<ProcessSession> = Vec::new();

    for object in process_object_ids()? {
        if !is_running_output(object) {
            continue;
        }

        let Some(pid) = process_pid(object) else {
            continue;
        };

        if pid == own_pid {
            continue;
        }

        let process_bundle = process_bundle_id(object);
        let (owner_pid, bundle_id, display_name) = describe(pid, &process_bundle);

        // The PID check alone is not enough: a second copy of Somul, or a run under the test
        // harness, has a different PID from the one doing the filtering.
        if bundle_id == OWN_BUNDLE_ID || process_bundle == OWN_BUNDLE_ID {
            continue;
        }

        let candidate = ProcessSession {
            objects: vec![object],
            pid: owner_pid,
            bundle_id,
            display_name,
        };

        // Helpers of the same app fold into the row the user recognises, and one tap covers all
        // of them.
        match sessions
            .iter_mut()
            .find(|existing| existing.identifier() == candidate.identifier())
        {
            Some(existing) => existing.objects.push(object),
            None => sessions.push(candidate),
        }
    }

    Ok(sessions)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(bundle_id: &str, pid: i32) -> ProcessSession {
        ProcessSession {
            objects: vec![42],
            pid,
            bundle_id: bundle_id.to_owned(),
            display_name: "Probe".to_owned(),
        }
    }

    #[test]
    fn keys_a_bundled_app_by_its_bundle_identifier() {
        assert_eq!(
            session("com.spotify.client", 4821).identifier(),
            "macos:app:com.spotify.client"
        );
    }

    #[test]
    fn falls_back_to_the_pid_when_a_process_has_no_bundle() {
        assert_eq!(session("", 4821).identifier(), "macos:pid:4821");
    }

    /// The guard `SessionId` enforces: neither form may come out as bare digits.
    #[test]
    fn never_produces_an_identifier_a_session_key_would_reject() {
        for candidate in [session("com.apple.Music", 501), session("", 501)] {
            assert!(
                crate::audio::SessionId::from_backend_identifier(&candidate.identifier()).is_ok(),
                "{} was rejected as a session key",
                candidate.identifier()
            );
        }
    }

    /// `launchd` owns every orphan. Treating it as an owner would fold unrelated apps into one
    /// row and give the user a slider that moves half the system.
    #[test]
    fn never_walks_up_to_launchd() {
        assert_eq!(parent_pid(1), None);
    }

    /// Enumeration runs against the live machine, so it asserts shape rather than contents.
    #[test]
    fn enumerates_the_live_machine_without_listing_somul_itself() {
        let Ok(sessions) = running_output_processes() else {
            return;
        };

        let own_pid = std::process::id() as i32;
        let mut seen: Vec<String> = Vec::new();

        for found in &sessions {
            assert!(found.pid > 0, "a listed app had a non-positive PID");
            assert_ne!(found.pid, own_pid, "the mixer listed its own process");
            assert!(
                !found.display_name.is_empty(),
                "a listed app rendered a blank row"
            );
            assert!(
                !found.objects.is_empty(),
                "a listed app carried no audio process to tap"
            );

            let key = found.identifier();
            assert!(
                !seen.contains(&key),
                "{key} appeared twice — helpers must fold into one row"
            );
            seen.push(key);
        }
    }
}
