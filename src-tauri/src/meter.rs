//! The 30 Hz peak loop — the only hot path in the application.
//!
//! While the panel is hidden the loop is **stopped, not throttled**. The thread blocks on a
//! condvar, so a hidden panel costs zero backend calls and zero wakeups — which is what makes
//! the background CPU budget reachable rather than aspirational.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::audio::{AudioBackend, AudioSession, MasterState, SessionPeak};

pub const METER_HZ: u32 = 30;
pub const TICK: Duration = Duration::from_nanos(1_000_000_000 / METER_HZ as u64);

/// One batch per tick covering every session — never one emit per session.
pub const PEAKS_EVENT: &str = "audio://peaks";

/// Emitted when the system output volume, mute, or device changes while the panel is open.
pub const MASTER_CHANGED_EVENT: &str = "audio://master-changed";

/// Emitted when the set of apps producing audio changes while the panel is open.
///
/// Without this the panel's session list is whatever it was at startup: an app that begins
/// playing afterwards never appears, and one that stops never leaves.
pub const SESSIONS_CHANGED_EVENT: &str = "audio://sessions-changed";

/// Emitted once when the panel opens, carrying the current system state.
///
/// Distinct from [`MASTER_CHANGED_EVENT`] because the UI must treat it differently: a change is
/// eased so it reads as motion, a resync is applied instantly. Easing a resync would animate the
/// slider from whatever it showed when the panel closed up to the real level, which looks like
/// Somul is changing the volume rather than reporting it.
pub const MASTER_RESYNC_EVENT: &str = "audio://master-resync";

/// Master state is polled every Nth meter tick rather than every tick. The OS volume can be
/// changed from outside the app — menu bar, keyboard keys, System Settings — and there is no
/// cheaper way to notice than asking. At 30 Hz this works out to roughly 5 Hz, fast enough that
/// dragging the system slider looks live and slow enough to stay off the hot path.
const MASTER_POLL_EVERY_TICKS: u32 = 6;

/// The session list is polled far more slowly than the master state. Enumerating processes is
/// markedly more expensive than reading one volume, and on macOS a change to the set also rebuilds
/// the tap graph — so asking too eagerly turns a background poll into an audible one. Every 30th
/// tick is once a second, which is faster than a user can notice an app missing from the list.
const SESSION_POLL_EVERY_TICKS: u32 = 30;

/// Volume arrives as a float from the OS, so an exact comparison would emit on rounding noise.
const VOLUME_EPSILON: f32 = 0.001;

/// Compares identity, level, and mute — not peak, which changes every frame by design.
fn have_sessions_changed(previous: &[AudioSession], current: &[AudioSession]) -> bool {
    if previous.len() != current.len() {
        return true;
    }

    previous.iter().zip(current).any(|(previous, current)| {
        previous.session_id != current.session_id
            || previous.is_muted != current.is_muted
            || previous.state != current.state
            || (previous.volume - current.volume).abs() > VOLUME_EPSILON
    })
}

fn has_master_changed(previous: &MasterState, current: &MasterState) -> bool {
    (previous.volume - current.volume).abs() > VOLUME_EPSILON
        || previous.is_muted != current.is_muted
        || previous.device_id != current.device_id
        || previous.device_name != current.device_name
}

/// Shared visibility flag. `set_panel_visibility` writes it; the loop blocks on it.
#[derive(Default)]
pub struct MeterGate {
    is_visible: Mutex<bool>,
    changed: Condvar,
}

impl MeterGate {
    pub fn new() -> Self {
        Self::default()
    }

    fn guard(&self) -> MutexGuard<'_, bool> {
        // A panicking reader leaves the flag intact; treating poisoning as fatal would take the
        // meter loop down with it for no gain.
        self.is_visible
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn is_visible(&self) -> bool {
        *self.guard()
    }

    pub fn set_visible(&self, is_visible: bool) {
        *self.guard() = is_visible;
        self.changed.notify_all();
    }

    /// Blocks until the panel is shown or the loop is told to stop. Returns `false` on stop.
    fn wait_until_visible(&self, is_running: &AtomicBool) -> bool {
        let mut visible = self.guard();

        while !*visible {
            if !is_running.load(Ordering::Acquire) {
                return false;
            }

            let (next, _) = self
                .changed
                .wait_timeout(visible, TICK)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            visible = next;
        }

        is_running.load(Ordering::Acquire)
    }

