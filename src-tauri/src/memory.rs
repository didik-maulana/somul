//! Per-app volume and mute memory.
//!
//! A mixer without memory is a chore: an app put at 30% is back at whatever the OS remembers the
//! next time it launches, so the user sets the same level again every day.
//!
//! Memory is keyed by `processName`, never by `sessionId` — the OS issues a fresh session for
//! every launch, which is the one event this feature exists to survive. See [`crate::settings`].
//!
//! It lives at the [`AudioBackend`] seam rather than in the panel, as a decorator both the command
//! layer and the meter loop drive through. Two things follow from that. Restoring happens *during*
//! enumeration, so the remembered level is already in the session list the panel renders — applied
//! from the UI instead, the row would appear at full volume and visibly jump. And it cannot be
//! bypassed: every write that reaches the OS goes through here, so mute, keyboard, and any future
//! caller are remembered without each having to opt in.
//!
//! Somul only enumerates while the panel is open, so an app that starts playing behind a closed
//! panel keeps its OS level until the panel is next opened. Restoring earlier would mean running
//! the enumerator in the background, which is the cost the meter gate exists to avoid.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};

use tauri::{AppHandle, Runtime};

use crate::audio::{
    clamp_unit_scalar, AudioBackend, AudioDevice, AudioError, AudioSession, DeviceId, MasterState,
    PlatformCapabilities, SessionId, SessionPeak,
};
use crate::settings;

/// Volume arrives as a float from the OS, so an exact comparison would persist on rounding noise.
const VOLUME_EPSILON: f32 = 0.001;

/// What Somul remembers about an app between launches, keyed by `processName`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AppMemory {
    pub volume: BTreeMap<String, f32>,
    pub is_muted: BTreeMap<String, bool>,
}

/// Where memory is read from and written to.
///
/// A trait rather than a direct call into the store so the decorator is testable without a Tauri
/// runtime — and so a test never touches a developer's real settings file.
pub trait MemoryStore: Send + Sync + 'static {
    fn read(&self) -> AppMemory;
    fn write(&self, memory: &AppMemory);
}

#[derive(Default)]
struct MemoryState {
    memory: AppMemory,
    /// The process behind each live session. A write arrives with a `SessionId` alone, and memory
    /// cannot be keyed from that.
    process_names: HashMap<SessionId, String>,
    /// Sessions already restored. Restoring one twice would undo whatever the user did to it
    /// after it appeared.
    restored: HashSet<SessionId>,
}

/// Wraps a platform adapter with memory, and is otherwise transparent.
pub struct RememberingBackend {
    inner: Arc<dyn AudioBackend>,
    store: Arc<dyn MemoryStore>,
    state: Mutex<MemoryState>,
}

impl RememberingBackend {
    pub fn new(inner: Arc<dyn AudioBackend>, store: Arc<dyn MemoryStore>) -> Self {
        let memory = store.read();

        Self {
            inner,
            store,
            state: Mutex::new(MemoryState {
                memory,
                ..MemoryState::default()
            }),
        }
    }

    fn state(&self) -> MutexGuard<'_, MemoryState> {
        // A panicking caller leaves the maps intact, and treating poisoning as fatal would take
        // every subsequent audio write down with it.
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn remember_volume(&self, id: &SessionId, volume: f32) {
        let mut state = self.state();

        let Some(process_name) = state.process_names.get(id).cloned() else {
            return;
        };

        let volume = clamp_unit_scalar(volume);
        let is_unchanged = state
            .memory
            .volume
            .get(&process_name)
            .is_some_and(|remembered| (remembered - volume).abs() <= VOLUME_EPSILON);

        if is_unchanged {
            return;
        }

        state.memory.volume.insert(process_name, volume);

        self.persist(state);
    }

    fn remember_mute(&self, id: &SessionId, is_muted: bool) {
        let mut state = self.state();

        let Some(process_name) = state.process_names.get(id).cloned() else {
            return;
        };

        if state.memory.is_muted.get(&process_name) == Some(&is_muted) {
            return;
        }

        state.memory.is_muted.insert(process_name, is_muted);

        self.persist(state);
    }

