//! Per-app session discovery over CoreAudio process objects.
//!
//! `kAudioHardwarePropertyProcessObjectList` reports every process CoreAudio knows about, which is
//! far more than the mixer wants. Two filters cut it down, and both are load-bearing.
//!
//! The first is `kAudioProcessPropertyIsRunningOutput`: the app must currently hold the output.
//! "Currently running" is not a useful test on macOS, because closing an app's window does not
//! quit it — Books can sit in the Dock for three weeks — and a mixer listing every app that has
//! not been quit is a list of things the user does not think of as open.
//!
//! The second is that the process must belong to an app the user opened. Two thirds of the list is
//! system machinery — `audiomxd`, `CoreSpeech`, `assistantd`, `PowerChime` — and a row for those
//! is a slider over a part of macOS nobody asked to mix.
//!
//! The awkward part is that a CoreAudio process is not an app. A browser plays YouTube through a
//! GPU helper and a media helper, so a naive listing shows two rows called "helper" and "TEDI
//! Graphics and Media" and none called the browser's name. Every audio process is therefore
//! walked up to the app that owns it, and processes sharing an owner collapse into one session —
//! which is also the only reading under which a per-app volume slider means anything.
//!
//! "Up" needs two different answers, because macOS spawns helpers two different ways. A Chromium
//! helper is a child of the browser, so its parent PID leads home. A WebKit one is not: since
//! macOS 12 WebKit plays media in `com.apple.WebKit.GPU`, an XPC service launchd starts on the
//! host's behalf, whose parent is therefore `launchd` and whose bundle identifier is Apple's. The
//! parent walk alone ends instantly there and leaves a row called "GPU" with a placeholder icon,
//! controlling audio the user thinks of as Safari's.
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

/// One app currently playing audio, and every CoreAudio process behind it.
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