    /// Sleeps one tick, waking early if the panel is hidden so the loop stops promptly.
    fn wait_for_next_tick(&self, is_running: &AtomicBool) {
        let visible = self.guard();
        let _ = self
            .changed
            .wait_timeout(visible, TICK)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _ = is_running;
    }
}

/// Where the loop's events go. Abstracted so the loop is testable without a Tauri runtime — and
/// so a test can count emits and assert one batch per tick.
pub trait PanelEventEmitter: Send + Sync + 'static {
    fn emit_peaks(&self, peaks: &[SessionPeak]);
    fn emit_sessions_changed(&self, sessions: &[AudioSession]);
    fn emit_master_changed(&self, master: &MasterState);
    fn emit_master_resync(&self, master: &MasterState);
}

pub struct MeterLoop {
    is_running: Arc<AtomicBool>,
    gate: Arc<MeterGate>,
    worker: Option<JoinHandle<()>>,
}

impl MeterLoop {
    pub fn start(
        backend: Arc<dyn AudioBackend>,
        gate: Arc<MeterGate>,
        emitter: Arc<dyn PanelEventEmitter>,
    ) -> Self {
        let is_running = Arc::new(AtomicBool::new(true));
        let worker = thread::spawn({
            let is_running = Arc::clone(&is_running);
            let gate = Arc::clone(&gate);

            move || {
                let mut last_master: Option<MasterState> = None;
                let mut last_sessions: Option<Vec<AudioSession>> = None;
                let mut tick: u32 = 0;

                while is_running.load(Ordering::Acquire) {
                    if !gate.is_visible() {
                        // The panel is closed. Forget the last master state so that reopening
                        // always re-emits: the user may have changed the system volume while the
                        // panel was hidden, and the slider must not show a stale value.
                        last_master = None;
                        last_sessions = None;
                        tick = 0;

                        if !gate.wait_until_visible(&is_running) {
                            break;
                        }
                    }

                    if let Ok(peaks) = backend.read_peaks() {
                        emitter.emit_peaks(&peaks);
                    }

                    if tick % MASTER_POLL_EVERY_TICKS == 0 {
                        if let Ok(master) = backend.master() {
                            let is_first_read_since_opening = last_master.is_none();
                            let has_changed = last_master
                                .as_ref()
                                .is_some_and(|previous| has_master_changed(previous, &master));

                            if is_first_read_since_opening {
                                emitter.emit_master_resync(&master);
                                last_master = Some(master);
                            } else if has_changed {
                                emitter.emit_master_changed(&master);
                                last_master = Some(master);
                            }
                        }
                    }

                    // Notification first, timer second. Where the OS tells the backend, an app
                    // that starts playing is picked up on the next tick rather than on the next
                    // poll. The timer stays as the floor under a backend with no notification, and
                    // as the safety net if one is ever missed.
                    let is_session_poll_due = tick % SESSION_POLL_EVERY_TICKS == 0;
                    let is_notified = backend.sessions_may_have_changed().unwrap_or(false);

                    if is_notified || is_session_poll_due {
                        if let Ok(sessions) = backend.list_sessions() {
                            let has_changed = match last_sessions.as_ref() {
                                // Nothing published yet since the panel opened, so the panel is
                                // showing whatever it had when it closed.
                                None => true,
                                Some(previous) => have_sessions_changed(previous, &sessions),
                            };

                            if has_changed {
                                emitter.emit_sessions_changed(&sessions);
                                last_sessions = Some(sessions);
                            }
                        }
                    }

                    tick = tick.wrapping_add(1);
                    gate.wait_for_next_tick(&is_running);
                }
            }
        });

        Self {
            is_running,
            gate,
            worker: Some(worker),
        }
    }