    /// Writes memory out, releasing the lock first — the store touches the filesystem, and holding
    /// the lock across that would stall the meter loop's next enumeration behind a disk write.
    fn persist(&self, state: MutexGuard<'_, MemoryState>) {
        let memory = state.memory.clone();
        drop(state);

        self.store.write(&memory);
    }

    /// Applies memory to a session seen for the first time, and reports what it now holds.
    ///
    /// A failed write is left alone rather than reported: the session may have died between the
    /// enumeration and the write, and a row that will disappear on the next tick is not an error
    /// worth surfacing.
    fn restore(&self, session: &mut AudioSession, memory: &AppMemory) {
        if let Some(&volume) = memory.volume.get(&session.process_name) {
            if (session.volume - volume).abs() > VOLUME_EPSILON
                && self
                    .inner
                    .set_session_volume(&session.session_id, volume)
                    .is_ok()
            {
                session.volume = volume;
            }
        }

        if let Some(&is_muted) = memory.is_muted.get(&session.process_name) {
            if session.is_muted != is_muted
                && self
                    .inner
                    .set_session_mute(&session.session_id, is_muted)
                    .is_ok()
            {
                session.is_muted = is_muted;
            }
        }
    }
}

impl AudioBackend for RememberingBackend {
    fn capabilities(&self) -> PlatformCapabilities {
        self.inner.capabilities()
    }

    fn list_sessions(&self) -> Result<Vec<AudioSession>, AudioError> {
        let mut sessions = self.inner.list_sessions()?;
        let mut state = self.state();

        let live: HashSet<SessionId> = sessions
            .iter()
            .map(|session| session.session_id.clone())
            .collect();

        state.process_names.retain(|id, _| live.contains(id));
        state.restored.retain(|id| live.contains(id));

        let memory = state.memory.clone();

        for session in &mut sessions {
            state
                .process_names
                .insert(session.session_id.clone(), session.process_name.clone());

            if !state.restored.insert(session.session_id.clone()) {
                continue;
            }

            self.restore(session, &memory);
        }

        Ok(sessions)
    }

    /// Remembered only once the OS has accepted it — a level that was never applied is not a level
    /// to restore an app to tomorrow.
    fn set_session_volume(&self, id: &SessionId, volume: f32) -> Result<(), AudioError> {
        self.inner.set_session_volume(id, volume)?;
        self.remember_volume(id, volume);

        Ok(())
    }

    fn set_session_mute(&self, id: &SessionId, is_muted: bool) -> Result<(), AudioError> {
        self.inner.set_session_mute(id, is_muted)?;
        self.remember_mute(id, is_muted);

        Ok(())
    }

    fn master(&self) -> Result<MasterState, AudioError> {
        self.inner.master()
    }

    fn set_master_volume(&self, volume: f32) -> Result<(), AudioError> {
        self.inner.set_master_volume(volume)
    }

    fn set_master_mute(&self, is_muted: bool) -> Result<(), AudioError> {
        self.inner.set_master_mute(is_muted)
    }

    fn list_output_devices(&self) -> Result<Vec<AudioDevice>, AudioError> {
        self.inner.list_output_devices()
    }

    fn set_default_output_device(&self, device: &DeviceId) -> Result<(), AudioError> {
        self.inner.set_default_output_device(device)
    }

    fn set_session_output_device(
        &self,
        id: &SessionId,
        device: &DeviceId,
    ) -> Result<(), AudioError> {
        self.inner.set_session_output_device(id, device)
    }

    fn read_peaks(&self) -> Result<Vec<SessionPeak>, AudioError> {
        self.inner.read_peaks()
    }

    fn sessions_may_have_changed(&self) -> Option<bool> {
        self.inner.sessions_may_have_changed()
    }
}