/// Every process object CoreAudio currently knows about, filtered by nothing.
///
/// Wider than the session list on purpose: the watcher has to hear an app that is *not* listed
/// start playing, and it can only do that by holding a listener on the object it will start
/// playing through.
pub(super) fn audio_process_objects() -> Result<Vec<AudioObjectID>, AudioError> {
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

/// `pid_t responsibility_get_pid_responsible_for_pid(pid_t)`.
type ResponsibleForPid = unsafe extern "C" fn(libc::pid_t) -> libc::pid_t;

/// The routine macOS itself uses to blame an XPC service on the app that asked for it — the same
/// attribution behind TCC prompts and cookie policy.
///
/// It is private, so it is resolved at runtime rather than linked. A macOS that stops exporting it
/// leaves this returning `None`, which costs the WebKit case and nothing else: the parent walk
/// still runs, and the build still links.
fn responsible_lookup() -> Option<ResponsibleForPid> {
    static SYMBOL: std::sync::OnceLock<Option<ResponsibleForPid>> = std::sync::OnceLock::new();

    *SYMBOL.get_or_init(|| {
        // SAFETY: the name is a NUL-terminated C string, and `RTLD_DEFAULT` searches the images
        // already loaded into this process.
        let address = unsafe {
            libc::dlsym(
                libc::RTLD_DEFAULT,
                c"responsibility_get_pid_responsible_for_pid".as_ptr(),
            )
        };

        if address.is_null() {
            return None;
        }

        // SAFETY: the symbol resolved, and this is the signature Apple ships it with. Nothing else
        // in the process exports that name.
        Some(unsafe { std::mem::transmute::<*mut libc::c_void, ResponsibleForPid>(address) })
    })
}

/// The app macOS holds responsible for `pid`, when that is somebody else.
///
/// A process with nobody above it answers with its own PID — every Chromium helper does, which is
/// why this cannot replace the parent walk — and a failure answers `-1`. Neither is a hop, and
/// returning the input as a hop would spin the walk on one process until it ran out of tries.
fn responsible_pid(pid: i32) -> Option<i32> {
    let lookup = responsible_lookup()?;

    // SAFETY: the symbol takes a PID by value and returns one; there are no pointers involved.
    let owner = unsafe { lookup(pid) };

    (owner > 0 && owner != pid).then_some(owner)
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

/// One step up from a helper towards the app behind it.
///
/// Responsibility is tried first because it is the more specific answer: it is the only one that
/// crosses an XPC service, and for everything else it declines by naming the process itself. The
/// parent PID then covers the ordinary case of a helper spawned by its app.
fn owner_pid(pid: i32) -> Option<i32> {
    responsible_pid(pid).or_else(|| parent_pid(pid))
}

fn is_pid_alive(pid: i32) -> bool {
    if pid <= 0 {
        return false;
    }
    // SAFETY: kill with signal 0 checks process existence without sending a signal.
    unsafe { libc::kill(pid, 0) == 0 }
}

/// The app macOS holds responsible for `pid`, when that is somebody else.
fn owning_application(pid: i32) -> Option<objc2::rc::Retained<NSRunningApplication>> {
    if !is_pid_alive(pid) {
        return None;
    }

    let mut current = pid;

    for _ in 0..MAX_PARENT_HOPS {
        if let Some(application) = NSRunningApplication::runningApplicationWithProcessIdentifier(current)
        {
            if application.isTerminated() {
                return None;
            }
            if application.activationPolicy() == NSApplicationActivationPolicy::Regular {
                return Some(application);
            }
        }

        current = owner_pid(current)?;
    }

    None
}

/// Everything the panel needs to name a row, or `None` when this is not an app the user opened.
///
/// No owning app means a daemon, an XPC service with nobody behind it, or a command-line tool —
/// `audiomxd`, `CoreSpeech`, `PowerChime`. Naming those from their bundle identifier is what
/// produced rows like "GPU" and "Process 914": a slider over a piece of macOS, labelled with
/// whatever the last dotted segment happened to be. Dropping them is the honest answer, because
/// there is no app the user could point at and say the audio came from there.
fn describe(pid: i32, own_bundle_id: &str) -> Option<(i32, String, String)> {
    let application = owning_application(pid)?;

    let bundle_id = application
        .bundleIdentifier()
        .map(|id| id.to_string())
        .unwrap_or_else(|| own_bundle_id.to_owned());

    let name = application
        .localizedName()
        .map(|name| name.to_string())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| format!("Process {pid}"));

    Some((application.processIdentifier(), bundle_id, name))
}

/// Every app currently playing audio, excluding Somul itself.
///
/// Somul is an audio client the moment the mixer's aggregate device opens, so without the
/// exclusion the mixer would tap its own output and feed itself.
pub(super) fn playing_applications() -> Result<Vec<ProcessSession>, AudioError> {
    let own_pid = std::process::id() as i32;
    let mut sessions: Vec<ProcessSession> = Vec::new();
    let objects = audio_process_objects()?;

    // Every object, not just the listed ones: an app that is silent now is exactly the app whose
    // first sound the panel has to notice.
    super::watch::watch(&objects);

    for object in objects {
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
        let Some((owner_pid, bundle_id, display_name)) = describe(pid, &process_bundle) else {
            continue;
        };

        // The PID check alone is not enough: a second copy of Somul, or a run under the test
        // harness, has a different PID from the one doing the filtering.
        if bundle_id == OWN_BUNDLE_ID || process_bundle == OWN_BUNDLE_ID {
            continue;
        }

        // No bundle identifier, no row. Settings memory is keyed by this string, so a process
        // without one cannot have its level remembered, and the panel would carry an anonymous
        // slider the user has no way to recognise — an Android emulator holding an output stream
        // it never uses is the case that surfaced this. The contract suite agrees: a session with
        // an empty process name fails it outright.
        if bundle_id.trim().is_empty() {
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

    // CoreAudio does not promise a stable order, and the panel now follows this list once a
    // second. Left unsorted, a reshuffle reads as a change, republishes the list, and the rows
    // jump under whatever the user is dragging.
    sessions.sort_by(|left, right| {
        left.display_name
            .to_lowercase()
            .cmp(&right.display_name.to_lowercase())
            .then_with(|| left.identifier().cmp(&right.identifier()))
    });

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

    /// The surprise this pins: the routine answers with the process itself when nobody else is
    /// responsible for it. Taken as a hop, the walk would spin on one process until it ran out of
    /// tries and report no owner at all.
    #[test]
    fn a_hop_never_lands_back_on_the_process_it_started_from() {
        let own_pid = std::process::id() as i32;

        assert_ne!(responsible_pid(own_pid), Some(own_pid));
        assert_ne!(owner_pid(own_pid), Some(own_pid));
    }

    /// A PID nothing is running under has no owner to report, and must not produce one.
    #[test]
    fn an_unknown_process_has_no_owner() {
        // Above `kern.maxproc` on every macOS, so it cannot collide with a live process.
        const UNASSIGNED_PID: i32 = i32::MAX - 1;

        assert_eq!(responsible_pid(UNASSIGNED_PID), None);
    }

    /// The defect this pins. WebKit plays media in a launchd-owned XPC service, so the parent walk
    /// ends at once and the app is listed under Apple's bundle identifier — a row called "GPU"
    /// with a placeholder icon, whose slider the user cannot connect to anything they opened.
    #[test]
    fn never_lists_a_webkit_service_under_its_own_name() {
        if responsible_lookup().is_none() {
            return;
        }

        let Ok(sessions) = playing_applications() else {
            return;
        };

        for found in &sessions {
            assert!(
                !found.bundle_id.starts_with("com.apple.WebKit."),
                "{} was listed as itself instead of the app hosting it",
                found.display_name
            );
        }
    }

    /// Two thirds of the CoreAudio process list is system machinery. A row for `audiomxd` or
    /// `CoreSpeech` is a slider over a part of macOS the user did not open and cannot reason
    /// about, so every listed row must trace back to an app with a Dock presence.
    #[test]
    fn lists_only_apps_the_user_opened() {
        let Ok(sessions) = playing_applications() else {
            return;
        };

        for found in &sessions {
            let application = NSRunningApplication::runningApplicationWithProcessIdentifier(found.pid)
                .unwrap_or_else(|| panic!("{} is not a running application", found.display_name));

            assert_eq!(
                application.activationPolicy(),
                NSApplicationActivationPolicy::Regular,
                "{} is background machinery, not an app the user opened",
                found.display_name
            );
        }
    }

    /// A reshuffle from CoreAudio must not reach the panel as a change. Sorting is what makes the
    /// list comparable at all.
    #[test]
    fn orders_rows_by_name_so_they_do_not_jump() {
        let Ok(sessions) = playing_applications() else {
            return;
        };

        let names: Vec<String> = sessions
            .iter()
            .map(|found| found.display_name.to_lowercase())
            .collect();
        let mut sorted = names.clone();
        sorted.sort();

        assert_eq!(names, sorted, "rows were not in a stable, name-ordered sequence");
    }

    /// Enumeration runs against the live machine, so it asserts shape rather than contents.
    #[test]
    fn enumerates_the_live_machine_without_listing_somul_itself() {
        let Ok(sessions) = playing_applications() else {
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