    pub fn stop(&mut self) {
        self.is_running.store(false, Ordering::Release);
        self.gate.changed.notify_all();

        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for MeterLoop {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Emits over the Tauri event channel: one `audio://peaks` message per tick carrying the whole
/// batch — twelve sessions cost twelve floats in one message, not twelve messages.
pub struct TauriPanelEmitter<R: tauri::Runtime> {
    app: tauri::AppHandle<R>,
}

impl<R: tauri::Runtime> TauriPanelEmitter<R> {
    pub fn new(app: tauri::AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: tauri::Runtime> PanelEventEmitter for TauriPanelEmitter<R> {
    fn emit_peaks(&self, peaks: &[SessionPeak]) {
        use tauri::Emitter;

        let _ = self.app.emit(PEAKS_EVENT, peaks);
    }

    fn emit_master_changed(&self, master: &MasterState) {
        use tauri::Emitter;

        let _ = self.app.emit(MASTER_CHANGED_EVENT, master);
    }

    fn emit_master_resync(&self, master: &MasterState) {
        use tauri::Emitter;

        let _ = self.app.emit(MASTER_RESYNC_EVENT, master);
    }

    fn emit_sessions_changed(&self, sessions: &[AudioSession]) {
        use tauri::Emitter;

        let _ = self.app.emit(SESSIONS_CHANGED_EVENT, sessions);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::mock::MockAudioBackend;
    use crate::audio::{
        AudioDevice, AudioError, AudioSession, DeviceId, MasterState, PlatformCapabilities,
        SessionId,
    };
    use std::sync::atomic::AtomicUsize;

    /// Counts every backend call so a test can assert that a hidden panel makes none.
    struct CountingBackend {
        inner: MockAudioBackend,
        reads: AtomicUsize,
    }

    impl CountingBackend {
        fn new() -> Self {
            Self {
                inner: MockAudioBackend::full_per_app(),
                reads: AtomicUsize::new(0),
            }
        }

        fn reads(&self) -> usize {
            self.reads.load(Ordering::Acquire)
        }
    }

    impl AudioBackend for CountingBackend {
        fn capabilities(&self) -> PlatformCapabilities {
            self.inner.capabilities()
        }

        fn list_sessions(&self) -> Result<Vec<AudioSession>, AudioError> {
            self.inner.list_sessions()
        }

        fn set_session_volume(&self, id: &SessionId, volume: f32) -> Result<(), AudioError> {
            self.inner.set_session_volume(id, volume)
        }

        fn set_session_mute(&self, id: &SessionId, is_muted: bool) -> Result<(), AudioError> {
            self.inner.set_session_mute(id, is_muted)
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
            self.reads.fetch_add(1, Ordering::AcqRel);
            self.inner.read_peaks()
        }
    }

    #[derive(Default)]
    struct RecordingEmitter {
        batches: Mutex<Vec<Vec<SessionPeak>>>,
        masters: Mutex<Vec<MasterState>>,
        resyncs: Mutex<Vec<MasterState>>,
        session_batches: Mutex<Vec<Vec<AudioSession>>>,
    }

    impl RecordingEmitter {
        fn batches(&self) -> Vec<Vec<SessionPeak>> {
            self.batches
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone()
        }

        fn masters(&self) -> Vec<MasterState> {
            self.masters
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone()
        }

        fn resyncs(&self) -> Vec<MasterState> {
            self.resyncs
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone()
        }

        fn session_batches(&self) -> Vec<Vec<AudioSession>> {
            self.session_batches
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone()
        }
    }

    impl PanelEventEmitter for RecordingEmitter {
        fn emit_peaks(&self, peaks: &[SessionPeak]) {
            self.batches
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(peaks.to_vec());
        }

        fn emit_master_changed(&self, master: &MasterState) {
            self.masters
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(master.clone());
        }

        fn emit_sessions_changed(&self, sessions: &[AudioSession]) {
            self.session_batches
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(sessions.to_vec());
        }

        fn emit_master_resync(&self, master: &MasterState) {
            self.resyncs
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(master.clone());
        }
    }

    struct Harness {
        backend: Arc<CountingBackend>,
        emitter: Arc<RecordingEmitter>,
        gate: Arc<MeterGate>,
        meter: MeterLoop,
    }

    fn start() -> Harness {
        let backend = Arc::new(CountingBackend::new());
        let emitter = Arc::new(RecordingEmitter::default());
        let gate = Arc::new(MeterGate::new());
        let meter = MeterLoop::start(
            Arc::clone(&backend) as Arc<dyn AudioBackend>,
            Arc::clone(&gate),
            Arc::clone(&emitter) as Arc<dyn PanelEventEmitter>,
        );

        Harness {
            backend,
            emitter,
            gate,
            meter,
        }
    }

    /// Twelve ticks' worth of wall clock with the panel hidden.
    const SETTLE: Duration = Duration::from_millis(400);

    #[test]
    fn runs_at_thirty_hertz() {
        assert_eq!(METER_HZ, 30);
        assert_eq!(TICK, Duration::from_nanos(33_333_333));
    }

    /// Hidden means stopped, not throttled. This is the CPU budget's enforcement point.
    #[test]
    fn makes_zero_backend_calls_while_the_panel_is_hidden() {
        let harness = start();

        thread::sleep(SETTLE);

        assert_eq!(
            harness.backend.reads(),
            0,
            "the meter loop read the backend while the panel was hidden"
        );
        assert!(
            harness.emitter.batches().is_empty(),
            "the meter loop emitted while the panel was hidden"
        );
    }

    #[test]
    fn reads_and_emits_once_the_panel_is_shown() {
        let harness = start();

        harness.gate.set_visible(true);
        thread::sleep(SETTLE);

        assert!(
            harness.backend.reads() > 0,
            "a visible panel must drive the meter loop"
        );
        assert!(
            !harness.emitter.batches().is_empty(),
            "a visible panel must produce peak batches"
        );
    }

    /// Twelve sessions cost twelve floats in one message, not twelve messages.
    #[test]
    fn emits_one_batch_per_tick_covering_every_session() {
        let harness = start();
        let expected = harness
            .backend
            .list_sessions()
            .expect("sessions")
            .len();

        harness.gate.set_visible(true);
        thread::sleep(SETTLE);
        harness.gate.set_visible(false);

        let batches = harness.emitter.batches();
        assert!(!batches.is_empty(), "no batches were emitted");

        for batch in &batches {
            assert_eq!(
                batch.len(),
                expected,
                "a tick emitted {} peaks for {expected} sessions — the batch is not whole",
                batch.len()
            );
        }
    }

    #[test]
    fn stops_reading_again_once_the_panel_is_hidden() {
        let harness = start();

        harness.gate.set_visible(true);
        thread::sleep(SETTLE);
        harness.gate.set_visible(false);
        thread::sleep(Duration::from_millis(100));

        let settled = harness.backend.reads();
        thread::sleep(SETTLE);

        assert_eq!(
            harness.backend.reads(),
            settled,
            "the loop kept reading after the panel was hidden"
        );
    }

    #[test]
    fn approximates_the_thirty_hertz_cadence() {
        let harness = start();

        harness.gate.set_visible(true);
        thread::sleep(Duration::from_millis(500));
        harness.gate.set_visible(false);

        let reads = harness.backend.reads();

        // 500 ms at 30 Hz is ~15 ticks. The bounds are wide because a loaded CI box schedules
        // this thread unevenly; what is being pinned down is the order of magnitude, not jitter.
        assert!(
            (5..=40).contains(&reads),
            "expected roughly 15 ticks in 500 ms, got {reads}"
        );
    }

    /// The system volume can be changed from outside the app — menu bar, keyboard keys, System
    /// Settings. Nothing pushes that to us, so the loop has to notice and tell the UI.
    #[test]
    fn emits_master_state_when_it_changes_outside_the_app() {
        let harness = start();

        harness.gate.set_visible(true);
        thread::sleep(SETTLE);

        let before = harness.emitter.masters().len();

        harness
            .backend
            .set_master_volume(0.13)
            .expect("an external volume change");
        thread::sleep(SETTLE);

        let masters = harness.emitter.masters();

        assert!(
            masters.len() > before,
            "changing the system volume produced no master-changed emit"
        );
        assert!(
            (masters.last().expect("an emit").volume - 0.13).abs() < 0.01,
            "the emitted volume did not match the new system volume"
        );
    }

    /// Without this, opening the panel after changing the volume elsewhere shows a stale slider.
    #[test]
    fn re_emits_master_state_when_the_panel_reopens() {
        let harness = start();

        harness.gate.set_visible(true);
        thread::sleep(SETTLE);
        harness.gate.set_visible(false);
        thread::sleep(Duration::from_millis(100));

        let before = harness.emitter.resyncs().len();

        harness.gate.set_visible(true);
        thread::sleep(SETTLE);

        assert!(
            harness.emitter.resyncs().len() > before,
            "reopening the panel did not resync master state"
        );
    }

    /// Polling must not turn into a firehose: a steady system volume emits once, on open.
    #[test]
    fn stays_quiet_while_master_state_is_unchanged() {
        let harness = start();

        harness.gate.set_visible(true);
        thread::sleep(SETTLE);
        harness.gate.set_visible(false);

        assert_eq!(
            harness.emitter.resyncs().len(),
            1,
            "opening the panel should resync exactly once"
        );
        assert!(
            harness.emitter.masters().is_empty(),
            "an unchanging master state must not emit a change event"
        );
    }

    #[test]
    fn emits_no_master_state_while_the_panel_is_hidden() {
        let harness = start();

        thread::sleep(SETTLE);

        assert!(harness.emitter.masters().is_empty());
        assert!(harness.emitter.resyncs().is_empty());
    }

    #[test]
    fn ignores_float_noise_below_the_volume_epsilon() {
        let steady = MasterState {
            device_id: crate::audio::DeviceId::new("mock:speakers"),
            device_name: "Built-in Speakers".to_owned(),
            volume: 0.5,
            is_muted: false,
            is_volume_controllable: true,
        };
        let noisy = MasterState {
            volume: 0.5 + VOLUME_EPSILON / 2.0,
            ..steady.clone()
        };
        let real = MasterState {
            volume: 0.6,
            ..steady.clone()
        };

        assert!(!has_master_changed(&steady, &noisy));
        assert!(has_master_changed(&steady, &real));
        assert!(has_master_changed(
            &steady,
            &MasterState {
                is_muted: true,
                ..steady.clone()
            }
        ));
    }

    #[test]
    fn stops_cleanly_on_drop() {
        let harness = start();
        harness.gate.set_visible(true);
        thread::sleep(Duration::from_millis(80));

        let backend = Arc::clone(&harness.backend);
        let mut meter = harness.meter;
        meter.stop();

        let settled = backend.reads();
        thread::sleep(SETTLE);

        assert_eq!(
            backend.reads(),
            settled,
            "the worker thread outlived stop()"
        );
    }

    /// Without this the panel's list is whatever it was at startup: an app that starts playing
    /// afterwards never appears, and one that stops never leaves.
    #[test]
    fn publishes_the_session_list_so_the_panel_can_follow_it() {
        let backend: Arc<dyn AudioBackend> = Arc::new(MockAudioBackend::full_per_app());
        let gate = Arc::new(MeterGate::default());
        let emitter = Arc::new(RecordingEmitter::default());

        gate.set_visible(true);

        let mut loop_under_test = MeterLoop::start(
            Arc::clone(&backend),
            Arc::clone(&gate),
            Arc::clone(&emitter) as Arc<dyn PanelEventEmitter>,
        );

        thread::sleep(TICK * 3);
        loop_under_test.stop();

        let batches = emitter.session_batches();

        assert!(
            !batches.is_empty(),
            "the panel was never told what sessions exist"
        );
        assert!(
            !batches[0].is_empty(),
            "the first batch carried no sessions, so the list would render empty"
        );
    }

    /// An unchanged list must not be re-emitted every second. Each emit replaces the panel's
    /// session state, and doing that needlessly fights the user's own drag.
    #[test]
    fn stays_quiet_while_the_session_list_is_unchanged() {
        let backend: Arc<dyn AudioBackend> = Arc::new(MockAudioBackend::full_per_app());
        let gate = Arc::new(MeterGate::default());
        let emitter = Arc::new(RecordingEmitter::default());

        gate.set_visible(true);

        let mut loop_under_test = MeterLoop::start(
            Arc::clone(&backend),
            Arc::clone(&gate),
            Arc::clone(&emitter) as Arc<dyn PanelEventEmitter>,
        );

        thread::sleep(TICK * (SESSION_POLL_EVERY_TICKS as u32 * 2 + 4));
        loop_under_test.stop();

        assert_eq!(
            emitter.session_batches().len(),
            1,
            "a static session list was published more than once"
        );
    }

    /// A backend the OS notifies must not wait for the poll.
    ///
    /// The whole point of the notification path: an app that starts playing shows up on the next
    /// tick, not up to a second later. The wait here is a small fraction of the poll interval, so
    /// a batch arriving at all proves the notification drove it.
    #[test]
    fn republishes_as_soon_as_the_backend_reports_a_change() {
        struct NotifyingBackend {
            inner: MockAudioBackend,
            has_changed: AtomicBool,
        }

        impl AudioBackend for NotifyingBackend {
            fn capabilities(&self) -> PlatformCapabilities {
                self.inner.capabilities()
            }

            fn list_sessions(&self) -> Result<Vec<AudioSession>, AudioError> {
                self.inner.list_sessions()
            }

            fn set_session_volume(&self, id: &SessionId, volume: f32) -> Result<(), AudioError> {
                self.inner.set_session_volume(id, volume)
            }

            fn set_session_mute(&self, id: &SessionId, is_muted: bool) -> Result<(), AudioError> {
                self.inner.set_session_mute(id, is_muted)
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
                Some(self.has_changed.swap(false, Ordering::AcqRel))
            }
        }

        let backend = Arc::new(NotifyingBackend {
            inner: MockAudioBackend::full_per_app(),
            has_changed: AtomicBool::new(false),
        });
        let gate = Arc::new(MeterGate::default());
        let emitter = Arc::new(RecordingEmitter::default());

        gate.set_visible(true);

        let mut loop_under_test = MeterLoop::start(
            Arc::clone(&backend) as Arc<dyn AudioBackend>,
            Arc::clone(&gate),
            Arc::clone(&emitter) as Arc<dyn PanelEventEmitter>,
        );

        thread::sleep(TICK * 3);

        let first = backend.inner.list_sessions().expect("the mock lists sessions")[0]
            .session_id
            .clone();
        backend
            .inner
            .set_session_mute(&first, true)
            .expect("the mock accepts a mute");
        backend.has_changed.store(true, Ordering::Release);

        thread::sleep(TICK * 3);
        loop_under_test.stop();

        assert!(
            emitter.session_batches().len() > 1,
            "a notified change waited for the poll instead of publishing on the next tick"
        );
    }

    /// The §4.1 gate covers this poll too: a hidden panel must cost zero backend reads.
    #[test]
    fn publishes_no_sessions_while_the_panel_is_hidden() {
        let backend: Arc<dyn AudioBackend> = Arc::new(MockAudioBackend::full_per_app());
        let gate = Arc::new(MeterGate::default());
        let emitter = Arc::new(RecordingEmitter::default());

        gate.set_visible(false);

        let mut loop_under_test = MeterLoop::start(
            Arc::clone(&backend),
            Arc::clone(&gate),
            Arc::clone(&emitter) as Arc<dyn PanelEventEmitter>,
        );

        thread::sleep(TICK * 6);
        loop_under_test.stop();

        assert!(
            emitter.session_batches().is_empty(),
            "a hidden panel still polled the session list"
        );
    }

    #[test]
    fn notices_a_session_appearing_or_leaving() {
        let sessions = |ids: &[&str]| -> Vec<AudioSession> {
            ids.iter()
                .map(|id| AudioSession {
                    session_id: crate::audio::SessionId::from_backend_identifier(id)
                        .expect("namespaced"),
                    pid: 1,
                    display_name: (*id).to_owned(),
                    process_name: (*id).to_owned(),
                    icon_data_uri: None,
                    volume: 0.5,
                    is_muted: false,
                    output_device_id: None,
                    state: crate::audio::SessionState::Active,
                })
                .collect()
        };

        let one = sessions(&["mock:a"]);
        let two = sessions(&["mock:a", "mock:b"]);

        assert!(have_sessions_changed(&one, &two), "an app appearing");
        assert!(have_sessions_changed(&two, &one), "an app leaving");
        assert!(!have_sessions_changed(&one, &one), "an unchanged list");
    }

    /// Mute is a state the panel renders, so a change to it has to reach the panel even when the
    /// set of apps is identical.
    #[test]
    fn notices_a_mute_change_within_an_unchanged_set() {
        let base = AudioSession {
            session_id: crate::audio::SessionId::from_backend_identifier("mock:a")
                .expect("namespaced"),
            pid: 1,
            display_name: "A".to_owned(),
            process_name: "A".to_owned(),
            icon_data_uri: None,
            volume: 0.5,
            is_muted: false,
            output_device_id: None,
            state: crate::audio::SessionState::Active,
        };

        let muted = AudioSession {
            is_muted: true,
            ..base.clone()
        };

        assert!(have_sessions_changed(
            std::slice::from_ref(&base),
            std::slice::from_ref(&muted)
        ));
    }
}