/// Memory kept in the settings store, alongside every other persisted preference.
///
/// Reads and writes go through [`crate::settings`] rather than the store plugin directly, so
/// memory rides the same migration and unknown-key preservation as the rest of the file.
pub struct StoredMemory<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> StoredMemory<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> MemoryStore for StoredMemory<R> {
    fn read(&self) -> AppMemory {
        let stored = settings::load(&self.app);

        AppMemory {
            volume: stored.volume_memory,
            is_muted: stored.mute_memory,
        }
    }

    /// Re-reads before writing so a preference changed since startup — a theme, a hotkey — is not
    /// rolled back by a volume commit.
    fn write(&self, memory: &AppMemory) {
        let mut stored = settings::load(&self.app);

        stored.volume_memory.clone_from(&memory.volume);
        stored.mute_memory.clone_from(&memory.is_muted);

        let _ = settings::save(&self.app, &stored);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use crate::audio::mock::MockAudioBackend;

    #[derive(Default)]
    struct RecordingStore {
        memory: Mutex<AppMemory>,
        writes: AtomicUsize,
    }

    impl RecordingStore {
        fn seeded(memory: AppMemory) -> Self {
            Self {
                memory: Mutex::new(memory),
                writes: AtomicUsize::new(0),
            }
        }

        fn snapshot(&self) -> AppMemory {
            self.memory.lock().expect("test store is not poisoned").clone()
        }

        fn writes(&self) -> usize {
            self.writes.load(Ordering::Acquire)
        }
    }

    impl MemoryStore for RecordingStore {
        fn read(&self) -> AppMemory {
            self.snapshot()
        }

        fn write(&self, memory: &AppMemory) {
            *self.memory.lock().expect("test store is not poisoned") = memory.clone();
            self.writes.fetch_add(1, Ordering::Release);
        }
    }

    fn remembering(store: Arc<RecordingStore>) -> RememberingBackend {
        RememberingBackend::new(Arc::new(MockAudioBackend::full_per_app()), store)
    }

    fn volume_of(backend: &dyn AudioBackend, process_name: &str) -> f32 {
        backend
            .list_sessions()
            .expect("sessions")
            .into_iter()
            .find(|session| session.process_name == process_name)
            .expect("the seeded session exists")
            .volume
    }

    fn session_id_of(backend: &dyn AudioBackend, process_name: &str) -> SessionId {
        backend
            .list_sessions()
            .expect("sessions")
            .into_iter()
            .find(|session| session.process_name == process_name)
            .expect("the seeded session exists")
            .session_id
    }

    fn remembered_volume(store: &RecordingStore, process_name: &str) -> Option<f32> {
        store.snapshot().volume.get(process_name).copied()
    }

    crate::audio_backend_contract!(
        remembering_backend,
        RememberingBackend::new(
            Arc::new(MockAudioBackend::full_per_app()),
            Arc::new(RecordingStore::default())
        )
    );

    #[test]
    fn restores_a_remembered_volume_the_first_time_an_app_is_seen() {
        let store = Arc::new(RecordingStore::seeded(AppMemory {
            volume: BTreeMap::from([("spotify.exe".to_owned(), 0.3)]),
            ..AppMemory::default()
        }));
        let backend = remembering(Arc::clone(&store));

        let sessions = backend.list_sessions().expect("sessions");
        let spotify = sessions
            .iter()
            .find(|session| session.process_name == "spotify.exe")
            .expect("the seeded session exists");

        assert_eq!(
            spotify.volume, 0.3,
            "the restored level must be in the list the panel renders, not a tick behind it"
        );
        assert_eq!(volume_of(&backend, "spotify.exe"), 0.3);
    }

    #[test]
    fn restores_a_remembered_mute() {
        let store = Arc::new(RecordingStore::seeded(AppMemory {
            is_muted: BTreeMap::from([("spotify.exe".to_owned(), true)]),
            ..AppMemory::default()
        }));
        let backend = remembering(store);

        let sessions = backend.list_sessions().expect("sessions");

        assert!(
            sessions
                .iter()
                .find(|session| session.process_name == "spotify.exe")
                .expect("the seeded session exists")
                .is_muted
        );
    }

    #[test]
    fn leaves_an_app_it_remembers_nothing_about_alone() {
        let backend = remembering(Arc::new(RecordingStore::default()));

        assert_eq!(volume_of(&backend, "spotify.exe"), 0.74);
    }

    /// Memory is applied when the app appears and never again — re-applying on the next poll
    /// would drag the slider back out from under the user.
    #[test]
    fn does_not_reapply_memory_over_a_later_change() {
        let store = Arc::new(RecordingStore::seeded(AppMemory {
            volume: BTreeMap::from([("spotify.exe".to_owned(), 0.3)]),
            ..AppMemory::default()
        }));
        let backend = remembering(store);
        let spotify = session_id_of(&backend, "spotify.exe");

        backend
            .set_session_volume(&spotify, 0.9)
            .expect("volume write");

        assert_eq!(volume_of(&backend, "spotify.exe"), 0.9);
    }

    #[test]
    fn remembers_a_volume_write_under_the_process_name() {
        let store = Arc::new(RecordingStore::default());
        let backend = remembering(Arc::clone(&store));
        let spotify = session_id_of(&backend, "spotify.exe");

        backend
            .set_session_volume(&spotify, 0.42)
            .expect("volume write");

        assert_eq!(remembered_volume(&store, "spotify.exe"), Some(0.42));
    }

    #[test]
    fn remembers_a_mute_write_under_the_process_name() {
        let store = Arc::new(RecordingStore::default());
        let backend = remembering(Arc::clone(&store));
        let spotify = session_id_of(&backend, "spotify.exe");

        backend.set_session_mute(&spotify, true).expect("mute write");

        assert_eq!(store.snapshot().is_muted.get("spotify.exe"), Some(&true));
    }

    /// The commit path fires several times on the way to one resting level. Persisting each of
    /// them would write the settings file on every pause of a drag.
    #[test]
    fn does_not_persist_a_write_that_changes_nothing() {
        let store = Arc::new(RecordingStore::default());
        let backend = remembering(Arc::clone(&store));
        let spotify = session_id_of(&backend, "spotify.exe");

        backend
            .set_session_volume(&spotify, 0.42)
            .expect("volume write");
        let after_first = store.writes();

        backend
            .set_session_volume(&spotify, 0.42)
            .expect("volume write");

        assert_eq!(store.writes(), after_first);
    }

    /// A level the OS refused was never applied, so there is nothing to restore an app to.
    #[test]
    fn does_not_remember_a_rejected_write() {
        let store = Arc::new(RecordingStore::default());
        let backend = remembering(Arc::clone(&store));

        let unknown = SessionId::from_backend_identifier("mock:session:closed")
            .expect("a namespaced identifier");

        assert!(backend.set_session_volume(&unknown, 0.42).is_err());
        assert_eq!(store.writes(), 0);
    }

    /// The point of the whole feature: a fresh adapter is what the next launch looks like.
    #[test]
    fn restores_what_a_previous_run_remembered() {
        let store = Arc::new(RecordingStore::default());

        let first_run = remembering(Arc::clone(&store));
        let spotify = session_id_of(&first_run, "spotify.exe");
        first_run
            .set_session_volume(&spotify, 0.3)
            .expect("volume write");

        let second_run = remembering(Arc::clone(&store));

        assert_eq!(volume_of(&second_run, "spotify.exe"), 0.3);
    }

    #[test]
    fn stays_transparent_over_a_backend_with_no_per_app_control() {
        let backend = RememberingBackend::new(
            Arc::new(MockAudioBackend::master_only()),
            Arc::new(RecordingStore::default()),
        );

        assert!(!backend.capabilities().has_per_app_volume);
        assert!(matches!(
            backend.list_sessions(),
            Err(AudioError::Unsupported(_))
        ));
        assert!(backend.master().is_ok());
    }
}
